import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planGlobalSkillsMigration, planRestoreGlobalSkillsMigration } from "../../src/application/install/global-skills-migration-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-global-skills-plan-"));
const checks = [], failures = [];
const text = (op, key) => op[key] === null ? null : Buffer.from(op[key], "base64").toString("utf8");
function put(root, relative, value) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; }
function snapshot(root) { const entries = []; function visit(at) { for (const item of fs.readdirSync(at, { withFileTypes: true })) { const file = path.join(at, item.name); if (item.isDirectory()) visit(file); else entries.push([path.relative(root, file), fs.readFileSync(file).toString("base64")]); } } visit(root); return entries.sort((a,b) => a[0].localeCompare(b[0])); }
function legacy(id) {
  const root = id === "start-session"
    ? "tests/fixtures/codex-legacy/installed-core-0.10.5"
    : "tests/fixtures/repo-installed-core/.agents/skills";
  return fs.readFileSync(path.join(repoRoot, root, id, "SKILL.md"), "utf8");
}
function check(name, fn) { try { fn(); checks.push({ name, status: "PASS" }); } catch (error) { failures.push({ name, message: error.message }); } }
try {
  const home = path.join(tempRoot, "codéx home"), skills = path.join(home, "skills");
  const known = put(skills, "start-session/SKILL.md", legacy("start-session"));
  const homonym = put(skills, "context-reload/SKILL.md", "---\nname: context-reload\ndescription: Reload editor tabs.\n---\nPreserve editor layout.\n");
  const custom = put(skills, "close-session/SKILL.md", legacy("close-session") + "\nA personal extension.\n");
  const thirdParty = 'model = "personal-model" # keep this comment\r\n[mcp_servers.private]\r\ncommand = "personal server"\r\n\r\n[[skills.config]]\r\npath = "/vendor/start-session/SKILL.md"\r\nenabled = true # another skill\r\n';
  const config = put(home, "config.toml", thirdParty);
  let firstPlan;
  check("inventory_is_read_only_and_only_known_aidn_is_selected", () => {
    const before = snapshot(tempRoot);
    firstPlan = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(firstPlan.ok, true, JSON.stringify(firstPlan.conflicts));
    assert.deepEqual(snapshot(tempRoot), before);
    assert.deepEqual(firstPlan.candidates.filter((item) => item.selected).map((item) => item.path), [known]);
    assert.equal(firstPlan.candidates.find((item) => item.path === homonym).classification, "unknown-homonym");
    assert.equal(firstPlan.candidates.find((item) => item.path === custom).classification, "custom-aidn");
    assert.equal(firstPlan.plan_id, planGlobalSkillsMigration({ codexHome: home }).plan_id);
  });
  check("exact_path_disable_preserves_third_party_toml_and_skill_files", () => {
    const op = firstPlan.operations[0];
    assert.equal(text(op, "before"), thirdParty);
    assert.equal(text(op, "after"), thirdParty + `\r\n[[skills.config]]\r\npath = ${JSON.stringify(known)}\r\nenabled = false\r\n`);
    assert.equal(fs.readFileSync(known, "utf8"), legacy("start-session"));
    assert.equal(fs.readFileSync(config, "utf8"), thirdParty);
  });
  check("unknown_or_custom_selected_paths_fail_closed", () => {
    for (const selected of [homonym, custom, path.join(tempRoot, "unrelated/SKILL.md")]) {
      const before = snapshot(tempRoot), plan = planGlobalSkillsMigration({ codexHome: home, selectedPaths: [selected] });
      assert.equal(plan.ok, false); assert.equal(plan.operations.length, 0); assert.deepEqual(snapshot(tempRoot), before);
    }
  });
  check("already_disabled_is_idempotent_and_restoration_preserves_exact_preimage", () => {
    const op = firstPlan.operations[0]; fs.writeFileSync(config, text(op, "after"));
    const second = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(second.ok, true, JSON.stringify(second.conflicts)); assert.equal(second.operations[0].before, second.operations[0].after);
    const before = snapshot(tempRoot), restore = planRestoreGlobalSkillsMigration({ codexHome: home, operation: op });
    assert.equal(restore.ok, true); assert.equal(text(restore.operations[0], "after"), thirdParty); assert.deepEqual(snapshot(tempRoot), before);
  });
  check("restore_refuses_a_later_unrelated_config_edit", () => {
    fs.appendFileSync(config, '\n[analytics]\nenabled = false\n');
    const before = snapshot(tempRoot), restored = planRestoreGlobalSkillsMigration({ codexHome: home, operation: firstPlan.operations[0] });
    assert.equal(restored.ok, false); assert.equal(restored.conflicts[0].code, "GLOBAL_SKILLS_POSTIMAGE_CHANGED"); assert.deepEqual(snapshot(tempRoot), before);
    assert.notEqual(firstPlan.plan_id, planGlobalSkillsMigration({ codexHome: home }).plan_id);
  });
  check("existing_enabled_entry_changes_only_boolean_and_preserves_comments", () => {
    const source = `# début\n[[skills.config]]\npath = ${JSON.stringify(known)} # exact path\nenabled  =  true  # personal note\n\n[projects."/third-party"]\ntrust_level = "untrusted"\n`;
    fs.writeFileSync(config, source);
    const plan = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(plan.ok, true, JSON.stringify(plan.conflicts));
    assert.equal(text(plan.operations[0], "after"), source.replace("enabled  =  true", "enabled  =  false"));
  });
  check("missing_enabled_is_inserted_inside_its_own_table", () => {
    const source = `[[skills.config]]\npath = ${JSON.stringify(known)}\n[analytics]\nenabled = true\n`;
    fs.writeFileSync(config, source); const plan = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(plan.ok, true, JSON.stringify(plan.conflicts));
    assert.equal(text(plan.operations[0], "after"), source.replace("[analytics]", "enabled = false\n[analytics]"));
  });
  check("multiline_string_cannot_forge_a_skill_configuration", () => {
    const source = `note = '''\n[[skills.config]]\npath = ${JSON.stringify(known)}\nenabled = true\n'''\n[analytics]\nenabled = false\n`;
    fs.writeFileSync(config, source); const plan = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(plan.ok, true, JSON.stringify(plan.conflicts)); assert.ok(text(plan.operations[0], "after").startsWith(source));
    assert.equal(text(plan.operations[0], "after").match(/\[\[skills.config\]\]/g).length, 2);
  });
  check("ambiguous_duplicate_or_inline_configuration_is_refused", () => {
    for (const source of [
      `[[skills.config]]\npath = ${JSON.stringify(known)}\nenabled = true\n[[skills.config]]\npath = ${JSON.stringify(known)}\nenabled = false\n`,
      'skills = { config = [] }\n',
      '[skills]\nconfig = []\n',
    ]) {
      fs.writeFileSync(config, source); const before = snapshot(tempRoot), plan = planGlobalSkillsMigration({ codexHome: home });
      assert.equal(plan.ok, false); assert.equal(plan.operations.length, 0); assert.deepEqual(snapshot(tempRoot), before);
    }
  });
  check("missing_config_is_only_planned_and_can_restore_absence", () => {
    fs.unlinkSync(config); const plan = planGlobalSkillsMigration({ codexHome: home });
    assert.equal(plan.ok, true); assert.equal(plan.operations[0].before, null); assert.equal(fs.existsSync(config), false);
    fs.writeFileSync(config, text(plan.operations[0], "after"));
    const restored = planRestoreGlobalSkillsMigration({ codexHome: home, operation: plan.operations[0] });
    assert.equal(restored.ok, true); assert.equal(restored.operations[0].after, null);
  });
  check("skill_content_change_invalidates_plan_without_editing_config", () => {
    const before = planGlobalSkillsMigration({ codexHome: home }); fs.appendFileSync(known, "\nChanged after preview.\n");
    const configBefore = fs.readFileSync(config, "utf8"), after = planGlobalSkillsMigration({ codexHome: home });
    assert.notEqual(before.plan_id, after.plan_id); assert.equal(after.candidates.find((item) => item.path === known).selected, false); assert.equal(fs.readFileSync(config, "utf8"), configBefore);
  });
} finally {
  const resolved = fs.realpathSync(tempRoot), expected = fs.realpathSync(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(expected) && path.basename(resolved).startsWith("aidn-global-skills-plan-"));
  const cleanup = removePathWithRetry(resolved); if (!cleanup.ok) failures.push({ name: "cleanup", message: cleanup.error.message });
}
console.log(JSON.stringify({ ok: failures.length === 0, status: failures.length ? "FAIL" : "PASS", proof_class: "pure-plan-fixture", checks, failures, temp_removed: !fs.existsSync(tempRoot), native_client_execution: "NOT_EXECUTED" }, null, 2));
if (failures.length) process.exitCode = 1;
