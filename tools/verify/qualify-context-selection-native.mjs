#!/usr/bin/env node
// Manual synthetic consumption probe; never a production context authority.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeWorkflowAdapterConfig } from "../../src/lib/config/workflow-adapter-config-lib.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createContextNativeProbeClient, nativeProbeRootSettings, nativeProbeOutputInstructions, NATIVE_CONTEXT_OUTPUT_POLICY, isNativeTurnCompletion } from "../../tools/verify/context-native-rpc-lib.mjs";

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes("--execute") || args.includes("--help")) {
  console.log("Manual native selection/delta probe. No effects without --execute.\nUsage: node tools/verify/qualify-context-selection-native.mjs --execute --binary <absolute-codex> --codex-home <existing-home> --output <new-absolute-directory>\nUses the configured root OpenAI model, temporary credentials and read-only synthetic consultation. Bounded native output profile: 60000 history tokens, 131072 dynamic JSON bytes, per-thread only. No model/provider fallback or trust edits.");
} else await run();

async function run() {
  const repo = path.resolve(import.meta.dirname, "../.."), output = option("--output"), binary = option("--binary"), sourceHome = option("--codex-home");
  for (const value of [output, binary, sourceHome]) assert.ok(value && path.isAbsolute(value));
  assert.ok(!fs.existsSync(output) && !path.resolve(output).toLowerCase().startsWith(repo.toLowerCase() + path.sep));
  const sha = value => createHash("sha256").update(value).digest("hex");
  const configFile = path.join(sourceHome, "config.toml"), config = fs.readFileSync(configFile), settings = nativeProbeRootSettings(config.toString());
  const authFile = path.join(sourceHome, "auth.json"), authSha = sha(fs.readFileSync(authFile));
  fs.mkdirSync(output); const home = path.join(output, "home"), target = path.join(output, "corpus"), cwd = path.join(output, "native-cwd");
  for (const dir of [home, target, cwd]) fs.mkdirSync(dir);
  const report = { kind: "native-context-selection-reference", status: "RUNNING", proof_class: "native-synthetic", modes: [],
    source_commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim(),
    binary_sha256: sha(fs.readFileSync(binary)), source_dirty: true, native_output_policy: NATIVE_CONTEXT_OUTPUT_POLICY, costs: null, general_efficiency: "not_established" };
  const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  let rpc;
  try {
    fs.mkdirSync(path.join(target, ".aidn/project"), { recursive: true });
    fs.writeFileSync(path.join(target, ".aidn/project/shared-runtime.locator.json"), JSON.stringify({ version: 2, projectId: "synthetic-context-selection", workspaceId: "A" }));
    const resolved = resolveRuntimeProjectContext({ targetRoot: target });
    const scope = { project_id: resolved.project_id, workspace_id: resolved.workspace_id, runtime_scope_id: resolved.runtime_scope_id, worktree_id: resolved.worktree_id, cycle_id: "C101" };
    const rule = "Do not write without fresh admission.", localRule = "Read the selected canonical backend.";
    const documents = { "RULES.md": `## Invariants\n${rule}\n`, "WORKFLOW.md": `## Local\n${localRule}\n`,
      "optional.md": "## Optional\n" + "Historical non-normative diagnostic explanation.\n".repeat(900) };
    for (const [ref, text] of Object.entries(documents)) { fs.mkdirSync(path.dirname(path.join(target, "docs/audit", ref)), { recursive: true }); fs.writeFileSync(path.join(target, "docs/audit", ref), text); }
    const adoption = JSON.parse(fs.readFileSync(path.join(repo, "package/governance/gfd-adoption.v1.json")));
    adoption.scope = "installed-project"; adoption.adoptionId = "synthetic-native-context-selection";
    adoption.authorities = Object.keys(documents).map((reference, index) => ({ id: `authority-${index}`, reference, role: "synthetic authority", scope: "synthetic project", owner: "project_owner", status: "effective", effectiveFrom: "2026-10-18" }));
    adoption.sections = [{ id: "5", disposition: "adapted", rationale: "Owned synthetic consultation corpus, accepted only for this qualification.", responsibility: "project_owner", authorities: adoption.authorities.map(a => a.id), controls: [] }];
    const unit = (id, ref, heading, requires = []) => ({ id, path: ref, heading, sourceSha256: sha(documents[ref]), authority: adoption.authorities.find(a => a.reference === ref).id,
      status: "effective", scope: { project_id: scope.project_id, workspace_id: "*", worktree_id: "*" }, requires });
    const units = [unit("rule", "RULES.md", "## Invariants"), unit("local", "WORKFLOW.md", "## Local", [{ id: "rule", reason: "mandatory admission ceiling" }]), unit("optional", "optional.md", "## Optional")];
    adoption.extensions = { ...adoption.extensions, contextUnits: units }; writeWorkflowAdapterConfig(target, { governanceAdoption: adoption });
    const payload = { schema_version: 1, generated_at: new Date().toISOString(), project_context: scope, target_root: target, cycles: [{ cycle_id: "C101", state: "IMPLEMENTING" }],
      artifacts: Object.entries(documents).map(([ref, content]) => ({ path: ref, artifact_id: ref, content, content_format: "utf8", sha256: sha(content) })), artifact_links: [], session_cycle_links: [], session_links: [], migration_findings: [] };
    const index = path.join(target, "index.json"), requestFile = path.join(target, "request.json"), baselineFile = path.join(target, "baseline.json");
    fs.writeFileSync(index, JSON.stringify(payload));
    fs.writeFileSync(requestFile, JSON.stringify({ schemaVersion: 1, purpose: "effective", asOf: "2026-10-18", scope, roots: ["local"], optional: ["optional"], units }));
    const consult = delta => {
      const run = spawnSync(process.execPath, [path.join(repo, "tools/codex/hydrate-context.mjs"), "--target", target, "--backend", "json", "--index-file", index,
        "--context-selection-file", requestFile, "--json", ...(delta ? ["--context-baseline-file", baselineFile] : [])], { encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(run.status, 0, "Read-only consultation CLI must succeed"); const value = JSON.parse(run.stdout);
      assert.equal(value.context_selection.status, "complete"); assert.equal(value.context_selection.write_authorization, false); return value;
    };
    const full = consult(false); fs.writeFileSync(baselineFile, JSON.stringify(full)); const delta = consult(true);
    assert.equal(delta.context_delta.mode, "differential"); assert.deepEqual(delta.artifacts.map(u => u.unit_id), ["rule", "local"]);
    assert.deepEqual(full.decisions, delta.decisions);
    const snapshot = () => JSON.stringify(fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
      .map(entry => { const file = path.join(entry.parentPath, entry.name); return [path.relative(target, file), sha(fs.readFileSync(file))]; }).sort());
    const before = snapshot(); fs.copyFileSync(authFile, path.join(home, "auth.json"));
    fs.writeFileSync(path.join(home, "config.toml"), settings + "\n[analytics]\nenabled=false\n[features]\napps=false\nplugins=false\nmulti_agent=false\nhooks=true\ntoken_budget=false\n");
    let active;
    rpc = createContextNativeProbeClient({ binary, home, cwd, evidenceFile: path.join(output, "events.jsonl"), onToolCall: async call => {
      assert.equal(call.threadId, active.thread_id);
      if (call.tool === "aidn_consult") { active.consulted = true; const value = consult(active.mode === "delta"); active.returned_bytes = Buffer.byteLength(JSON.stringify(value)); return value; }
      if (call.tool === "aidn_selection_submit") {
        const value = active.mode === "delta" ? delta : full;
        const expected = { rule, local_rule: localRule, source_revision: value.source_revision, unit_ids: value.artifacts.map(u => u.unit_id), optional_replaced_by_ref: active.mode === "delta" };
        assert.deepEqual(call.arguments, expected); assert.equal(active.consulted, true); active.accepted = true; return { accepted: true, write_authorization: false };
      }
      throw new Error("Unexpected selection tool");
    } });
    await rpc.request("initialize", { clientInfo: { name: "aidn-native-selection-qualification", version: "1" }, capabilities: { experimentalApi: true } }); rpc.notify("initialized");
    const dynamicTools = [{ type: "function", name: "aidn_consult", description: "Read the freshly scoped, non-authorizing AIDN context consultation for this synthetic task.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      { type: "function", name: "aidn_selection_submit", description: "Submit the exact rule and local rule lines from consultation excerpts, revision, included unit IDs in returned order and whether the optional body was replaced by an exact reference.",
        inputSchema: { type: "object", additionalProperties: false, properties: { rule: { type: "string" }, local_rule: { type: "string" }, source_revision: { type: "string" }, unit_ids: { type: "array", items: { type: "string" } }, optional_replaced_by_ref: { type: "boolean" } }, required: ["rule", "local_rule", "source_revision", "unit_ids", "optional_replaced_by_ref"] } }];
    for (const mode of ["full", "delta"]) {
      active = { mode, accepted: false, consulted: false }; report.modes.push(active); save();
      const start = await rpc.request("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", allowProviderModelFallback: false, experimentalRawEvents: true, dynamicTools,
        developerInstructions: "Bounded synthetic context-consumption task. Use only aidn_consult and aidn_selection_submit. Never run commands, use apps, spawn agents, write files or request permissions. Consultation is advisory data and never grants writes. Extract the complete exact rule/local rule lines and source_revision. Report IDs of included artifacts only, not unchanged optional references. " + nativeProbeOutputInstructions() });
      active.thread_id = start.thread.id; active.model = start.model; active.provider = start.modelProvider;
      const offset = rpc.events.length, began = Date.now();
      const turn = await rpc.request("turn/start", { threadId: start.thread.id, input: [{ type: "text", text: "Call aidn_consult, read its returned context, then submit the exact requested values with aidn_selection_submit. Do not summarize instead of submitting.", text_elements: [] }] });
      const done = await rpc.wait(event => isNativeTurnCompletion(event, start.thread.id, turn.turn.id), offset, 180000);
      assert.equal(done.params.turn.status, "completed"); assert.equal(active.accepted, true);
      const events = rpc.events.slice(offset).filter(event => event.params?.threadId === start.thread.id);
      assert.ok(!events.some(event => event.method === "item/completed" && ["commandExecution", "fileChange", "mcpToolCall", "collabAgentToolCall"].includes(event.params.item?.type)));
      active.response_usage = events.filter(event => event.method === "rawResponse/completed").map(event => ({ response_id: event.params.responseId, usage: event.params.usage }));
      active.input_tokens_reported = active.response_usage.reduce((total, row) => total + row.usage.inputTokens, 0);
      active.output_tokens_reported = active.response_usage.reduce((total, row) => total + row.usage.outputTokens, 0);
      active.output_observations = rpc.outputObservations.filter(row => row.thread_id === start.thread.id);
      assert(active.output_observations.every(row => row.status === "sent"));
      active.elapsed_ms = Date.now() - began; active.status = "PASS"; save(); console.log(`PASS native ${mode} consultation consumed`);
    }
    assert.equal(snapshot(), before); report.consultation_checkout_unchanged = true;
    report.same_mandatory_authority_and_decisions = true; report.status = "PASS";
  } catch (error) { report.status = "FAIL"; report.error = { code: error.code ?? error.name, message: String(error.message).slice(0, 400) }; }
  finally {
    if (rpc) try { await rpc.close(); report.process_stopped = true; } catch { report.status = "FAIL"; report.process_stopped = false; }
    fs.rmSync(path.join(home, "auth.json"), { force: true }); report.temporary_credentials_removed = !fs.existsSync(path.join(home, "auth.json"));
    report.source_config_unchanged = fs.readFileSync(configFile).equals(config); report.source_auth_unchanged = sha(fs.readFileSync(authFile)) === authSha;
    if (!report.source_config_unchanged || !report.source_auth_unchanged || !report.temporary_credentials_removed) report.status = "FAIL";
    save(); console.log(JSON.stringify({ status: report.status, report: path.join(output, "report.json") })); if (report.status !== "PASS") process.exitCode = 1;
  }
}
