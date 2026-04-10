#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSqliteRuntimeCycleIdentities } from "../../src/application/runtime/runtime-cycle-identity-diagnostics-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime persistence-source-diagnose --target . --json");
  console.log("  npx aidn runtime persistence-source-diagnose --target . --sqlite-file .aidn/runtime/index/workflow-index.sqlite --json");
}

export function diagnoseRuntimePersistenceSource({
  targetRoot = ".",
  sqliteFile = ".aidn/runtime/index/workflow-index.sqlite",
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const absoluteSqliteFile = path.isAbsolute(sqliteFile)
    ? path.resolve(sqliteFile)
    : path.resolve(absoluteTargetRoot, sqliteFile);
  return {
    ts: new Date().toISOString(),
    target_root: absoluteTargetRoot,
    source_diagnostics: inspectSqliteRuntimeCycleIdentities({
      sqliteFile: absoluteSqliteFile,
      targetRoot: absoluteTargetRoot,
    }),
  };
}

export function renderRuntimePersistenceSourceDiagnostics(result) {
  const diagnostics = result.source_diagnostics ?? {};
  const lines = [
    "Runtime persistence source diagnostics:",
    `- diagnostic_status=${diagnostics.diagnostic_status ?? "unknown"}`,
    `- sqlite_file=${diagnostics.sqlite_file ?? ""}`,
    `- exists=${diagnostics.exists ? "yes" : "no"}`,
    `- source_has_payload=${diagnostics.has_payload ? "yes" : "no"}`,
    `- cycle_identity_collision_count=${diagnostics.cycle_identity_collision_count ?? 0}`,
  ];
  if (diagnostics.schema_exists) {
    lines.push(`- schema_version=${diagnostics.schema_version ?? "unknown"}`);
  }
  if (diagnostics.reason_code) {
    lines.push(`- reason_code=${diagnostics.reason_code}`);
  }
  if (Array.isArray(diagnostics.reason_codes) && diagnostics.reason_codes.length > 1) {
    lines.push(`- reason_codes=${diagnostics.reason_codes.join(", ")}`);
  }
  if (diagnostics.warning) {
    lines.push(`- warning=${diagnostics.warning}`);
  }
  const sourceScope = diagnostics.source_scope ?? {};
  if (sourceScope.payload_target_root || sourceScope.payload_audit_root) {
    lines.push(`- payload_target_root=${sourceScope.payload_target_root ?? "none"}`);
    lines.push(`- payload_audit_root=${sourceScope.payload_audit_root ?? "none"}`);
  }
  if (sourceScope.blocking) {
    lines.push(`- source_scope_blocking=yes`);
    if (sourceScope.target_root_mismatch) {
      lines.push(`- source_target_root_expected=${sourceScope.expected_target_root ?? ""}`);
    }
    if (sourceScope.audit_root_mismatch) {
      lines.push(`- source_audit_root_expected=${sourceScope.expected_audit_root ?? ""}`);
    }
  }
  if (Array.isArray(diagnostics.cycle_identity_collisions) && diagnostics.cycle_identity_collisions.length > 0) {
    lines.push(`- collision_cycle_ids=${diagnostics.cycle_identity_collisions.map((item) => item.cycle_id).join(", ")}`);
    for (const collision of diagnostics.cycle_identity_collisions) {
      lines.push(`- cycle ${collision.cycle_id}: directories=${Array.isArray(collision.directories) ? collision.directories.join(", ") : ""}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = diagnoseRuntimePersistenceSource({
      targetRoot: args.target,
      sqliteFile: args.sqliteFile,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderRuntimePersistenceSourceDiagnostics(result));
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
