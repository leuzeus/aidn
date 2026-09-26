import assert from "node:assert/strict";
import {
  assertAgentTaskExecutor,
  checkAgentTaskExecutorAvailability,
  createAgentTaskEventChannel,
  readAgentTaskExecutorDescriptor,
} from "../../src/core/ports/agent-task-executor-port.mjs";
import { createAgentTaskExecutorRegistry } from "../../src/application/runtime/agent-task-executor-registry-service.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function makeCandidate({ executorId = "fixture-task", descriptor, availability } = {}) {
  const calls = { descriptor: 0, availability: 0, task: 0 };
  const declared = descriptor ?? {
    contract_version: "agent-task-executor.v1",
    executor_id: executorId,
    executor_version: "1.0.0",
    capabilities: { events: true, cancellation: true, explicit_cwd: true },
  };
  return {
    calls,
    declared,
    executor: {
      getDescriptor() { calls.descriptor += 1; return declared; },
      async checkAvailability() {
        calls.availability += 1;
        return availability ?? {
          contract_version: "agent-task-availability.v1",
          executor_id: executorId,
          status: "available",
          reason_code: "fixture_prerequisites_verified",
        };
      },
      async runTask() { calls.task += 1; throw new Error("No task should be launched by discovery"); },
    },
  };
}

// This fixture represents callback/stop protocol only, not a native runner or
// a persisted task result. A real process executor is intentionally absent.
async function runInMemoryLifecycle({ signal, onEvent, termination = "confirmed" }) {
  let stopped = false;
  let stopCount = 0;
  let stopReason = null;
  const requestStop = async ({ reason_code }) => {
    if (!stopped) {
      stopped = true;
      stopCount += 1;
      stopReason = reason_code;
    }
  };
  const onAbort = () => { void requestStop({ reason_code: "cancelled" }); };
  const channel = createAgentTaskEventChannel({ onEvent, requestStop });
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) onAbort();
    if (!stopped) await channel.emit({ sequence: 1 });
    if (!stopped) await channel.emit({ sequence: 2 });
    await channel.close();
  } catch {
    await channel.close().catch(() => {});
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return {
    status: termination !== "confirmed" ? "indeterminate"
      : channel.getFailure() ? "failed" : stopped ? "cancelled" : "completed",
    termination,
    stop_count: stopCount,
    stop_reason: stopReason,
    channel,
  };
}

export async function runAgentTaskExecutorConformanceChecks() {
  const checks = [];
  async function check(name, run) {
    await run();
    checks.push({ name, status: "PASS" });
  }
  const cwd = process.platform === "win32" ? "C:\\fixture espace été\\client" : "/fixture espace été/client";

  await check("port assertion and registry construction have no method calls", () => {
    const candidate = makeCandidate();
    assert.equal(assertAgentTaskExecutor(candidate.executor), candidate.executor);
    const source = [candidate.executor];
    const registry = createAgentTaskExecutorRegistry(source);
    source.length = 0;
    assert.deepEqual(candidate.calls, { descriptor: 0, availability: 0, task: 0 });
    assert.equal(registry.discover().length, 1);
    assert.deepEqual(candidate.calls, { descriptor: 1, availability: 0, task: 0 });
    assert.deepEqual(createAgentTaskExecutorRegistry().discover(), []);
  });

  await check("port rejects incomplete objects and accessors without invoking them", () => {
    assert.throws(() => assertAgentTaskExecutor({}), /getDescriptor/);
    assert.throws(() => assertAgentTaskExecutor(null), /object/);
    const inherited = Object.create(makeCandidate().executor);
    assert.equal(assertAgentTaskExecutor(inherited), inherited);
    let getterCalls = 0;
    const unsafe = makeCandidate().executor;
    Object.defineProperty(unsafe, "getDescriptor", { get() { getterCalls += 1; return () => ({}); } });
    assert.throws(() => assertAgentTaskExecutor(unsafe), /getDescriptor/);
    assert.equal(getterCalls, 0);
  });

  await check("discovery is explicit, detached and has no availability or launch effect", () => {
    const candidate = makeCandidate();
    const registry = createAgentTaskExecutorRegistry([candidate.executor]);
    const [descriptor] = registry.discover();
    descriptor.capabilities.events = false;
    assert.equal(candidate.declared.capabilities.events, true);
    assert.equal(registry.resolve("fixture-task"), candidate.executor);
    assert.throws(() => registry.resolve("missing-task"), /Unknown agent task executor/);
    assert.throws(() => registry.resolve(""), /explicit/);
    assert.equal(candidate.calls.availability, 0);
    assert.equal(candidate.calls.task, 0);
  });

  await check("discovery rejects duplicate, malformed, asynchronous and legacy identities", () => {
    assert.throws(() => createAgentTaskExecutorRegistry({}), /array/);
    const first = makeCandidate();
    const second = makeCandidate();
    assert.throws(() => createAgentTaskExecutorRegistry([first.executor, second.executor]).discover(), /Duplicate/);
    assert.throws(() => readAgentTaskExecutorDescriptor(makeCandidate({ descriptor: {} }).executor));
    const asyncDescriptor = makeCandidate().executor;
    asyncDescriptor.getDescriptor = async () => makeCandidate().declared;
    assert.throws(() => readAgentTaskExecutorDescriptor(asyncDescriptor));
    assert.throws(() => readAgentTaskExecutorDescriptor(makeCandidate({ executorId: "codex" }).executor));
    assert.equal(first.calls.task + second.calls.task, 0);
  });

  await check("availability is an explicit asynchronous probe with an absolute cwd", async () => {
    const candidate = makeCandidate();
    const signal = new AbortController().signal;
    const original = candidate.executor.checkAvailability;
    candidate.executor.checkAvailability = async (options) => {
      assert.equal(options.cwd, cwd);
      assert.equal(options.signal, signal);
      return original();
    };
    const availability = await checkAgentTaskExecutorAvailability(candidate.executor, { cwd, signal });
    assert.equal(availability.status, "available");
    assert.deepEqual(candidate.calls, { descriptor: 1, availability: 1, task: 0 });
    await assert.rejects(checkAgentTaskExecutorAvailability(candidate.executor, { cwd: "relative/client" }), /absolute cwd/);
    await assert.rejects(checkAgentTaskExecutorAvailability(candidate.executor, {}), /absolute cwd/);
    await assert.rejects(checkAgentTaskExecutorAvailability(candidate.executor, { cwd, signal: {} }), /AbortSignal/);
    assert.equal(candidate.calls.availability, 1);
    for (const ambiguous of [
      "C:relative", "\\client", "\\\\?\\C:\\client", "\\\\.\\pipe\\client",
      "\\\\server\\share\\client", "//server/share/client", "C:\\client\\..\\other", "/client/../other",
    ]) {
      await assert.rejects(checkAgentTaskExecutorAvailability(candidate.executor, { cwd: ambiguous }), /absolute cwd/);
    }
    for (const portable of ["C:\\fixture espace été\\client", "/fixture espace été/client"]) {
      const explicit = makeCandidate();
      await checkAgentTaskExecutorAvailability(explicit.executor, { cwd: portable });
      assert.equal(explicit.calls.availability, 1);
    }
  });

  await check("availability refuses malformed, mismatched and synchronous replies", async () => {
    const malformed = makeCandidate({ availability: { status: "available" } });
    await assert.rejects(checkAgentTaskExecutorAvailability(malformed.executor, { cwd }));
    const mismatched = makeCandidate({ availability: {
      contract_version: "agent-task-availability.v1", executor_id: "other-task", status: "available", reason_code: "verified",
    } });
    await assert.rejects(checkAgentTaskExecutorAvailability(mismatched.executor, { cwd }), /identity/);
    const synchronous = makeCandidate();
    synchronous.executor.checkAvailability = () => ({});
    await assert.rejects(checkAgentTaskExecutorAvailability(synchronous.executor, { cwd }), /Promise/);
    assert.equal(malformed.calls.task + mismatched.calls.task + synchronous.calls.task, 0);
  });

  await check("event callbacks are serialized, awaited and drained before close", async () => {
    const entered = deferred();
    const release = deferred();
    const seen = [];
    let active = 0;
    const channel = createAgentTaskEventChannel({
      async onEvent(event) {
        active += 1;
        assert.equal(active, 1);
        seen.push(`start:${event.sequence}`);
        if (event.sequence === 1) { entered.resolve(); await release.promise; }
        seen.push(`end:${event.sequence}`);
        active -= 1;
      },
      async requestStop() { assert.fail("Successful events must not request a stop"); },
    });
    const first = channel.emit({ sequence: 1 });
    const second = channel.emit({ sequence: 2 });
    await entered.promise;
    assert.deepEqual(seen, ["start:1"]);
    let settled = false;
    const closing = channel.close().then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    await assert.rejects(channel.emit({ sequence: 3 }), /closed/);
    release.resolve();
    await Promise.all([first, second, closing]);
    assert.deepEqual(seen, ["start:1", "end:1", "start:2", "end:2"]);
    assert.deepEqual(channel.getState(), { accepting: false, closed: true, failed: false });
    await assert.rejects(channel.emit({ sequence: 4 }), /closed/);
    assert.equal(channel.getFailure(), null);
  });

  await check("sink failure rejects queued events and requests exactly one awaited stop", async () => {
    const stopEntered = deferred();
    const stopRelease = deferred();
    const failure = new Error("Fixture sink failed");
    let delivered = 0;
    let stopCount = 0;
    const channel = createAgentTaskEventChannel({
      async onEvent() { delivered += 1; throw failure; },
      async requestStop({ reason_code }) {
        assert.equal(reason_code, "event_callback_failed");
        stopCount += 1;
        stopEntered.resolve();
        await stopRelease.promise;
      },
    });
    const first = channel.emit({ sequence: 1 });
    const second = channel.emit({ sequence: 2 });
    const failures = Promise.all([assert.rejects(first, (error) => error === failure), assert.rejects(second, (error) => error === failure)]);
    await stopEntered.promise;
    let settled = false;
    const closing = assert.rejects(channel.close(), (error) => error === failure).then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    stopRelease.resolve();
    await Promise.all([failures, closing]);
    await assert.rejects(channel.emit({ sequence: 3 }), (error) => error === failure);
    assert.equal(delivered, 1);
    assert.equal(stopCount, 1);
    assert.equal(channel.getFailure().cause, failure);
  });

  await check("failed stop preserves sink failure for reconciliation", async () => {
    const sinkFailure = new Error("Fixture sink failed");
    const stopFailure = new Error("Fixture stop indeterminate");
    const channel = createAgentTaskEventChannel({
      onEvent() { throw sinkFailure; },
      requestStop() { throw stopFailure; },
    });
    await assert.rejects(channel.emit({ sequence: 1 }), (error) => error === sinkFailure);
    await assert.rejects(channel.close(), (error) => error === sinkFailure);
    assert.equal(channel.getFailure().stop_error, stopFailure);
    assert.throws(() => createAgentTaskEventChannel(), /callbacks/);
  });

  await check("in-memory executor settles only after events and handles cancellation", async () => {
    const controller = new AbortController();
    const seen = [];
    const outcome = await runInMemoryLifecycle({
      signal: controller.signal,
      async onEvent(event) { seen.push(event.sequence); controller.abort(); },
    });
    assert.equal(outcome.status, "cancelled");
    assert.equal(outcome.stop_count, 1);
    assert.deepEqual(seen, [1]);
    await assert.rejects(outcome.channel.emit({ sequence: 3 }), /closed/);
    const beforeStart = new AbortController();
    beforeStart.abort();
    const preCancelled = await runInMemoryLifecycle({ signal: beforeStart.signal, onEvent() { assert.fail("Already aborted"); } });
    assert.equal(preCancelled.status, "cancelled");
  });

  await check("in-memory sink failure distinguishes confirmed and unknown termination", async () => {
    for (const termination of ["confirmed", "unknown"]) {
      const outcome = await runInMemoryLifecycle({ termination, onEvent() { throw new Error("Fixture sink failed"); } });
      assert.equal(outcome.status, termination === "confirmed" ? "failed" : "indeterminate");
      assert.equal(outcome.stop_count, 1);
      assert.equal(outcome.stop_reason, "event_callback_failed");
      assert.equal(outcome.channel.getState().closed, true);
    }
  });

  return checks;
}
