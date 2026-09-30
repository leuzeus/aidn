import {
  assertAgentTaskExecutor,
  readAgentTaskExecutorDescriptor,
} from "../../core/ports/agent-task-executor-port.mjs";

// Candidates are objects provided by the composition root. There are no built-in
// task executors, module loading, configuration reads, probes, or fallback here.
export function createAgentTaskExecutorRegistry(candidates = []) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Agent task executor candidates must be an array");
  }
  const executors = candidates.map((candidate) => assertAgentTaskExecutor(candidate));

  function inspect() {
    const seen = new Set();
    return executors.map((executor) => {
      const descriptor = readAgentTaskExecutorDescriptor(executor);
      if (seen.has(descriptor.executor_id)) {
        throw new TypeError(`Duplicate agent task executor identity: ${descriptor.executor_id}`);
      }
      seen.add(descriptor.executor_id);
      return { executor, descriptor };
    });
  }

  return Object.freeze({
    discover() {
      return inspect().map(({ descriptor }) => descriptor);
    },
    resolve(executorId) {
      if (typeof executorId !== "string" || !executorId.trim()) {
        throw new TypeError("An explicit agent task executor identity is required");
      }
      const match = inspect().find(({ descriptor }) => descriptor.executor_id === executorId);
      if (!match) throw new Error(`Unknown agent task executor: ${executorId}`);
      return match.executor;
    },
  });
}
