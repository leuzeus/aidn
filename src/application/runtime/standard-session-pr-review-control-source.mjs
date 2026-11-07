import { assertControlRequest, assertControlReviewEvent, assertControlReviewPayload } from '../../core/workflow/process-control-inbox.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { standardPrReviewMaterial } from './standard-session-pr-review-receive.mjs';
const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };

// Event authentication and canonical context lookup are trusted host ports.
// Neither an event body nor its hash authenticates the provider or its actor.
export function createStandardPrReviewControlSource({ readEvent, verifyEvent, readContext, observer, withReviewReads, observerFor, now = Date.now }) {
  if (![readEvent, verifyEvent, readContext, observer?.observe].every(fn => typeof fn === 'function')) fail('PROCESS_CONTROL_PR_AUTHORITY_REQUIRED');
  const withReads = (signal, collect) => withReviewReads
    ? withReviewReads(ports => collect({ ...ports, observer: observerFor(ports.reviewPort) }), { signal })
    : collect({ readEvent, verifyEvent, observer });
  const active = signal => { if (signal?.aborted) fail('PROCESS_CONTROL_PR_ABORTED'); };
  function subjectFor(observation) {
    const { evidence } = observation.observations, p = evidence.pull_request;
    return { repository_id: evidence.repository.node_id, pull_request_id: p.node_id, pull_request_number: p.number,
      head_oid: p.head_oid, base_oid: p.base_oid, head_ref: p.head_ref, base_ref: p.base_ref, reviews: evidence.reviews };
  }
  async function eventFor(ports, request, sourceRef, signal, { retained = false, subject } = {}) {
    active(signal); assertControlRequest(request);
    const input = { request: structuredClone(request), sourceRef, subject: structuredClone(subject), signal };
    const event = await ports.readEvent(input);
    active(signal);
    if (event === null) return null;
    assertControlReviewEvent(event);
    const proof = await ports.verifyEvent({ ...input, event: structuredClone(event) });
    active(signal);
    if (proof?.outcome !== 'verified' || proof.current !== true || proof.authority_id !== event.authority_id
      || proof.event_sha256 !== shadowHash(event) || proof.subject_sha256 !== shadowHash(event.actor)) fail('PROCESS_CONTROL_PR_NOT_AUTHENTICATED');
    const date = Date.parse(event.occurred_at), time = now();
    if (!Number.isSafeInteger(time) || !Number.isSafeInteger(date) || date > time || !retained && time - date > 300000)
      fail('PROCESS_CONTROL_PR_EVENT_STALE');
    if (!request.event_keys.includes(event.event_key) || event.head_oid !== request.head || event.head_ref !== request.branch)
      fail('PROCESS_CONTROL_PR_EVENT_CHANGED');
    return structuredClone(event);
  }
  async function contextFor(request, signal) {
    active(signal);
    const context = await readContext({ request: structuredClone(request), signal });
    active(signal);
    const instance = context?.instance;
    if (instance?.instance_id !== request.instance_id || instance.instance_sha256 !== request.instance_sha256
      || instance.scope_id !== request.scope_id || instance.model_sha256 !== request.model_sha256 || instance.revision !== request.instance_revision)
      fail('PROCESS_CONTROL_PR_CONTEXT_CHANGED');
    // The context port authenticates the exact current business snapshot,
    // occurrence/correlation and accepted update operation, not caller JSON.
    if (context.request_sha256 !== shadowHash(request)) fail('PROCESS_CONTROL_PR_CONTEXT_CHANGED');
    return context;
  }
  async function observe(ports, context, signal) {
    const output = await ports.observer.observe(context.instance, context.input, { signal });
    active(signal);
    if (output?.contract_version !== 'standard-session-pr-review-content-output.v1' || output.outcome !== 'completed')
      fail('PROCESS_CONTROL_PR_OBSERVATION_UNAVAILABLE');
    return output;
  }
  const claimFor = (event, request, payload) => ({ contract_version: 'process-control-source.v1', source_kind: 'external',
    authority_id: event.authority_id, source_event_id: event.source_event_id, subject_sha256: shadowHash(event.actor),
    request_sha256: shadowHash(request), event_key: event.event_key, payload_sha256: shadowHash(payload),
    evidence_refs: [{ ref: 'github:review-event/' + event.source_event_id, sha256: shadowHash(event) },
      { ref: 'github:review-content/' + event.pull_request_id + '/' + event.head_oid, sha256: shadowHash(payload) }] });
  return Object.freeze({
    async verifyCapturedEvent({ source, payload, request, source_ref: sourceRef, phase }, { signal } = {}) {
      assertControlReviewPayload(payload, source, request);
      const { evidence, threads } = payload.observation.observations;
      const subject = subjectFor(payload.observation);
      if (phase === 'delivered') subject.pre_merge_observed_until_ms = Math.max(Date.parse(evidence.observed_until), Date.parse(threads.observed_until));
      const event = await withReads(signal, ports => eventFor(ports, request, sourceRef, signal, { retained: true, subject }));
      if (event === null || shadowHash(event) !== shadowHash(payload.event)) fail('PROCESS_CONTROL_PR_EVENT_CHANGED');
    },
    async readReview({ request, sourceRef, signal }) {
      const context = await contextFor(request, signal);
      return withReads(signal, async ports => {
        const event = await eventFor(ports, request, sourceRef, signal, { subject: context.reviewSubject });
        if (event === null) return null;
        const payload = { contract_version: 'process-pr-review-payload.v1', event, observation: await observe(ports, context, signal) };
        const source = claimFor(event, request, payload);
        assertControlReviewPayload(payload, source, request);
        return { source, payload };
      });
    },
    async verifyReview({ source, payload, request, sourceRef, signal }) {
      assertControlReviewPayload(payload, source, request);
      // A signed captured event can survive a long wait. Its identity/revision
      // must still be current and its content freshly reobserved; no old native
      // deadline or effect authorization is renewed by delivering this event.
      const context = await contextFor(request, signal);
      const subject = { ...context.reviewSubject, ...subjectFor(payload.observation) };
      return withReads(signal, async ports => {
        const event = await eventFor(ports, request, sourceRef, signal, { retained: true, subject });
        if (event === null || shadowHash(event) !== shadowHash(payload.event) || shadowHash(claimFor(event, request, payload)) !== shadowHash(source))
          fail('PROCESS_CONTROL_PR_EVENT_CHANGED');
        const output = await observe(ports, context, signal);
        if (standardPrReviewMaterial(output) !== standardPrReviewMaterial(payload.observation)) fail('PROCESS_CONTROL_PR_COLLECTION_CHANGED');
        // A source revision/actor may change while the collections are read.
        const repeated = await eventFor(ports, request, sourceRef, signal, { retained: true, subject });
        if (repeated === null || shadowHash(repeated) !== shadowHash(event)) fail('PROCESS_CONTROL_PR_EVENT_CHANGED');
        return { outcome: 'verified', authority_id: source.authority_id, source_sha256: shadowHash(source) };
      });
    },
  });
}
