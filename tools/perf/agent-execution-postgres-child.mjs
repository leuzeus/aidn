import { createPostgresSharedCoordinationStore } from "../../src/adapters/runtime/postgres-shared-coordination-store.mjs";
import { createPostgresAgentExecutionStore } from "../../src/adapters/runtime/postgres-agent-execution-store.mjs";

// Credentials are received only over the parent's private IPC channel, never
// in process arguments, stdout, diagnostic messages or a persistent file.
if (!process.send) throw new Error("POSTGRES_FIXTURE_IPC_REQUIRED");
process.send({ type: "ready", pid: process.pid });
process.once("message", async ({ mode, connectionString, args }) => {
  if (mode === "alive") {
    process.on("message", message => { if (message.type === "stop") process.disconnect(); });
    process.send({ type: "alive", pid: process.pid });
    return;
  }
  try {
    const store = createPostgresAgentExecutionStore({ connectionString,
      verifyActivation: () => true, verifyTermination: (_attempt, proof) => proof?.fixtureConfirmed === true,
      verifySupervisorTermination: (_supervisor,proof) => ({ok:proof?.fixtureConfirmed===true,supervisor_stopped:true,descendants_stopped:true,git_operations_stopped:true}),
      verifyCleanupTermination: (_cleaner,proof) => ({ok:proof?.fixtureConfirmed===true,cleaner_stopped:true,descendants_stopped:true,git_operations_stopped:true}),
      inspectCleanup: (resource,{cleanup}) => ({resource_id:resource.resource_id,cwd:resource.cwd,preimage_sha256:resource.preimage_sha256,
        repository_identity_sha256:cleanup.repository_identity_sha256,retention:resource.retention,exists:true,registered:true,
        clean:true,retained:true,processes_stopped:true,links_safe:true}),
      inspectIntegration: input => ({ok:true,repository_identity_sha256:input.repository_identity_sha256,ref:input.ref,
        head_sha:input.parent_sha ?? args?.intent?.parent_sha ?? args?.cleanup?.integrated_sha,source_parent_sha:null,result_parent_sha:input.parent_sha}) });
    const value = mode === "migrate"
      ? await createPostgresSharedCoordinationStore({ connectionString }).bootstrap()
      : await store[mode](args);
    process.send({ type: "result", ok: value?.ok !== false, value }, () => process.disconnect());
  } catch (error) {
    // Do not relay driver messages or stack traces, which may include secrets.
    const code = /^AGENT_EXECUTION_[A-Z_]+$/.test(error.code ?? "") ? error.code : "POSTGRES_FIXTURE_OPERATION_FAILED";
    process.send({ type: "result", ok: false, code }, () => process.disconnect());
  }
});
