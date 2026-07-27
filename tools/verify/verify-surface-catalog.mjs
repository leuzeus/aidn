#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  listCliEffectPolicies,
  listEffectClasses,
} from "../../src/core/cli/effect-policy.mjs";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";
import {
  buildSurfaceCatalog,
  INFORMATION_CLASSES,
  parserOptionsFor,
  PROOF_CLASSES,
  resolveEffectClassFromProfile,
  SURFACE_CATALOG_PATH,
  SURFACE_STATUSES,
} from "../governance/surface-catalog-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const requiredFields = [
  "owner",
  "source",
  "entrypoint",
  "implementation",
  "effects",
  "consumer",
  "docs",
  "proof",
  "replacement",
  "migration",
];

function exists(relativePath) {
  return Boolean(relativePath) && fs.existsSync(path.resolve(repoRoot, relativePath));
}

function trackedFileMode(relativePath) {
  const result = spawnSync("git", ["ls-files", "--stage", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  const match = String(result.stdout ?? "").trim().match(/^([0-9]{6})\s/);
  return {
    ok: result.status === 0 && Boolean(match),
    exit_code: result.status,
    mode: match?.[1] ?? null,
  };
}

function commandReferenceIssues(catalog) {
  const issues = [];
  const commands = new Set(
    catalog.entries
      .filter((entry) => entry.kind === "command" && entry.status === "active")
      .map((entry) => entry.entrypoint),
  );
  const knownTopCommands = new Set([...commands].map((command) => command.split(" ").slice(0, 2).join(" ")));
  const groupedTopCommands = new Set(["aidn perf", "aidn codex", "aidn runtime", "aidn project"]);
  for (const relativeDoc of catalog.public_docs) {
    const text = fs.readFileSync(path.join(repoRoot, relativeDoc), "utf8");
    for (const match of text.matchAll(/(?:npx\s+)?aidn\s+([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/g)) {
      const top = `aidn ${match[1]}`;
      if (!knownTopCommands.has(top)) {
        continue;
      }
      const family = groupedTopCommands.has(top) && match[2] && !match[2].startsWith("-")
        ? `${top} ${match[2]}`
        : top;
      if (![...commands].some((command) => command === family || command.startsWith(`${family} `))) {
        issues.push(`${relativeDoc}: public command reference has no active target: ${family}`);
      }
    }
  }
  return issues;
}

function parserClosureIssues(catalog) {
  const issues = [];
  const activeCommands = catalog.entries.filter(
    (entry) => entry.kind === "command" && entry.status === "active",
  );
  const activeOptions = catalog.entries.filter(
    (entry) => entry.kind === "option" && entry.status === "active",
  );
  const optionTokensByCommand = new Map();
  for (const option of activeOptions) {
    const commandId = option.id.slice("option:".length, option.id.lastIndexOf(":"));
    const token = option.id.slice(option.id.lastIndexOf(":") + 1);
    const current = optionTokensByCommand.get(commandId) ?? [];
    current.push(token);
    optionTokensByCommand.set(commandId, current);
  }
  for (const command of activeCommands) {
    if (command.implementation === "bin/aidn.mjs") {
      continue;
    }
    const parserOptions = parserOptionsFor(path.resolve(repoRoot, command.implementation));
    const catalogOptions = (optionTokensByCommand.get(command.entrypoint) ?? []).sort();
    if (JSON.stringify(catalogOptions) !== JSON.stringify(parserOptions)) {
      issues.push(
        `${command.entrypoint}: parser/catalog option closure mismatch `
        + `(parser=${parserOptions.join(",")}; catalog=${catalogOptions.join(",")})`,
      );
    }
  }

  const childOnlyTokens = ["--format", "--name-only", "--porcelain", "--untracked-files"];
  for (const token of childOnlyTokens) {
    if (activeOptions.some((entry) => entry.id.endsWith(`:${token}`))) {
      issues.push(`child-process option leaked into the public catalog: ${token}`);
    }
  }

  const implementations = [...new Set(activeCommands.map((entry) => entry.implementation))];
  for (const implementation of implementations) {
    const result = spawnSync(
      process.execPath,
      [path.resolve(repoRoot, implementation), "--aidn-catalog-invalid-option"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.status === 0) {
      issues.push(`${implementation}: effective parser accepted an uncatalogued option`);
    }
  }
  return issues;
}

function semanticEffectIssues(catalog) {
  const issues = [];
  const effectClasses = new Set(listEffectClasses());
  const publicCommands = new Map(
    catalog.entries
      .filter((entry) => entry.kind === "command"
        && entry.status === "active"
        && entry.visibility === "public")
      .map((entry) => [entry.entrypoint, entry]),
  );
  for (const entry of catalog.entries) {
    if (JSON.stringify(entry.effects).includes("unclassified-internal")) {
      issues.push(`${entry.id}: forbidden unclassified effect sentinel`);
    }
  }
  for (const command of publicCommands.values()) {
    const profile = command.effects;
    if (!profile || typeof profile !== "object" || !effectClasses.has(profile.default)) {
      issues.push(`${command.entrypoint}: public command lacks an exact default effect class`);
      continue;
    }
    for (const variant of profile.variants ?? []) {
      if (!effectClasses.has(variant.effect_class)
        || !Array.isArray(variant.when_args)
        || variant.when_args.length === 0
        || !variant.policy) {
        issues.push(`${command.entrypoint}: malformed conditional effect variant`);
      }
    }
  }
  for (const policy of listCliEffectPolicies()) {
    const command = publicCommands.get(policy.surface);
    if (!command) {
      issues.push(`${policy.id}: public effect policy has no exact catalogued surface ${policy.surface}`);
      continue;
    }
    let resolved = "";
    try {
      resolved = resolveEffectClassFromProfile(command.effects, policy.safe_args);
    } catch (error) {
      issues.push(`${policy.id}: ${error.message}`);
      continue;
    }
    if (resolved !== policy.effect_class) {
      issues.push(
        `${policy.id}: semantic effect mismatch for safe_args `
        + `(policy=${policy.effect_class}; resolved=${resolved})`,
      );
    }
  }
  return issues;
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("bootstrap probe did not emit JSON");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function runBootstrapEffectProbes(catalog) {
  const command = catalog.entries.find((entry) => entry.id === "command:aidn bootstrap");
  if (!command) {
    throw new Error("bootstrap command is absent from the catalog");
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-bootstrap-effect-probes-"));
  try {
    const dryTarget = path.join(tempRoot, "dry-run-target");
    const dryRun = spawnSync(process.execPath, [
      path.join(repoRoot, "bin", "aidn.mjs"),
      "bootstrap",
      "--target",
      dryTarget,
      "--mode",
      "install",
      "--profile",
      "minimal",
      "--dry-run",
      "--json",
    ], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    const dryPayload = parseJsonOutput(dryRun.stdout);
    const normalTarget = path.join(tempRoot, "normal-target");
    const normal = spawnSync(process.execPath, [
      path.join(repoRoot, "bin", "aidn.mjs"),
      "bootstrap",
      "--target",
      normalTarget,
      "--mode",
      "install",
      "--profile",
      "minimal",
      "--json",
    ], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    const normalPayload = parseJsonOutput(normal.stdout);
    const checks = {
      normal_is_mutating: normalPayload.effect_class === "mutating"
        && resolveEffectClassFromProfile(command.effects, ["--json"]) === "mutating",
      dry_run_is_preview: dryPayload.effect_class === "preview"
        && resolveEffectClassFromProfile(command.effects, ["--dry-run", "--json"]) === "preview",
      json_is_format_only: catalog.entries.find(
        (entry) => entry.id === "option:aidn bootstrap:--json",
      )?.effects === "format-only",
      dry_run_target_unchanged: !fs.existsSync(dryTarget),
      prefix_ambiguity_absent: !catalog.entries.some(
        (entry) => entry.id === "command:aidn bootstrapper",
      ),
    };
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      normal_exit_code: normal.status,
      dry_run_exit_code: dryRun.status,
    };
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }
}

function main() {
  const catalogPath = path.join(repoRoot, SURFACE_CATALOG_PATH);
  const issues = [];
  const cliEntrypointMode = trackedFileMode("bin/aidn.mjs");
  if (!cliEntrypointMode.ok) {
    issues.push("bin/aidn.mjs: unable to resolve tracked Git mode");
  } else if (cliEntrypointMode.mode !== "100755") {
    issues.push(
      `bin/aidn.mjs: package bin entrypoint must be tracked executable `
      + `(100755, got ${cliEntrypointMode.mode})`,
    );
  }
  if (!fs.existsSync(catalogPath)) {
    issues.push(`missing catalog: ${SURFACE_CATALOG_PATH}`);
  }
  const actual = fs.existsSync(catalogPath)
    ? JSON.parse(fs.readFileSync(catalogPath, "utf8"))
    : { entries: [], public_docs: [] };
  const expected = buildSurfaceCatalog(repoRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`catalog drift: run node tools/governance/generate-surface-catalog.mjs --write`);
  }
  const seen = new Set();
  for (const entry of actual.entries ?? []) {
    if (seen.has(entry.id)) {
      issues.push(`${entry.id}: duplicate id`);
    }
    seen.add(entry.id);
    if (!SURFACE_STATUSES.includes(entry.status)) {
      issues.push(`${entry.id}: invalid status ${entry.status}`);
    }
    if (!INFORMATION_CLASSES.includes(entry.information_class)) {
      issues.push(`${entry.id}: invalid information_class ${entry.information_class}`);
    }
    for (const field of requiredFields) {
      if (!(field in entry)) {
        issues.push(`${entry.id}: missing ${field}`);
      }
    }
    if (!PROOF_CLASSES.includes(entry.proof?.class)) {
      issues.push(`${entry.id}: invalid proof class ${entry.proof?.class}`);
    }
    if (!exists(entry.docs)) {
      issues.push(`${entry.id}: docs target missing: ${entry.docs}`);
    }
    if (!exists(entry.proof?.target) || !exists(entry.proof?.gate)) {
      issues.push(`${entry.id}: proof target or gate missing`);
    }
    if (entry.status === "active" && !exists(entry.implementation)) {
      issues.push(`${entry.id}: active implementation missing: ${entry.implementation}`);
    }
    if (["deprecated", "replaced", "removed"].includes(entry.status)
      && (!entry.replacement || !entry.migration)) {
      issues.push(`${entry.id}: non-active surface requires replacement and migration`);
    }
  }
  issues.push(...commandReferenceIssues(actual));
  issues.push(...parserClosureIssues(actual));
  issues.push(...semanticEffectIssues(actual));
  let bootstrapEffectProbes = null;
  try {
    bootstrapEffectProbes = runBootstrapEffectProbes(actual);
    if (!bootstrapEffectProbes.ok) {
      issues.push("bootstrap semantic effect probes failed");
    }
  } catch (error) {
    issues.push(`bootstrap semantic effect probes failed: ${error.message}`);
  }
  const byKind = {};
  for (const entry of actual.entries ?? []) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const result = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    catalog: SURFACE_CATALOG_PATH,
    entries: actual.entries?.length ?? 0,
    by_kind: byKind,
    parser_closure: {
      active_commands: actual.entries?.filter(
        (entry) => entry.kind === "command" && entry.status === "active",
      ).length ?? 0,
      active_options: actual.entries?.filter(
        (entry) => entry.kind === "option" && entry.status === "active",
      ).length ?? 0,
      child_process_options_excluded: ["--format", "--name-only", "--porcelain", "--untracked-files"],
    },
    semantic_effect_closure: {
      public_commands: actual.entries?.filter(
        (entry) => entry.kind === "command"
          && entry.status === "active"
          && entry.visibility === "public",
      ).length ?? 0,
      forbidden_sentinel: "unclassified-internal",
      bootstrap_probes: bootstrapEffectProbes,
    },
    cli_entrypoint_mode: {
      path: "bin/aidn.mjs",
      expected: "100755",
      ...cliEntrypointMode,
    },
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main();
