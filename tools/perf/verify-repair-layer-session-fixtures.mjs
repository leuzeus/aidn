#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readIndexFromSqlite } from "../../src/lib/sqlite/index-sqlite-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    sqliteFile: ".aidn/runtime/index/fixtures/repair-layer-session/workflow-index.sqlite",
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
  console.log("  node tools/perf/verify-repair-layer-session-fixtures.mjs");
}

function runNoJson(script, scriptArgs) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveTargetPath(targetRoot, candidatePath) {
  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }
  return path.resolve(targetRoot, candidatePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);

    runNoJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--sqlite-output",
      sqliteFile,
    ]);

    const payload = readIndexFromSqlite(sqliteFile).payload;
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const links = Array.isArray(payload.session_cycle_links) ? payload.session_cycle_links : [];
    const sessionLinks = Array.isArray(payload.session_links) ? payload.session_links : [];
    const findings = Array.isArray(payload.migration_findings) ? payload.migration_findings : [];
    const byId = new Map(sessions.map((row) => [row.session_id, row]));
    const linkFor = (sessionId, cycleId, sourceMode, relationType = "attached_cycle") => links.find((row) =>
      String(row?.session_id ?? "") === sessionId
      && String(row?.cycle_id ?? "") === cycleId
      && String(row?.source_mode ?? "") === sourceMode
      && String(row?.relation_type ?? "") === relationType);

    const checks = {
      session_s101_present: byId.has("S101"),
      session_s101_branch: String(byId.get("S101")?.branch_name ?? "") === "S101-alpha",
      session_s101_state: String(byId.get("S101")?.state ?? "") === "COMMITTING",
      session_s101_parent_session: String(byId.get("S101")?.parent_session ?? "") === "S100",
      session_s101_explicit_cycle: Boolean(linkFor("S101", "C101", "explicit")),
      session_s101_explicit_cycle_status: String(linkFor("S101", "C101", "explicit")?.relation_status ?? "") === "explicit",
      session_s101_snapshot_promoted: String(linkFor("S101", "C101", "inferred", "active_in_snapshot")?.relation_status ?? "") === "promoted",
      session_s102_present: byId.has("S102"),
      session_s102_branch: String(byId.get("S102")?.branch_name ?? "") === "S102-merge",
      session_s102_parent_session: String(byId.get("S102")?.parent_session ?? "") === "S101",
      session_s102_integration_target_cycle: String(byId.get("S102")?.integration_target_cycle ?? "") === "C102",
      session_s102_carry_over_pending: String(byId.get("S102")?.carry_over_pending ?? "") === "yes",
      session_s102_ambiguous_c101: Boolean(linkFor("S102", "C101", "ambiguous")),
      session_s102_ambiguous_c102: Boolean(linkFor("S102", "C102", "ambiguous")),
      session_s102_ambiguous_status: String(linkFor("S102", "C101", "ambiguous")?.relation_status ?? "") === "ambiguous",
      session_s102_parent_link: sessionLinks.some((row) =>
        String(row?.source_session_id ?? "") === "S102"
        && String(row?.target_session_id ?? "") === "S101"
        && String(row?.relation_type ?? "") === "continues_from_session"
        && String(row?.relation_status ?? "") === "promoted"),
      session_s102_carry_over_link: sessionLinks.some((row) =>
        String(row?.source_session_id ?? "") === "S102"
        && String(row?.target_session_id ?? "") === "S101"
        && String(row?.relation_type ?? "") === "carry_over_pending_from_session"
        && String(row?.relation_status ?? "") === "promoted"),
      session_s102_integration_target_promoted: String(linkFor("S102", "C102", "explicit", "integration_target_cycle")?.relation_status ?? "") === "promoted",
      unresolved_parent_session_finding: findings.some((row) => String(row?.finding_type ?? "") === "UNRESOLVED_PARENT_SESSION" && String(row?.entity_id ?? "") === "S101"),
      ambiguous_relation_finding: findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S102"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      checks,
      sessions,
      session_cycle_links: links,
      session_links: sessionLinks,
      findings,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${target}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
