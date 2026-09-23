import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as policy from "../../src/core/skills/skill-policy.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
try {
  const directory = path.join(root, "scaffold/codex");
  const deployed = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, "SKILL.md")));
  assert.equal(deployed.length, 13);
  for (const entry of deployed) assert.ok(entry.name.startsWith("aidn-"), `unprefixed skill collides with an unprefixed host homonym: ${entry.name}`);
  const { parse } = await import("yaml");
  for (const entry of deployed) {
    assert.ok(entry.name.startsWith("aidn-"), `unprefixed skill collides with an unprefixed host homonym: ${entry.name}`);
    const text = fs.readFileSync(path.join(directory, entry.name, "SKILL.md"), "utf8");
    const frontmatter = parse(text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "");
    assert.equal(frontmatter.name, entry.name, `public discovery name must match folder: ${entry.name}`);
  }
  checks.push("thirteen_namespaced_skills_avoid_unprefixed_host_name_collisions");
  assert.equal(policy.SKILL_IDENTITIES.length, 13);
  assert.equal(new Set(policy.SKILL_IDENTITIES.map((skill) => skill.id)).size, 13);
  assert.equal(new Set(policy.SKILL_IDENTITIES.map((skill) => skill.publicName)).size, 13);
  const manifest = parse(fs.readFileSync(path.join(directory, "skills.yaml"), "utf8"));
  assert.deepEqual([...manifest.skills].sort(), policy.SKILL_IDENTITIES.map((skill) => skill.publicName).sort());
  for (const skill of policy.SKILL_IDENTITIES) {
    assert.equal(policy.resolveSkillId(skill.publicName), skill.id);
    assert.equal(policy.resolveSkillId(skill.id), skill.id);
    assert.equal(policy.getPublicSkillName(skill.id), skill.publicName);
    assert.ok(manifest.install_urls.some((url) => url.endsWith(`/scaffold/codex/${skill.publicName}`)));
    assert.equal(fs.existsSync(path.join(directory, skill.id)), false, `legacy skill entrypoint duplicated: ${skill.id}`);
    if (policy.SKILL_ROUTES[skill.id]) {
      assert.deepEqual(policy.getSkillRoute(skill.publicName), policy.getSkillRoute(skill.id));
      assert.equal(policy.shouldAutoDbSyncForSkill(skill.publicName), policy.shouldAutoDbSyncForSkill(skill.id));
    }
  }
  assert.equal(policy.resolveSkillId("not-an-aidn-skill"), null);
  checks.push("single_identity_table_preserves_internal_routes_and_public_aliases");
  console.log(JSON.stringify({ ok: true, status: "PASS", checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, status: "FAIL", checks, error: error.message }, null, 2));
  process.exitCode = 1;
}