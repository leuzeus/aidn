import fs from "node:fs";
import path from "node:path";
import { resolveActivationTarget, planAuthorization, applyAuthorization } from "../../src/application/install/project-activation-service.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Neutral install/activation evidence on a disposable target, never executed as
// hooks or substituted for native qualification.
export function activateWorkflowConsoleFixture(targetRoot, packageRoot) {
  const put = (base, name, text) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  fs.mkdirSync(targetRoot, { recursive: true }); put(packageRoot, "VERSION", "0.11.0\n"); put(packageRoot, "bin/aidn.mjs", "// neutral fixture, never executed\n");
  applyAuthorization(planAuthorization({ targetRoot, action: "authorize" }));
  const identity = resolveActivationTarget({ targetRoot }), assets = {};
  for (const name of [".codex/hooks/aidn-hook-runtime.mjs", ".codex/hooks/aidn-session-start.mjs", ".codex/hooks/aidn-pre-tool-use.mjs", ".agents/skills/context-reload/SKILL.md", ".agents/skills/start-session/SKILL.md"]) {
    const text = "Neutral fixture\n"; put(targetRoot, name, text); assets[name] = { kind: "file", current: Buffer.from(text).toString("base64") };
  }
  const block = "<!-- CODEX-AUDIT-WORKFLOW START -->\nNeutral fixture\n<!-- CODEX-AUDIT-WORKFLOW END -->";
  put(targetRoot, "AGENTS.md", block); assets["AGENTS.md"] = { kind: "agents-block", current: block };
  const hooks = ["SessionStart", "PreToolUse"].map(event => ({ event, group: { matcher: "fixture" }, hook: { type: "command", command: "echo fixture" } }));
  put(targetRoot, ".codex/hooks.json", JSON.stringify({ hooks: Object.fromEntries(hooks.map(h => [h.event, [{ ...h.group, hooks: [h.hook] }]])) })); assets[".codex/hooks.json"] = { kind: "hooks", current: hooks };
  const receipt = { schema_version: 1, scope: "codex-integration", root_id: identity.root_id,
    package: { root: packageRoot, version: "0.11.0", entry: "bin/aidn.mjs", entry_sha256: artifactContentHash(fs.readFileSync(path.join(packageRoot, "bin/aidn.mjs"), "utf8")), version_sha256: artifactContentHash("0.11.0\n") },
    assets, last_transaction: "a".repeat(32), last_action: "install", activation: { mode: identity.scope, authority_id: identity.authority_id } };
  const tx = { schema_version: 1, id: receipt.last_transaction, scope: "codex-integration", root_id: identity.root_id, status: "complete", operations: [], receipt_after: receipt };
  const seal = value => JSON.stringify({ ...value, integrity_sha256: shadowHash(value) });
  put(targetRoot, `.aidn/install/transactions/${tx.id}.json`, seal(tx)); put(targetRoot, ".aidn/install/receipt.json", seal(receipt));
}
