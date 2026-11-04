import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertNativeAllocationJournal } from "../../src/core/workflow/native-allocation-journal.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";

export async function verifyInitialNativeAuthorizationEpochs(check, { journalFixture, mixedFixture, bootstrapMixed }) {
  for (const mode of ["files", "dual", "db-only"]) await check(`native initial epoch ${mode}: expired unused original grant retains zero-allocation origin and requires authenticated scope closure`, async () => {
    const f = journalFixture({ stateMode: mode, git: true }), original = f.authorize(), realNow = Date.now;
    assert.throws(() => f.open().prepareAuthorizationEpoch({ originalAuthorization: original }), /INITIAL_AUTHORIZATION_NOT_EXPIRED/);
    const offset = original.global_deadline_ms + 1 - realNow(); Date.now = () => realNow() + offset;
    let lastGrant, mutation, verified = 0;
    const source = { async read({ request }) {
      lastGrant = { contract_version: "native-authorization-epoch-grant.v1", authority_id: "fixture_initial_consent", source_event_id: `initial-${request.epoch}`,
        request_sha256: shadowHash(request), authorization: { ...original, authorized_at_ms: Date.now(), global_deadline_ms: Date.now() + 600000,
          workflow_deadline_ms: Date.now() + 600000, max_responses: 10 },
        closure: { contract_version: "native-resource-closure.v1", request_sha256: shadowHash(request), inventory_sha256: shadowHash(request.resources),
          observed_at_ms: Date.now(), complete: true, active_resources: 0, evidence_class: "fixture",
          resources: request.resources.map(resource => ({ resource_sha256: shadowHash(resource), state: "closed", evidence_refs: [{ ref: "fixture:scope-resource-discovery", sha256: shadowHash(resource) }] })) },
        evidence_refs: [{ ref: "fixture:fresh-explicit-initial-consent", sha256: "c".repeat(64) }] };
      mutation?.(lastGrant); return lastGrant;
    }, async verify({ grant }) { verified++; return { outcome: "verified", authority_id: grant.authority_id, grant_sha256: shadowHash(grant), evidence_class: "fixture" }; } };
    const actor = () => f.open(() => f.key, source);
    try {
      await assert.rejects(f.open().run({ execute: true, authorization: original }), /AUTHORIZATION_EXPIRED/);
      assert.equal(actor().inspect(), null); assert.equal(f.launches ?? 0, 0);
      const request = actor().prepareAuthorizationEpoch({ originalAuthorization: original });
      assert.equal(request.contract_version, "native-authorization-epoch-request.v2"); assert.equal(request.next_generation, 1);
      assert.equal(request.journal_sha256, shadowHash(null)); assert.deepEqual(request.consumption, { known: true, responses: 0, bytes: 0 });
      assert.equal(request.resources.length, 1); assert.equal(request.resources[0].kind, "native_scope");
      assert.equal(actor().inspect(), null); assert.equal((await actor().activateAuthorizationEpoch(request)).status, "preview");
      await assert.rejects(f.open().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /AUTHENTICATED_SOURCE_REQUIRED/);
      for (mutation of [grant => { grant.closure.resources = []; }, grant => { grant.closure.active_resources = 1; }, grant => { grant.authorization.approved = false; }]) {
        await assert.rejects(actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /NATIVE_EPOCH_/);
        assert.equal(actor().inspect(), null);
      }
      mutation = null;
      const unverified = f.open(() => f.key, { read: source.read, async verify() { return { outcome: "denied" }; } });
      await assert.rejects(unverified.activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /SOURCE_NOT_AUTHENTICATED/);
      assert.equal((await actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" })).journal_phase, "absent");
      const active = actor().inspect(); assertNativeAllocationJournal(active);
      assert.equal(active.contract_version, "native-allocation-journal.v3"); assert.equal(active.origin_journal, null);
      assert.deepEqual(active.initial_authorization, original); assert.deepEqual(active.allocations, []); assert.equal(f.launches ?? 0, 0);
      const verifiedBefore = verified; assert.equal((await actor().activateAuthorizationEpoch(request)).authorization_status, "active"); assert.equal(verified, verifiedBefore);
      const bad = structuredClone(active); bad.epochs[0].request.journal_sha256 = "f".repeat(64);
      assert.throws(() => assertNativeAllocationJournal(bad), /NATIVE_EPOCH_/);
      await assert.rejects(actor().run({ execute: true, authorization: original }), /EXACT_GRANT_REQUIRED/);
      const grant = active.epochs[0].grant.authorization;
      const result = await actor().run({ execute: true, authorization: grant }); assert.equal(result.status, "COMPLETED", JSON.stringify(result));
      const final = actor().inspect(), checkpoint = actor().readCheckpoint(1); assertNativeAllocationJournal(final);
      assert.deepEqual(final.initial_authorization, original); assert.deepEqual(final.epochs, active.epochs); assert.equal(final.allocations.length, 1);
      assert.equal(final.allocations[0].authorization_sha256, shadowHash(grant)); assert.equal(f.launches, 1);
      const instance = checkpoint.state.instance;
      assert.equal(simulateAgenticProcess({ instanceId: instance.instance_id, model: instance.model, scopeId: instance.scope_id,
        policyPins: instance.policy_pins, events: instance.events }).trace.at(-1).instance_sha256, instance.instance_sha256);
      const input = path.join(f.base, "initial-epoch-cold.json"); fs.writeFileSync(input, JSON.stringify({ configuration: f.configuration, key: f.key.toString("hex"), environment: f.environment }));
      const module = new URL("../../src/application/runtime/journaled-native-allocation.mjs", import.meta.url).href;
      const script = `import fs from 'node:fs';import{createJournaledNativeAllocation}from ${JSON.stringify(module)};const c=JSON.parse(fs.readFileSync(process.argv[1]));const h=createJournaledNativeAllocation({configuration:c.configuration,readSigningKey:()=>Buffer.from(c.key,'hex'),environment:c.environment});console.log(JSON.stringify({journal:h.inspect(),checkpoint:h.readCheckpoint(1)}));`;
      const cold = spawnSync(process.execPath, ["--input-type=module", "-e", script, input], { encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 1048576 });
      assert.equal(cold.status, 0, cold.stderr); assert.deepEqual(JSON.parse(cold.stdout), { journal: final, checkpoint });
    } finally { Date.now = realNow; }
  });
  await check("native initial epoch files: mixed IR consumes the fresh initial grant at its first native boundary", async () => {
    let grant, reads = 0;
    const source = { async read({ request }) {
      reads++;
      grant = { contract_version: "native-authorization-epoch-grant.v1", authority_id: "fixture_initial_consent", source_event_id: "mixed-initial-epoch",
        request_sha256: shadowHash(request), authorization: { ...request.initial_authorization, authorized_at_ms: Date.now(),
          global_deadline_ms: Date.now() + 600000, workflow_deadline_ms: Date.now() + 600000 },
        closure: { contract_version: "native-resource-closure.v1", request_sha256: shadowHash(request), inventory_sha256: shadowHash(request.resources),
          observed_at_ms: Date.now(), complete: true, active_resources: 0, evidence_class: "fixture",
          resources: request.resources.map(resource => ({ resource_sha256: shadowHash(resource), state: "closed", evidence_refs: [{ ref: "fixture:scope-discovery", sha256: shadowHash(resource) }] })) },
        evidence_refs: [{ ref: "fixture:explicit-human-consent", sha256: "e".repeat(64) }] }; return grant;
    }, async verify({ grant: supplied }) { assert.deepEqual(supplied, grant); return { outcome: "verified", authority_id: grant.authority_id, grant_sha256: shadowHash(grant), evidence_class: "fixture" }; } };
    const f = mixedFixture("files", { nativeAuthorizationSource: source }), original = await bootstrapMixed(f), realNow = Date.now;
    const offset = original.global_deadline_ms + 1 - realNow(); Date.now = () => realNow() + offset;
    try {
      const before = f.open().inspect().record;
      const request = f.open().prepareNativeAuthorizationEpoch({ originalAuthorization: original });
      assert.equal(request.instance_sha256, before.instance_sha256); assert.equal(request.next_generation, 1);
      assert.equal((await f.open().activateNativeAuthorizationEpoch(request, { write: true, sourceRef: "fresh" })).journal_phase, "absent");
      assert.equal(f.t.sessions.length, 0); assert.equal(reads, 1); assert.equal(f.open().inspect().record.instance_sha256, before.instance_sha256);
      const first = await f.open().step({ write: true, authorization: grant.authorization });
      assert.equal(first.kind, "native"); assert.equal(first.journal_phase, "closed", JSON.stringify(first));
      const checkpoint = f.open().readCheckpoint(1), journal = f.open().inspectAllocations();
      assert.equal(journal.contract_version, "native-allocation-journal.v3"); assert.deepEqual(journal.initial_authorization, original);
      assert.deepEqual(checkpoint.state.instance.events.slice(0, before.events.length), before.events);
      const instance = checkpoint.state.instance;
      assert.equal(simulateAgenticProcess({ instanceId: instance.instance_id, model: instance.model, scopeId: instance.scope_id,
        policyPins: instance.policy_pins, events: instance.events }).trace.at(-1).instance_sha256, instance.instance_sha256);
    } finally { Date.now = realNow; }
  });
}

export async function verifyNativeAuthorizationEpochs(check, { readyResumeFixture, mixedFixture, bootstrapMixed }) {
  for (const mode of ["files", "dual", "db-only"]) await check(`native epoch ${mode}: fresh verified closure authorizes a new cumulative grant without replaying historical work`, async () => {
    let duringReservation = async () => {};
    const f = await readyResumeFixture({ stateMode: mode, async beforeWorker() { await duringReservation(); } }), initial = f.actor.inspect(), original = structuredClone(f.auth), realNow = Date.now;
    const oldCheckpoint = f.actor.readCheckpoint(1), oldEvents = structuredClone(oldCheckpoint.state.instance.events);
    const offset = original.global_deadline_ms + 1 - realNow();
    // Advance the fixture clock past the original deadline; neither its grant
    // nor a historical file is edited. Fake native/controller wires only.
    Date.now = () => realNow() + offset;
    try {
      await assert.rejects(f.open().run({ execute: true, authorization: original, resume: true }), /EXPLICIT_AUTHORIZATION_REQUIRED/);
      assert.equal(f.launches, 1);
      const h = f.open(); let request = h.prepareAuthorizationEpoch({ originalAuthorization: original });
      assert.deepEqual(h.inspect(), initial); assert.equal(request.consumption.responses, initial.allocations[0].consumption.responses_observed);
      assert.equal(request.resources.filter(row => row.kind === "allocation").length, 1);
      assert.equal(request.resources.filter(row => row.kind === "native_session").length, oldCheckpoint.state.resources.length);
      assert.equal((await h.activateAuthorizationEpoch(request)).status, "preview");
      await assert.rejects(h.activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /AUTHENTICATED_SOURCE_REQUIRED/);
      let grant, mutation = null, reads = 0, verified = 0, refuse = false;
      const createGrant = () => ({ contract_version: "native-authorization-epoch-grant.v1", authority_id: "fixture_human_and_resource_owner", source_event_id: `fresh-consent-${request.epoch}`,
        request_sha256: shadowHash(request), authorization: { ...original, authorized_at_ms: Date.now(), global_deadline_ms: Date.now() + 240000,
          workflow_deadline_ms: Date.now() + 240000, max_responses: 9, max_bytes: original.max_bytes + 1048576 },
        closure: { contract_version: "native-resource-closure.v1", request_sha256: shadowHash(request), inventory_sha256: shadowHash(request.resources),
          observed_at_ms: Date.now(), complete: true, active_resources: 0, evidence_class: "fixture",
          resources: request.resources.map(row => ({ resource_sha256: shadowHash(row), state: "closed", evidence_refs: [{ ref: "fixture:closed-resource", sha256: shadowHash(row) }] })) },
        evidence_refs: [{ ref: "fixture:explicit-human-consent", sha256: "e".repeat(64) }] });
      const source = { async read() { reads++; if (refuse) return null; grant = createGrant(); mutation?.(grant); return grant; },
        async verify({ grant: received }) {
          verified++; assert.deepEqual(received, grant); assert.equal(f.t.sessions.every(row => row.closed), true);
          return { outcome: "verified", authority_id: grant.authority_id, grant_sha256: shadowHash(grant), evidence_class: "fixture" };
        } };
      const actor = () => f.open(() => f.key, source);
      refuse = true; assert.equal((await actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" })).status, "WAITING"); refuse = false;
      const denials = [
        value => { value.closure.complete = false; },
        value => { value.closure.active_resources = 1; },
        value => { value.closure.resources.pop(); },
        value => { value.closure.resources.push(value.closure.resources[0]); },
        value => { value.closure.resources[0].resource_sha256 = "d".repeat(64); },
        value => { value.closure.resources[0].state = "unknown"; },
        value => { value.closure.request_sha256 = "d".repeat(64); },
        value => { value.authorization.configuration_sha256 = "d".repeat(64); },
        value => { value.authorization.max_responses = request.consumption.responses; },
        value => { value.authorization.max_bytes = request.consumption.bytes + 1048575; },
        value => { value.closure.observed_at_ms = Date.now() + 50000; },
        value => { value.authorization.approved = false; },
      ];
      for (mutation of denials) {
        await assert.rejects(actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /NATIVE_EPOCH_/);
        assert.deepEqual(actor().inspect(), initial); assert.equal(f.launches, 1);
      }
      mutation = null;
      const forged = structuredClone(request); forged.request_id = "other-request";
      await assert.rejects(actor().activateAuthorizationEpoch(forged, { write: true, sourceRef: "fresh" }), /NOT_AUTHENTICATED/);
      const stale = structuredClone(request); stale.instance_sha256 = "f".repeat(64);
      await assert.rejects(actor().activateAuthorizationEpoch(createOperationJournalSigner(() => f.key).seal(stale), { write: true, sourceRef: "fresh" }), /CONTEXT_CHANGED/);
      const unverified = f.open(() => f.key, { read: source.read, async verify() { return { outcome: "denied" }; } });
      await assert.rejects(unverified.activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" }), /SOURCE_NOT_AUTHENTICATED/);
      const result = await actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" });
      assert.equal(result.epoch, 2); assert.equal(result.native_started, false); assert.equal(result.written, true);
      let activated = actor().inspect(), acceptedGrant = activated.epochs[0].grant.authorization;
      assertNativeAllocationJournal(activated); assert.equal(activated.contract_version, "native-allocation-journal.v2");
      assert.deepEqual(activated.allocations, initial.allocations); assert.deepEqual(activated.initial_authorization, original);
      assert.deepEqual(activated.origin_journal, initial); assertNativeAllocationJournal(activated.origin_journal);
      assert.deepEqual(actor().readCheckpoint(1), oldCheckpoint); assert.equal(f.launches, 1);
      const observations = [reads, verified];
      assert.equal((await actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh" })).retained, true);
      assert.deepEqual([reads, verified], observations);
      if (mode === "files") {
        const unused = structuredClone(activated.epochs[0]);
        const oldRequest = request;
        Date.now = () => realNow() + offset + 300000;
        assert.equal((await actor().activateAuthorizationEpoch(oldRequest)).authorization_status, "expired");
        request = actor().prepareAuthorizationEpoch();
        assert.equal(request.epoch, 3); assert.equal(request.next_generation, 2);
        mutation = value => { value.source_event_id = unused.grant.source_event_id; };
        await assert.rejects(actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "reused-consent" }), /SOURCE_REUSED/);
        mutation = null;
        assert.equal((await actor().activateAuthorizationEpoch(request, { write: true, sourceRef: "fresh-after-unused-expiry" })).epoch, 3);
        activated = actor().inspect(); acceptedGrant = activated.epochs.at(-1).grant.authorization;
        assert.deepEqual(activated.epochs[0], unused); assert.deepEqual(activated.allocations, initial.allocations);
        assert.deepEqual(request.consumption, unused.request.consumption);
        assert.equal((await actor().activateAuthorizationEpoch(oldRequest)).authorization_status, "superseded");
      }
      await assert.rejects(actor().run({ execute: true, authorization: original, resume: true }), /EXACT_GRANT_REQUIRED/);
      await assert.rejects(actor().run({ execute: true, authorization: { ...acceptedGrant, max_responses: 10 }, resume: true }), /EXACT_GRANT_REQUIRED/);
      duringReservation = async () => {
        const observed = await actor().activateAuthorizationEpoch(request);
        assert.equal(observed.authorization_status, "resources_unresolved"); assert.equal(observed.journal_phase, "reserved");
        await assert.rejects(async () => actor().prepareAuthorizationEpoch(), /RESOURCE_RECONCILIATION_REQUIRED/);
      };
      const next = await actor().run({ execute: true, authorization: acceptedGrant, resume: true });
      assert.equal(next.status, "COMPLETED", JSON.stringify(next)); assert.equal(next.journal_phase, "closed");
      const final = actor().inspect(), checkpoint = actor().readCheckpoint(2), instance = checkpoint.state.instance;
      assert.deepEqual(final.allocations[0], initial.allocations[0]); assert.deepEqual(final.epochs, activated.epochs);
      assert.equal(final.allocations[1].limits.max_responses, acceptedGrant.max_responses - request.consumption.responses);
      assert.equal(final.allocations[1].limits.max_bytes, acceptedGrant.max_bytes - request.consumption.bytes);
      assert.equal(instance.events.filter(row => row.kind === "result").length, oldEvents.filter(row => row.kind === "result").length + 1);
      assert.deepEqual(instance.events.slice(0, oldEvents.length), oldEvents);
      assert.equal(f.launches, 2); assert.equal(f.t.sessions.every(row => row.closed), true);
      const simulation = simulateAgenticProcess({ instanceId: instance.instance_id, model: instance.model, scopeId: instance.scope_id,
        policyPins: instance.policy_pins, events: instance.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, instance.instance_sha256);
      // Both readers and the private worker admission consumed the v2 journal;
      // a cold actual Node reader also reauthenticates the exact retained bytes.
      const input = path.join(f.base, "epoch-cold.json"); fs.writeFileSync(input, JSON.stringify({ configuration: f.configuration, key: f.key.toString("hex"), environment: f.environment }));
      const module = new URL("../../src/application/runtime/journaled-native-allocation.mjs", import.meta.url).href;
      const script = `import fs from 'node:fs';import{createJournaledNativeAllocation}from ${JSON.stringify(module)};const c=JSON.parse(fs.readFileSync(process.argv[1]));const h=createJournaledNativeAllocation({configuration:c.configuration,readSigningKey:()=>Buffer.from(c.key,'hex'),environment:c.environment});console.log(JSON.stringify({journal:h.inspect(),old:h.readCheckpoint(1),latest:h.readCheckpoint(2)}));`;
      const cold = spawnSync(process.execPath, ["--input-type=module", "-e", script, input], { encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 1048576 });
      assert.equal(cold.status, 0, cold.stderr); const reopened = JSON.parse(cold.stdout);
      assert.deepEqual(reopened.journal, final); assert.deepEqual(reopened.old, oldCheckpoint); assert.deepEqual(reopened.latest, checkpoint);
      const bad = structuredClone(final); bad.allocations[1].limits.max_responses++;
      assert.throws(() => assertNativeAllocationJournal(bad), /EPOCH_ALLOCATION_UNBOUND/);
      const reset = structuredClone(final); reset.epochs.at(-1).request.consumption.responses = 0;
      assert.throws(() => assertNativeAllocationJournal(reset), /EPOCH_(GRANT_UNBOUND|HISTORY_INVALID)/);
    } finally { Date.now = realNow; }
  });
  await check("native epoch files: mixed IR selects deterministic and native ports under the explicit epoch without new routing", async () => {
    let claim = null, lastGrant = null, sourceReads = 0;
    const controlSource = { async read() { return claim; }, async verify({ source }) { assert.deepEqual(source, claim);
      return { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) }; } };
    const nativeAuthorizationSource = { async read({ request }) {
      sourceReads++;
      lastGrant = { contract_version: "native-authorization-epoch-grant.v1", authority_id: "fixture_explicit_consent", source_event_id: "mixed-epoch-2",
        request_sha256: shadowHash(request), authorization: { ...request.initial_authorization, authorized_at_ms: Date.now(),
          global_deadline_ms: Date.now() + 240000, workflow_deadline_ms: Date.now() + 240000, max_responses: 8 },
        closure: { contract_version: "native-resource-closure.v1", request_sha256: shadowHash(request), inventory_sha256: shadowHash(request.resources),
          observed_at_ms: Date.now(), complete: true, active_resources: 0, evidence_class: "fixture",
          resources: request.resources.map(row => ({ resource_sha256: shadowHash(row), state: "closed", evidence_refs: [{ ref: "fixture:resource-closure", sha256: shadowHash(row) }] })) },
        evidence_refs: [{ ref: "fixture:human-epoch-consent", sha256: "a".repeat(64) }] };
      return lastGrant;
    }, async verify({ grant }) { assert.deepEqual(grant, lastGrant); return { outcome: "verified", authority_id: grant.authority_id,
      grant_sha256: shadowHash(grant), evidence_class: "fixture" }; } };
    const f = mixedFixture("files", { controlSource, nativeAuthorizationSource }), original = await bootstrapMixed(f);
    const first = await f.open().step({ write: true, authorization: original }); assert.equal(first.journal_phase, "closed", JSON.stringify(first));
    const before = f.open().inspectAllocations(), old = f.open().readCheckpoint(1), sessions = f.t.sessions.length;
    const request = f.open().prepareNativeAuthorizationEpoch({ originalAuthorization: original });
    assert.equal((await f.open().activateNativeAuthorizationEpoch(request, { write: true, sourceRef: "consent" })).epoch, 2);
    assert.equal(f.t.sessions.length, sessions); assert.equal(sourceReads, 1);
    const grant = f.open().inspectAllocations().epochs[0].grant.authorization;
    const post = await f.open().step({ write: true, authorization: grant }); assert.equal(post.kind, "operation"); assert.equal(post.cursor.status, "WAITING");
    assert.equal(f.t.sessions.length, sessions);
    const state = f.open().inspect(), frame = state.cursor.occurrences.find(row => row.node_id === "external_wait");
    const control = f.open().prepareControl({ expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id });
    claim = { contract_version: "process-control-source.v1", source_kind: "external", authority_id: "fixture_review", source_event_id: "epoch-review-1",
      subject_sha256: "a".repeat(64), request_sha256: shadowHash(control), event_key: "review_snapshot", payload_sha256: "b".repeat(64),
      evidence_refs: [{ ref: "provider:fixture-review", sha256: "c".repeat(64) }] };
    const captured = await f.open().captureControl({ expectedSha256: state.record.instance_sha256, occurrenceId: frame.occurrence_id, sourceRef: "review", write: true });
    await f.open().deliverControl(captured.inbox_id, { write: true });
    const resumed = await f.open().step({ write: true, authorization: grant }); assert.equal(resumed.kind, "native"); assert.equal(resumed.journal_phase, "closed", JSON.stringify(resumed));
    const final = await f.open().step({ write: true }); assert.equal(final.cursor.status, "COMPLETED");
    assert.deepEqual(f.open().inspectAllocations().allocations[0], before.allocations[0]); assert.deepEqual(f.open().readCheckpoint(1), old);
    assert.equal(f.open().inspectAllocations().allocations.length, 2); assert.equal(f.t.sessions.length, sessions + 1);
    const record = final.record;
    assert.equal(simulateAgenticProcess({ instanceId: record.instance_id, model: record.model, scopeId: record.scope_id, policyPins: record.policy_pins,
      events: record.events }).trace.at(-1).instance_sha256, record.instance_sha256);
  });
}
