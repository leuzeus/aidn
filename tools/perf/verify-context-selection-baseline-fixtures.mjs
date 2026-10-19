#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { compactAdmission } from "../../scaffold/codex_hooks/scripts/aidn-hook-runtime.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const corpusFile = path.join(repoRoot, "tests/fixtures/context-selection-baseline/corpus.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function inventory(root) {
  const entries = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      entries[relative] = entry.isDirectory() ? "directory" : hash(fs.readFileSync(absolute));
      if (entry.isDirectory()) visit(absolute);
    }
  }
  visit(root);
  return entries;
}

function artifact(relative, content, extra = {}) {
  return {
    artifact_id: relative,
    path: relative,
    kind: "other",
    content,
    content_format: "utf8",
    size_bytes: Buffer.byteLength(content, "utf8"),
    sha256: hash(content),
    ...extra,
  };
}

async function main() {
  const checks = [];
  const output = { status: "FAIL", checks, observations: {} };
  let tempRoot;
  let stage = "load-corpus";
  let cleanup;
  function check(name, observed, expected = true) {
    const pass = JSON.stringify(observed) === JSON.stringify(expected);
    checks.push({ name, expected, observed, pass });
    if (!pass) throw new Error(`Named assertion failed: ${name}`);
  }
  try {
    const corpusBytes = fs.readFileSync(corpusFile);
    const corpus = JSON.parse(corpusBytes);
    output.corpus_sha256 = hash(corpusBytes);
    output.baseline_reference = corpus.baseline_reference;
    output.observation_scope = corpus.scope;
    output.node = process.version;
    output.native_model_tokens = "UNAVAILABLE";
    output.native_hook_execution = "UNAVAILABLE";
    output.task_selection_qualification = "NOT_EVALUATED";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-context-baseline-"));
    const indexFile = path.join(tempRoot, "index.json");
    const staleCache = path.join(tempRoot, "hydrated-context.json");
    fs.writeFileSync(staleCache, JSON.stringify({ stale_fixture_only: true, artifacts: [{ path: "stale.md" }] }));
    const spec = "# Synthetic SPEC\n" + corpus.padding_line.repeat(corpus.padding_repetitions) + corpus.mandatory_unit;
    const payload = {
      generated_at: "2026-10-02T00:00:00Z",
      schema_version: 1,
      cycles: corpus.cycles,
      artifacts: [
        artifact("SPEC.md", spec),
        ...corpus.cycles.map((cycle) => artifact(
          `cycles/${cycle.cycle_id}/status.md`,
          `# Synthetic cycle ${cycle.cycle_id}\nFixture worktree: ${cycle.fixture_worktree}\n`,
          { cycle_id: cycle.cycle_id },
        )),
      ],
      artifact_links: [], session_cycle_links: [], session_links: [], migration_findings: [],
    };
    fs.writeFileSync(indexFile, JSON.stringify(payload));
    const hookContextStore = { readContext: () => ({ exists: false, context_file: null }) };
    const args = {
      contextFile: "", out: "", skill: "context-reload", historyLimit: 20,
      includeArtifacts: true, indexFile, backend: "json", maxArtifactBytes: 4096,
      maxArtifacts: 24, bundleTargetBytes: 262144, bundleHardLimitBytes: 1048576,
    };
    const hydrate = (overrides = {}) => runHydrateContextUseCase({
      targetRoot: tempRoot, hookContextStore, args: { ...args, ...overrides },
    });
    stage = "read-only-hydration";
    const before = inventory(tempRoot);
    const timings = [];
    let hydrated;
    let revision;
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const started = performance.now();
      hydrated = await hydrate();
      timings.push({ repetition, duration_ms: performance.now() - started });
      if (revision) check(`repeat_${repetition}_stable_revision`, hydrated.source_revision, revision);
      revision = hydrated.source_revision;
    }
    check("read_only_files_unchanged", inventory(tempRoot), before);
    check("derived_output_not_written", !Object.hasOwn(hydrated, "output_file"));
    check("source_revision_present", /^[a-f0-9]{64}$/.test(revision));
    check("source_backend_explicit", hydrated.source_backend, "json");
    check("selection_count_matches", hydrated.bundle_budget.selected_count, hydrated.artifacts.length);
    check("selection_reasons_present", hydrated.artifacts.every((row) => row.selection_reasons.length > 0));
    const selectedSpec = hydrated.artifacts.find((row) => row.path === "SPEC.md");
    check("spec_selected", Boolean(selectedSpec));
    check("source_hash_retained", selectedSpec.sha256, hash(spec));
    check("source_size_retained", selectedSpec.size_bytes, Buffer.byteLength(spec, "utf8"));
    check("late_unit_outside_prefix", Buffer.byteLength(spec.slice(0, spec.indexOf(corpus.mandatory_unit)), "utf8") > args.maxArtifactBytes);
    check("truncation_visible", selectedSpec.content_state, "truncated");
    check("excerpt_bounded", selectedSpec.excerpt_bytes <= args.maxArtifactBytes);
    check("excerpt_matches_source_prefix", spec.startsWith(selectedSpec.content_excerpt));
    output.observations.hydration = {
      complete_service_json_bytes: jsonBytes(hydrated),
      formatted_service_json_bytes: Buffer.byteLength(JSON.stringify(hydrated, null, 2) + "\n", "utf8"),
      reported_artifact_budget_bytes: hydrated.bundle_budget.total_bytes,
      complete_late_unit_present: selectedSpec.content_excerpt.includes(corpus.mandatory_unit),
      selected_cycles: hydrated.artifacts.filter((row) => row.cycle_id).map((row) => row.cycle_id),
      scope_labels_are_synthetic: true,
      requested_task_or_worktree_filter: "UNAVAILABLE",
      timings,
    };

    stage = "bounded-selection-and-missing-index";
    const limited = await hydrate({ maxArtifacts: 1 });
    check("artifact_limit_honored", limited.artifacts.length, 1);
    check("omissions_visible", limited.bundle_budget.omitted_count > 0);
    const missing = await hydrate({ indexFile: path.join(tempRoot, "absent.json") });
    check("missing_index_no_cached_artifacts", missing.artifacts, []);
    check("missing_index_no_invented_source", missing.artifact_source, null);
    check("bounded_and_missing_reads_unchanged", inventory(tempRoot), before);

    stage = "changed-source-revision";
    // Deliberately change this owned input, after the read-only assertions.
    payload.artifacts[0] = artifact("SPEC.md", spec + "\nSynthetic source revision two.\n");
    fs.writeFileSync(indexFile, JSON.stringify(payload));
    const changedBefore = inventory(tempRoot);
    const changed = await hydrate();
    check("changed_selected_source_changes_revision", changed.source_revision !== revision);
    check("changed_source_read_unchanged", inventory(tempRoot), changedBefore);

    stage = "compact-admission";
    const compactFixture = corpus.compact_admission;
    const admission = {
      ok: compactFixture.ok,
      admission_status: compactFixture.admission_status,
      context: { ...compactFixture.context, first_plan_step: compactFixture.long_step_prefix.repeat(compactFixture.long_step_repetitions) },
      blocking_reasons: Array.from({ length: compactFixture.blocker_count }, (_, index) =>
        `synthetic-blocker-${index}: ` + "synthetic detail; ".repeat(compactFixture.long_blocker_repetitions)),
    };
    const admissionBefore = hash(JSON.stringify(admission));
    const compactText = compactAdmission(admission);
    const compact = JSON.parse(compactText);
    check("plausible_compact_admission_parseable", typeof compact === "object");
    check("compact_admission_still_blocked", compact.admission, admission.admission_status);
    check("compact_retains_read_only_instruction", compact.next_action.startsWith("Remain read-only;"));
    check("compact_text_bounded_in_characters", compactText.length <= 2400);
    check("formatter_input_unchanged", hash(JSON.stringify(admission)), admissionBefore);
    const stressContext = Object.fromEntries(Object.keys(admission.context).map((key) => [key, "x".repeat(181)]));
    const stressText = compactAdmission({ ...admission, context: stressContext });
    check("stress_compact_text_bounded_in_characters", stressText.length <= 2400);
    let stressParseable = true;
    try { JSON.parse(stressText); } catch { stressParseable = false; }
    output.observations.compact_admission = {
      plausible_input: {
        characters: compactText.length, utf8_bytes: Buffer.byteLength(compactText, "utf8"),
        input_blockers: admission.blocking_reasons.length, presented_blockers: compact.blocking_reasons.length,
        first_plan_step_complete: compact.context.first_plan_step === admission.context.first_plan_step,
        explicit_omission_marker: /truncat|omitt/i.test(compactText),
      },
      unvalidated_stress_input: { characters: stressText.length, json_parseable: stressParseable },
      output_is_additional_context_text: true,
      validated_native_admission: "UNAVAILABLE",
    };

    stage = "routing-inventory";
    const routingAssets = corpus.routing_assets.map((relative) => {
      const content = fs.readFileSync(path.join(repoRoot, relative));
      return { path: relative, utf8_bytes: content.length, sha256: hash(content),
        mentioned_anchors: corpus.routing_anchors.filter((anchor) => content.toString("utf8").includes(anchor)) };
    });
    output.observations.routing = { assets: routingAssets,
      total_asset_bytes: routingAssets.reduce((sum, row) => sum + row.utf8_bytes, 0),
      actual_model_reads: "UNAVAILABLE", actual_model_tokens: "UNAVAILABLE" };
    check("corpus_unchanged", hash(fs.readFileSync(corpusFile)), output.corpus_sha256);
    output.status = "PASS";
  } catch (error) {
    output.status = "FAIL";
    output.failure = { stage, message: error.message };
  } finally {
    if (tempRoot) cleanup = removePathWithRetry(tempRoot);
    output.cleanup = { temporary_root_removed: Boolean(cleanup?.ok && !fs.existsSync(tempRoot)), attempts: cleanup?.attempts ?? 0 };
    if (tempRoot && !output.cleanup.temporary_root_removed) {
      output.status = "FAIL";
      output.cleanup.error = "Fixture temporary root could not be removed";
    }
  }
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== "PASS") process.exitCode = 1;
}

await main();
