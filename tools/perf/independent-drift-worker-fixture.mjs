import path from "node:path";
import { transport } from "./agentic-native-rpc-fixture-lib.mjs";
import { createNativeAllocationWorkerAuthority } from "../../src/application/runtime/native-allocation-worker-authority.mjs";
import { createProjectAgenticProcessExecution } from "../../src/application/runtime/agentic-process-execution-composition.mjs";
import { createAgenticProcessStore } from "../../src/adapters/runtime/agentic-process-store.mjs";

// Static independent fixture entry. Only the native RPC actor is doubled. This
// is not the fixed production entry and cannot qualify genuine Native behavior.
let bytes = Buffer.alloc(0);
for await (const part of process.stdin) {
  if (bytes.length + part.length > 262144) throw Error("FIXTURE_WORKER_INPUT_LIMIT");
  bytes = Buffer.concat([bytes, part]);
}
const sent = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const { configuration, authorization } = sent;
const f = { configuration, dirs: { product: path.join(configuration.target_root, "product"), control: configuration.control_root } };
const instances = createAgenticProcessStore({ targetRoot: configuration.target_root, stateMode: "files" });
let observations = 0, assignedObservations = 0;
const t = transport(f, {
  async onConfigRead() {
    observations++;
    // After the durable assignment, execute() snapshots once and session.run()
    // observes once more. This second observation is the last awaited RPC before
    // beforeTurn. Earlier open/assignment observations cannot trigger this race.
    if (instances.read(configuration.instance_id).record.events.at(-1)?.kind !== "assign" || ++assignedObservations !== 2) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("FIXTURE_PARENT_ACK_TIMEOUT")), 5000);
      process.once("message", message => {
        clearTimeout(timer);
        if (message?.kind !== "fixture_continue") reject(Error("FIXTURE_PARENT_ACK_INVALID")); else resolve();
      });
      process.send({ kind: "fixture_observed" });
    });
  },
  answer({ params }) {
    const context = JSON.parse(params.input[0].text.split("\n").at(-1));
    return { outcome: "completed", summary: "Independent fixture diagnostic.", report: {
      contract_version: "standard-drift-report.v1", context_sha256: context.context_sha256,
      original_objective: context.context.original_objective, current_objective: context.context.original_objective,
      drift_level: "none", objective_changed: false, changes: [], keep: ["Current scope"], discard: [],
      split_recommendation: { new_cycle: false, new_branch: false, change_request_required: false, impact: "none" },
      recommendation: "continue", rationale: "Fixture Native actor; actual independent authority/execution reconstruction.", evidence_refs: context.evidence_refs,
    } };
  },
});
let execution;
const allocationAuthority = createNativeAllocationWorkerAuthority({ configuration, authorization, admission: sent.allocation,
  readProductSha256: () => execution.preview().product_sha256 });
delete sent.allocation; bytes.fill(0);
execution = createProjectAgenticProcessExecution(configuration, { rpcFactory: t.rpcFactory, allocationAuthority, processAuthority: allocationAuthority.processAuthority });
const result = await execution.run({ execute: true, authorization });
process.stdout.write(JSON.stringify(result) + "\n");
process.send({ kind: "fixture_metrics", pid: process.pid, parent_pid: process.ppid, observations, assignedObservations,
  sessions: t.sessions.map(({ turns, closed, closeCalls, confirmedClosures }) => ({ turns, closed, closeCalls, confirmedClosures })),
  rpc_calls: t.calls.length, turns: t.calls.filter(row => row.method === "turn/start").length,
  capability_in_native: JSON.stringify(t.sessions.map(row => row.configuration)).includes("human_verification")
    || JSON.stringify(t.calls).includes("human_verification"), native: "fixture" }, () => process.disconnect());
