import {
  createManagedSetupProtocol,
  stepManagedSetupProtocol,
} from "../../core/agents/codex-managed-setup-protocol.mjs";

/**
 * Internal adapter, never a native executor or an authorization boundary.
 * The caller supplies an already admitted, exclusive, fresh transport:
 *   send(Uint8Array, {signal}) -> Promise<void> (backpressure, no buffering reply)
 *   stdout -> AsyncIterable<Uint8Array> (one consumer; bounded chunks)
 *   requestStop({reason, signal}) -> Promise<{termination, evidence?}>
 * A confirmed receipt requires evidence={kind:"controller", reference:string}.
 * This adapter validates its shape only; the controller must establish that the
 * entire tree stopped. EOF, setupCompleted and a successful send are not proof.
 * The transport owns stderr draining/redaction/bounds and native process life.
 *
 * clock={now():monotonic safe integer, waitUntil(deadline,{signal}):Promise<void>}
 * and limits={max_stdout_bytes,stop_timeout_ms} are mandatory, with no defaults.
 * waitUntil must resolve at/after deadline and release resources on abort.
 * send/read/stop and onEvent must cooperate with cancellation. A non-cooperative
 * pending promise is abandoned at its bound (rejection observed); no new callback
 * or send is invoked after shutdown/settlement. Already entered foreign code
 * cannot be forcibly stopped by JavaScript; that remains the controller's job.
 * onEvent(event,{signal}) is serialized and awaited before the next transition.
 * Its failure aborts work, suppresses further callbacks and requests tree stop.
 *
 * Incoming JSONL allows split UTF-8 sequences, split/multiple lines and CRLF.
 * Every line (including newline), raw stdout and total duplex bytes are bounded.
 * Empty chunks are refused (they must not form an unbounded no-progress stream).
 * Following completion, stop is requested and stdout drained to EOF within the
 * separate stop bound; trailing frames invalidate completion. No callbacks occur
 * while draining. Abort/timeout never reuse the work signal for requestStop.
 * None of these results grant native availability, consent or confinement.
 */

const terminal = new Set(["completion_observed", "refused", "indeterminate"]);
class ChannelFailure extends Error { constructor(code) { super(code); this.code = code; } }
const failure = code => new ChannelFailure(code);
const ensure = (condition, code) => { if (!condition) throw failure(code); };
const frozen = value => {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value;
};

/** No process, filesystem, timers, credentials or implicit configuration. */
export async function runManagedSetupChannel(config, {
  transport, clock, limits, signal, onEvent,
} = {}) {
  ensure(transport && typeof transport.send === "function"
    && typeof transport.requestStop === "function"
    && typeof transport.stdout?.[Symbol.asyncIterator] === "function", "SETUP_CHANNEL_TRANSPORT_INVALID");
  ensure(clock && typeof clock.now === "function" && typeof clock.waitUntil === "function", "SETUP_CHANNEL_CLOCK_REQUIRED");
  ensure(limits && Object.keys(limits).length === 2
    && Number.isSafeInteger(limits.max_stdout_bytes) && limits.max_stdout_bytes > 0 && limits.max_stdout_bytes <= 1048576
    && Number.isSafeInteger(limits.stop_timeout_ms) && limits.stop_timeout_ms > 0 && limits.stop_timeout_ms <= 60000,
  "SETUP_CHANNEL_LIMIT_INVALID");
  ensure(signal === undefined || (typeof signal.aborted === "boolean"
    && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function"), "SETUP_CHANNEL_SIGNAL_INVALID");
  ensure(onEvent === undefined || typeof onEvent === "function", "SETUP_CHANNEL_CALLBACK_INVALID");

  // Snapshot injected capabilities before any await. Configuration is copied and
  // recursively frozen by the pure model before the first transport operation.
  const nowFn = clock.now.bind(clock), waitFn = clock.waitUntil.bind(clock);
  const sendFn = transport.send.bind(transport), stopFn = transport.requestStop.bind(transport);
  const stdout = transport.stdout, maxStdout = limits.max_stdout_bytes, stopTimeout = limits.stop_timeout_ms;
  let previousAt = 0;
  const now = () => {
    const at = nowFn();
    ensure(Number.isSafeInteger(at) && at >= previousAt && at <= Number.MAX_SAFE_INTEGER - 660000, "SETUP_CHANNEL_CLOCK_INVALID");
    previousAt = at;
    return at;
  };
  let transition = createManagedSetupProtocol(config, { at: now() });
  const frozenConfig = transition.state.config;
  ensure(maxStdout <= frozenConfig.limits.max_total_bytes, "SETUP_CHANNEL_LIMIT_INVALID");

  const work = new AbortController();
  const abortWork = () => work.abort();
  signal?.addEventListener("abort", abortWork, { once: true });
  if (signal?.aborted) work.abort();
  let iterator, pendingRead = null, stdoutBytes = 0, sentBytes = 0, sentFrames = 0, sequence = 0;
  let line = "", lineBytes = 0, decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let eof = false, reason = null, stopEvidence = null, processTermination = "unconfirmed", callbacksSuppressed = false;
  const deadline = () => Math.min(transition.state.phase_deadline, transition.state.global_deadline);

  // Race only injected operations. Attach handlers even to an abandoned promise.
  async function bounded(action, until, operationSignal, code) {
    ensure(!operationSignal.aborted, "SETUP_CHANNEL_CANCELLED");
    ensure(now() < until, "SETUP_CHANNEL_TIMEOUT");
    const timer = new AbortController();
    let cancel;
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(failure("SETUP_CHANNEL_CANCELLED"));
      operationSignal.addEventListener("abort", cancel, { once: true });
      if (operationSignal.aborted) cancel();
    });
    const timeout = Promise.resolve().then(() => waitFn(until, { signal: timer.signal })).then(() => {
      ensure(now() >= until, "SETUP_CHANNEL_CLOCK_EARLY_TIMEOUT");
      throw failure("SETUP_CHANNEL_TIMEOUT");
    }, () => { throw failure("SETUP_CHANNEL_CLOCK_WAIT_FAILED"); });
    const running = Promise.resolve().then(() => {
      ensure(!operationSignal.aborted, "SETUP_CHANNEL_CANCELLED");
      ensure(now() < until, "SETUP_CHANNEL_TIMEOUT");
      return action();
    }).catch(error => {
      if (error instanceof ChannelFailure) throw error;
      throw failure(code);
    });
    try {
      const result = await Promise.race([running, timeout, cancelled]);
      ensure(!operationSignal.aborted, "SETUP_CHANNEL_CANCELLED");
      ensure(now() < until, "SETUP_CHANNEL_TIMEOUT");
      return result;
    } finally {
      timer.abort();
      operationSignal.removeEventListener("abort", cancel);
    }
  }

  async function emit() {
    if (!onEvent || callbacksSuppressed) return;
    const event = frozen({
      sequence: sequence++, phase: transition.state.phase,
      reason_code: transition.state.reason_code,
      reported_setup_result: transition.state.reported_setup_result,
      received_frames: transition.state.received_frames, sent_frames: sentFrames,
    });
    try { await bounded(() => onEvent(event, { signal: work.signal }), deadline(), work.signal, "SETUP_CHANNEL_CALLBACK_FAILED"); }
    catch (error) { callbacksSuppressed = true; throw error; }
  }

  async function sendRequested() {
    for (const frame of transition.requested_frames) {
      const bytes = new TextEncoder().encode(JSON.stringify(frame) + "\n");
      ensure(stdoutBytes + sentBytes + bytes.byteLength <= frozenConfig.limits.max_total_bytes, "SETUP_CHANNEL_TOTAL_BYTE_LIMIT");
      // Count a requested write conservatively even if transport reports failure:
      // a prefix may already have crossed its boundary.
      sentBytes += bytes.byteLength; sentFrames++;
      await bounded(() => sendFn(bytes, { signal: work.signal }), deadline(), work.signal, "SETUP_CHANNEL_SEND_FAILED");
    }
  }

  function apply(event) {
    transition = stepManagedSetupProtocol(transition.state, event, { at: now() });
    if (transition.state.reason_code) reason ??= transition.state.reason_code;
  }

  async function next(until, readSignal) {
    const result = await bounded(() => {
      if (!pendingRead) {
        pendingRead = Promise.resolve().then(() => {
          ensure(!readSignal.aborted, "SETUP_CHANNEL_CANCELLED");
          ensure(now() < until, "SETUP_CHANNEL_TIMEOUT");
          return iterator.next();
        });
        // Reuse an entered pending read during shutdown; never overlap next().
        pendingRead.catch(() => {});
      }
      return pendingRead;
    }, until, readSignal, "SETUP_CHANNEL_READ_FAILED");
    pendingRead = null;
    ensure(result && typeof result === "object" && typeof result.done === "boolean", "SETUP_CHANNEL_READ_INVALID");
    return result;
  }

  async function consume(chunk, consumeSignal, onLine) {
    ensure(!consumeSignal.aborted, "SETUP_CHANNEL_CANCELLED");
    ensure(chunk instanceof Uint8Array && chunk.byteLength > 0, "SETUP_CHANNEL_CHUNK_INVALID");
    stdoutBytes += chunk.byteLength;
    ensure(stdoutBytes <= maxStdout, "SETUP_CHANNEL_STDOUT_BYTE_LIMIT");
    ensure(stdoutBytes + sentBytes <= frozenConfig.limits.max_total_bytes, "SETUP_CHANNEL_TOTAL_BYTE_LIMIT");
    // An injected producer cannot alter retained bytes across awaits.
    const bytes = new Uint8Array(chunk);
    let start = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 10) continue;
      const segment = bytes.subarray(start, index);
      lineBytes += segment.byteLength + 1;
      ensure(lineBytes <= frozenConfig.limits.max_frame_bytes, "SETUP_CHANNEL_FRAME_BYTE_LIMIT");
      try { line += decoder.decode(segment, { stream: true }) + decoder.decode(); }
      catch { throw failure("SETUP_CHANNEL_UTF8_INVALID"); }
      const ready = line;
      line = ""; lineBytes = 0;
      decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      ensure(!consumeSignal.aborted, "SETUP_CHANNEL_CANCELLED");
      await onLine(ready);
      ensure(!consumeSignal.aborted, "SETUP_CHANNEL_CANCELLED");
      start = index + 1;
    }
    if (start < bytes.length) {
      const segment = bytes.subarray(start);
      lineBytes += segment.byteLength;
      // Reserve the required JSONL delimiter even for a partial frame.
      ensure(lineBytes + 1 <= frozenConfig.limits.max_frame_bytes, "SETUP_CHANNEL_FRAME_BYTE_LIMIT");
      try { line += decoder.decode(segment, { stream: true }); }
      catch { throw failure("SETUP_CHANNEL_UTF8_INVALID"); }
    }
  }

  function finishStream() {
    eof = true;
    try { line += decoder.decode(); }
    catch { throw failure("SETUP_CHANNEL_UTF8_INVALID"); }
    ensure(lineBytes === 0 && line.length === 0, "SETUP_CHANNEL_TRUNCATED_FRAME");
    apply({ type: "eof" });
  }

  try {
    ensure(!work.signal.aborted, "SETUP_CHANNEL_CANCELLED");
    iterator = stdout[Symbol.asyncIterator]();
    ensure(iterator && typeof iterator.next === "function", "SETUP_CHANNEL_READ_INVALID");
    await emit();
    await sendRequested();
    while (!terminal.has(transition.state.phase)) {
      const item = await next(deadline(), work.signal);
      if (item.done) { finishStream(); await emit(); break; }
      await consume(item.value, work.signal, async json => {
        const wasTerminal = terminal.has(transition.state.phase);
        apply({ type: "frame", json });
        if (!wasTerminal) {
          await emit();
          await sendRequested();
        }
      });
    }
  } catch (error) {
    // Raw transport/callback errors and RPC payloads never enter the result.
    reason = error instanceof ChannelFailure
      ? error.code : "SETUP_CHANNEL_INTERNAL_ERROR";
  } finally {
    callbacksSuppressed = true;
    work.abort();
    signal?.removeEventListener("abort", abortWork);
  }

  // A fresh stop signal intentionally ignores a user's already-aborted signal.
  const stop = new AbortController();
  let stopStartedAt = previousAt;
  try { stopStartedAt = now(); } catch { reason ??= "SETUP_CHANNEL_CLOCK_INVALID"; }
  const stopDeadline = stopStartedAt + stopTimeout;
  let stopReason = null;
  // Request stop even when an injected clock has become invalid. Bounds can
  // reject afterwards, but must never suppress the controller's stop request.
  let requestedStop;
  try { requestedStop = Promise.resolve(stopFn({ reason: reason ?? "SETUP_PROTOCOL_TERMINAL", signal: stop.signal })); }
  catch { requestedStop = Promise.reject(failure("SETUP_CHANNEL_STOP_FAILED")); }
  requestedStop.catch(() => {});
  async function stopAndDrain() {
    const request = requestedStop.then(receipt => {
      ensure(receipt && typeof receipt === "object" && ["confirmed", "unconfirmed"].includes(receipt.termination), "SETUP_CHANNEL_STOP_EVIDENCE_INVALID");
      if (receipt.termination === "confirmed") {
        const evidence = receipt.evidence;
        ensure(evidence && Object.keys(evidence).length === 2 && evidence.kind === "controller"
          && typeof evidence.reference === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(evidence.reference), "SETUP_CHANNEL_STOP_EVIDENCE_INVALID");
        processTermination = "confirmed";
        stopEvidence = { kind: "controller", reference: evidence.reference };
      }
    });
    const drain = (async () => {
      if (!iterator || eof) return;
      while (!eof) {
        const item = await next(stopDeadline, stop.signal);
        if (item.done) { finishStream(); return; }
        // Never accept further control progress or emit during shutdown. A
        // completion already observed must still reject trailing protocol data.
        await consume(item.value, stop.signal, async json => {
          if (transition.state.phase === "completion_observed") apply({ type: "frame", json });
        });
      }
    })();
    await Promise.all([request, drain]);
  }
  try {
    await bounded(stopAndDrain, stopDeadline, stop.signal, "SETUP_CHANNEL_STOP_FAILED");
  } catch (error) {
    stopReason = error instanceof ChannelFailure
      ? error.code : "SETUP_CHANNEL_STOP_FAILED";
  } finally { stop.abort(); }
  reason ??= stopReason;

  let outcome = "indeterminate";
  if (processTermination === "confirmed") {
    if (stopReason) outcome = "indeterminate";
    else if (reason === "SETUP_CHANNEL_CANCELLED") outcome = "cancelled";
    else if (reason === "SETUP_CHANNEL_TIMEOUT" || reason === "PROTOCOL_DEADLINE_EXCEEDED") outcome = "timed_out";
    else if (transition.state.phase === "indeterminate") outcome = "indeterminate";
    else if (reason) outcome = "failed";
    else if (transition.state.phase === "completion_observed") outcome = transition.state.reported_setup_result === "succeeded" ? "completed" : "failed";
  }
  return frozen({
    contract_version: "codex-managed-setup-channel-result.v1", outcome, reason_code: reason,
    stop_reason_code: stopReason, process_termination: processTermination, stop_evidence: stopEvidence,
    protocol: transition.state, reported_setup_result: transition.state.reported_setup_result,
    stdout_bytes: stdoutBytes, sent_bytes: sentBytes, sent_frames: sentFrames, stdout_eof: eof,
    reconciliation_required: transition.state.setup_requested || processTermination !== "confirmed" || outcome === "indeterminate",
    execution_available: false, operation_authorized: false, native: false,
    state_stability: "NOT_OBSERVED", confinement: "NOT_TESTED",
  });
}
