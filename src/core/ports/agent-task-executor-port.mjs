import {
  assertAgentExecutionContract,
  isAbsoluteExecutionCwd,
} from "../agents/agent-execution-contracts.mjs";

export const AGENT_TASK_EXECUTOR_METHODS = Object.freeze([
  "getDescriptor",
  "checkAvailability",
  "runTask",
]);

function findMethodDescriptor(candidate, name) {
  for (let current = candidate; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor;
  }
  return null;
}

// Shape assertion never invokes methods or accessor properties. In particular,
// it neither discovers capabilities nor checks native availability/admission.
export function assertAgentTaskExecutor(candidate, label = "AgentTaskExecutor") {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  for (const method of AGENT_TASK_EXECUTOR_METHODS) {
    const descriptor = findMethodDescriptor(candidate, method);
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new TypeError(`${label} is missing required method: ${method}()`);
    }
  }
  return candidate;
}

export function readAgentTaskExecutorDescriptor(candidate) {
  const executor = assertAgentTaskExecutor(candidate);
  const descriptor = executor.getDescriptor();
  assertAgentExecutionContract("descriptor", descriptor);
  if (descriptor.executor_id === "codex") {
    throw new TypeError("AgentTaskExecutor cannot use the historical codex adapter identity");
  }
  // A consumer cannot mutate the executor's declared capabilities through discovery.
  return structuredClone(descriptor);
}

function assertAvailabilityOptions({ cwd, signal } = {}) {
  if (!isAbsoluteExecutionCwd(cwd)) {
    throw new TypeError("AgentTaskExecutor availability requires an explicit absolute cwd");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("AgentTaskExecutor signal must be an AbortSignal");
  }
  return { cwd, signal };
}

// This is the only availability probe in this module and must be called explicitly.
// Available means executable prerequisites were checked, never native admission.
export async function checkAgentTaskExecutorAvailability(candidate, options) {
  const executor = assertAgentTaskExecutor(candidate);
  const checkedOptions = assertAvailabilityOptions(options);
  const descriptor = readAgentTaskExecutorDescriptor(executor);
  const pending = executor.checkAvailability(checkedOptions);
  if (!pending || typeof pending.then !== "function") {
    throw new TypeError("AgentTaskExecutor.checkAvailability() must return a Promise");
  }
  const availability = await pending;
  assertAgentExecutionContract("availability", availability);
  if (availability.executor_id !== descriptor.executor_id) {
    throw new TypeError("AgentTaskExecutor availability identity does not match its descriptor");
  }
  return structuredClone(availability);
}

// Executors await emit() for backpressure, and close() before settling runTask().
// This channel only manages callbacks; it cannot prove process termination or
// produce an accepted result. The future runner retains those responsibilities.
export function createAgentTaskEventChannel({ onEvent = async () => {}, requestStop } = {}) {
  if (typeof onEvent !== "function" || typeof requestStop !== "function") {
    throw new TypeError("Agent task event channel requires onEvent and requestStop callbacks");
  }
  let accepting = true;
  let closed = false;
  let tail = Promise.resolve();
  let failure = null;

  return Object.freeze({
    emit(event) {
      if (!accepting || failure) {
        return Promise.reject(failure?.cause ?? new Error("Agent task event channel is closed"));
      }
      const delivered = tail.then(async () => {
        if (failure) throw failure.cause;
        try {
          await onEvent(event);
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          failure = { reason_code: "event_callback_failed", cause, stop_error: null };
          accepting = false;
          try {
            await requestStop({ reason_code: failure.reason_code, cause });
          } catch (stopError) {
            failure.stop_error = stopError;
          }
          throw cause;
        }
      });
      // The returned promise carries the error. The internal tail stays handled
      // so close() and already-enqueued emissions can finish deterministically.
      tail = delivered.catch(() => {});
      return delivered;
    },
    async close() {
      accepting = false;
      await tail;
      closed = true;
      if (failure) throw failure.cause;
    },
    getState() {
      return { accepting, closed, failed: failure !== null };
    },
    getFailure() {
      return failure ? { ...failure } : null;
    },
  });
}
