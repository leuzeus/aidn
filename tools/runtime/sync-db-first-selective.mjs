#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeStateMode } from "../aidn-config-lib.mjs";
import { resolveStateMode, upsertDbFirstArtifact } from "./db-first-artifact.mjs";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const FULL_SYNC_SCRIPT = path.resolve(RUNTIME_DIR, "sync-db-first.mjs");

function parseArgs(argv) {
  const args = {
    target: ".",
    auditRoot: "docs/audit",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    stateMode: "",
    forceInFiles: false,
    fallbackFull: true,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--force-in-files") {
      args.forceInFiles = true;
    } else if (token === "--no-fallback-full") {
      args.fallbackFull = false;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (args.stateMode && !normalizeStateMode(args.stateMode)) {
    throw new Error("Invalid --state-mode. Expected files|dual|db-only");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/sync-db-first-selective.mjs --target . --json");
  console.log("  node tools/runtime/sync-db-first-selective.mjs --target . --state-mode dual --json");
}

function parseGitPath(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parsePorcelainLine(line) {
  if (!line || line.length < 4) {
    return null;
  }
  const status = line.slice(0, 2);
  const body = line.slice(3);
  if (!body) {
    return null;
  }
  const renameIdx = body.indexOf(" -> ");
  if (renameIdx >= 0) {
    const nextPath = body.slice(renameIdx + 4);
    return {
      path: parseGitPath(nextPath),
      status,
    };
  }
  return {
    path: parseGitPath(body),
    status,
  };
}

function readChangedAuditPaths(targetRoot, auditRoot) {
  const stdout = execFileSync("git", [
    "-C",
    targetRoot,
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    auditRoot,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const out = [];
  let requiresFullSync = false;
  for (const line of lines) {
    const parsed = parsePorcelainLine(line);
    if (parsed?.path) {
      out.push(parsed.path.replace(/\\/g, "/"));
      const status = String(parsed.status ?? "");
      if (/[DR]/.test(status)) {
        requiresFullSync = true;
      }
    }
  }
  return {
    changedPaths: Array.from(new Set(out)),
    requiresFullSync,
  };
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty stdout");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Invalid JSON output");
  }
}

function runFullSync(targetRoot, stateMode) {
  const stdout = execFileSync(process.execPath, [
    FULL_SYNC_SCRIPT,
    "--target",
    targetRoot,
    "--state-mode",
    stateMode,
    "--json",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonOutput(stdout);
}

function main() {
  let outputJson = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    outputJson = args.json;
    const targetRoot = path.resolve(process.cwd(), args.target);
    const stateMode = resolveStateMode(targetRoot, args.stateMode);
    const strictByState = stateMode === "dual" || stateMode === "db-only";
    const strict = args.strict || strictByState;

    if (stateMode === "files" && !args.forceInFiles) {
      const out = {
        ts: new Date().toISOString(),
        ok: true,
        skipped: true,
        reason: "state_mode_files",
        target_root: targetRoot,
        state_mode: stateMode,
        strict,
      };
      if (args.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log("Selective DB sync skipped (state_mode=files).");
      }
      return;
    }

    const auditRoot = String(args.auditRoot).replace(/\\/g, "/");
    let changedPaths = [];
    let requiresFullSync = false;
    let gitAvailable = true;
    try {
      const changed = readChangedAuditPaths(targetRoot, auditRoot);
      changedPaths = changed.changedPaths;
      requiresFullSync = changed.requiresFullSync;
    } catch (error) {
      gitAvailable = false;
      if (!args.fallbackFull) {
        throw error;
      }
    }

    const summary = {
      changed_paths_count: changedPaths.length,
      candidates_count: 0,
      synced_count: 0,
      skipped_missing_count: 0,
      failed_count: 0,
    };
    const synced = [];
    const errors = [];

    if (gitAvailable) {
      const auditRootAbs = path.resolve(targetRoot, auditRoot);
      for (const relRepo of changedPaths) {
        const absolute = path.resolve(targetRoot, relRepo);
        if (!absolute.startsWith(auditRootAbs)) {
          continue;
        }
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
          summary.skipped_missing_count += 1;
          continue;
        }
        const relAudit = path.relative(auditRootAbs, absolute).replace(/\\/g, "/");
        summary.candidates_count += 1;
        try {
          const out = upsertDbFirstArtifact({
            target: targetRoot,
            path: relAudit,
            sourceFile: absolute,
            stateMode,
            sqliteFile: args.sqliteFile,
            materialize: "false",
          });
          summary.synced_count += 1;
          synced.push({
            path: relAudit,
            sha256: out.artifact?.sha256 ?? null,
            size_bytes: out.artifact?.size_bytes ?? null,
          });
        } catch (error) {
          summary.failed_count += 1;
          errors.push({
            path: relAudit,
            message: String(error.message ?? error),
          });
        }
      }
    }

    let fallback = null;
    const shouldFallback = args.fallbackFull
      && (!gitAvailable || summary.failed_count > 0 || requiresFullSync);
    if (shouldFallback) {
      fallback = runFullSync(targetRoot, stateMode);
    }

    const ok = summary.failed_count === 0 && (fallback == null || fallback.ok !== false);
    const out = {
      ts: new Date().toISOString(),
      ok,
      target_root: targetRoot,
      state_mode: stateMode,
      strict,
      git_available: gitAvailable,
      fallback_full_enabled: args.fallbackFull,
      fallback_full_used: fallback != null,
      fallback_full_reason: fallback != null
        ? (!gitAvailable ? "git_unavailable" : (summary.failed_count > 0 ? "selective_failed" : "git_status_requires_full"))
        : null,
      summary,
      synced,
      errors,
      fallback,
    };

    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`Selective DB sync ${ok ? "OK" : "WARN"}: synced=${summary.synced_count}, failed=${summary.failed_count}, fallback=${fallback ? "yes" : "no"}`);
    }
    if (!ok && strict) {
      process.exit(1);
    }
  } catch (error) {
    const out = {
      ts: new Date().toISOString(),
      ok: false,
      message: String(error.message ?? error),
    };
    if (outputJson) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`ERROR: ${out.message}`);
    }
    process.exit(1);
  }
}

main();
