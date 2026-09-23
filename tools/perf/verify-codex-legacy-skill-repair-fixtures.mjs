#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { classifyHistoricalCodexSkill } from "../../src/application/install/codex-legacy-repairs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const asset = ".agents/skills/pr-orchestrate/SKILL.md";
const fixture = path.join(root, "tests/fixtures/codex-legacy/v0.5.0-rc.1/pr-orchestrate/SKILL.md");
const historical = fs.readFileSync(fixture, "utf8").replace(/\r\n/g, "\n");
const current = fs.readFileSync(path.join(root, "scaffold/codex/pr-orchestrate/SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const ledger = JSON.parse(fs.readFileSync(path.join(root, "src/application/install/codex-legacy-fingerprints.v1.json"), "utf8"));
const entry = ledger.repairs.find((item) => item.asset === asset);
const hash = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const frontmatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1];
const body = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
const checks = [];
try {
  assert.equal(hash(historical), "b8ba7f40a0e5e1524a277652aef0fa940a19ca292c4ee2cb70633851fb501bfa");
  assert.equal(hash(current), entry.repaired_hash);
  assert.equal(entry.source_tag, "v0.5.0-rc.1");
  assert.equal(entry.source_commit, "6882bfd1b7ce35e4e1d1bf1ba9d44348341f0032");
  assert.equal(entry.source_blob, "7dfef7e2febadd50c8685208d1b785cccd81049c");
  assert.equal(entry.fix_commit, "ad598b4a7896b9ea26dd057b5295d9a170e8782c");
  assert(parseDocument(frontmatter(historical)).errors.length > 0, "historical shipped frontmatter must reproduce the YAML defect");
  checks.push("git-derived-fixture-hash-and-original-yaml-defect");

  for (const assetPath of [asset, ".codex/skills/pr-orchestrate/SKILL.md"]) {
    for (const [label, input] of [["lf", historical], ["crlf", historical.replace(/\n/g, "\r\n")],
      ["mixed-eol", historical.replace("name: pr-orchestrate\n", "name: pr-orchestrate\r\n")]]) {
      const result = classifyHistoricalCodexSkill({ relativePath: assetPath, text: input });
      assert.equal(result.action, "repair");
      assert.equal(result.current_hash, entry.historical_hash);
      assert.equal(result.historical_hash, entry.historical_hash);
      assert.equal(result.repaired_hash, entry.repaired_hash);
      assert.equal(result.provenance.source_commit, entry.source_commit);
      assert.equal(result.replacementText.length, input.length + 2, "only two quote characters may be added");
      assert.equal(body(result.replacementText), body(input), "Markdown body must be byte-identical");
      assert.equal((result.replacementText.match(/\r\n/g) ?? []).length, (input.match(/\r\n/g) ?? []).length);
      const yaml = parseDocument(frontmatter(result.replacementText));
      assert.equal(yaml.errors.length, 0);
      assert.deepEqual(yaml.toJS(), { name: "pr-orchestrate", description: entry.description });
      assert.equal(hash(result.replacementText), entry.repaired_hash);
      assert.equal(classifyHistoricalCodexSkill({ relativePath: assetPath, text: result.replacementText }).action, "none");
      checks.push(`${assetPath}: exact-repair-preserves-body-and-${label}-then-idempotent`);
    }
    const customized = [historical + "\nUser rule.\n", historical.replace("## Goal", "## Client Goal"),
      historical.replace(entry.description, "Custom: description"), historical.replace("name: pr-orchestrate", "name: client-pr"),
      "\uFEFF" + historical, historical.slice(0, -1), current + "\nUser rule.\n"];
    for (const text of customized) {
      const result = classifyHistoricalCodexSkill({ relativePath: assetPath, text });
      assert.equal(result.action, "conflict");
      assert.equal(result.replacementText, null);
      assert.equal(result.provenance, null, "unknown content has no asserted historical provenance");
    }
    for (const unrelated of [".agents/skills/other/SKILL.md", ".codex/skills/other/SKILL.md", "custom/.codex/skills/pr-orchestrate/SKILL.md", "../.codex/skills/pr-orchestrate/SKILL.md"]) {
      assert.equal(classifyHistoricalCodexSkill({ relativePath: unrelated, text: historical }).action, "not_applicable");
    }
    assert.equal(classifyHistoricalCodexSkill({ relativePath: assetPath, text: null }).action, "not_applicable");
    checks.push(`${assetPath}: custom-unknown-bom-and-unrelated-content-never-rewritten`);
  }
  assert.equal(fs.readFileSync(fixture, "utf8").replace(/\r\n/g, "\n"), historical, "classification must not write the source fixture");
  console.log(JSON.stringify({ status: "PASS", proof_class: "historical-package-fixture", checks, fixture_mutated: false, llm_calls: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", checks, error: error.message }, null, 2));
  process.exitCode = 1;
}
