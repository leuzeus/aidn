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

function loadPayloadForTarget(target, sqliteFile) {
  runNoJson("tools/perf/index-sync.mjs", [
    "--target",
    target,
    "--store",
    "sqlite",
    "--sqlite-output",
    sqliteFile,
  ]);

  return readIndexFromSqlite(sqliteFile).payload;
}

function buildSessionChecks(payload) {
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
  return {
    sessions,
    links,
    sessionLinks,
    findings,
    byId,
    linkFor,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const target = path.resolve(process.cwd(), args.target);
    const sqliteFile = resolveTargetPath(target, args.sqliteFile);
    const multiTarget = path.resolve(process.cwd(), "tests/fixtures/perf-structure/session-multi-cycle-explicit");
    const legacyTarget = path.resolve(process.cwd(), "tests/fixtures/perf-structure/session-legacy-multi-target");

    const basePayload = loadPayloadForTarget(target, sqliteFile);
    const multiPayload = loadPayloadForTarget(multiTarget, resolveTargetPath(multiTarget, args.sqliteFile));
    const legacyPayload = loadPayloadForTarget(legacyTarget, resolveTargetPath(legacyTarget, args.sqliteFile));

    const base = buildSessionChecks(basePayload);
    const multi = buildSessionChecks(multiPayload);
    const legacy = buildSessionChecks(legacyPayload);

    const checks = {
      session_s101_present: base.byId.has("S101"),
      session_s101_branch: String(base.byId.get("S101")?.branch_name ?? "") === "S101-alpha",
      session_s101_state: String(base.byId.get("S101")?.state ?? "") === "COMMITTING",
      session_s101_parent_session: String(base.byId.get("S101")?.parent_session ?? "") === "S100",
      session_s101_explicit_cycle: Boolean(base.linkFor("S101", "C101", "explicit")),
      session_s101_explicit_cycle_status: String(base.linkFor("S101", "C101", "explicit")?.relation_status ?? "") === "explicit",
      session_s101_snapshot_promoted: String(base.linkFor("S101", "C101", "inferred", "active_in_snapshot")?.relation_status ?? "") === "promoted",
      session_s102_present: base.byId.has("S102"),
      session_s102_branch: String(base.byId.get("S102")?.branch_name ?? "") === "S102-merge",
      session_s102_parent_session: String(base.byId.get("S102")?.parent_session ?? "") === "S101",
      session_s102_integration_target_cycle: String(base.byId.get("S102")?.integration_target_cycle ?? "") === "C102",
      session_s102_carry_over_pending: String(base.byId.get("S102")?.carry_over_pending ?? "") === "yes",
      session_s102_ambiguous_c101: Boolean(base.linkFor("S102", "C101", "ambiguous")),
      session_s102_ambiguous_c102: Boolean(base.linkFor("S102", "C102", "ambiguous")),
      session_s102_parent_link: base.sessionLinks.some((row) =>
        String(row?.source_session_id ?? "") === "S102"
        && String(row?.target_session_id ?? "") === "S101"
        && String(row?.relation_type ?? "") === "continues_from_session"
        && String(row?.relation_status ?? "") === "promoted"),
      session_s102_carry_over_link: base.sessionLinks.some((row) =>
        String(row?.source_session_id ?? "") === "S102"
        && String(row?.target_session_id ?? "") === "S101"
        && String(row?.relation_type ?? "") === "carry_over_pending_from_session"
        && String(row?.relation_status ?? "") === "promoted"),
      session_s102_integration_target_promoted: String(base.linkFor("S102", "C102", "explicit", "integration_target_cycle")?.relation_status ?? "") === "promoted",
      unresolved_parent_session_finding: base.findings.some((row) => String(row?.finding_type ?? "") === "UNRESOLVED_PARENT_SESSION" && String(row?.entity_id ?? "") === "S101"),
      session_s102_ambiguous_relation_finding: base.findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S102"),
      session_s103_present: multi.byId.has("S103"),
      session_s103_focus_cycle_promoted: String(multi.byId.get("S103")?.integration_target_cycle ?? "") === "C104",
      session_s103_attached_c103: Boolean(multi.linkFor("S103", "C103", "explicit")),
      session_s103_attached_c104: Boolean(multi.linkFor("S103", "C104", "explicit")),
      session_s103_target_c103: Boolean(multi.linkFor("S103", "C103", "explicit", "integration_target_cycle")),
      session_s103_target_c104: Boolean(multi.linkFor("S103", "C104", "explicit", "integration_target_cycle")),
      session_s103_no_ambiguous_finding: !multi.findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S103"),
      session_s103_no_partial_metadata_finding: !multi.findings.some((row) => String(row?.finding_type ?? "") === "SESSION_PARTIAL_METADATA" && String(row?.entity_id ?? "") === "S103"),
      session_s104_present: legacy.byId.has("S104"),
      session_s104_focus_cycle_empty: !String(legacy.byId.get("S104")?.integration_target_cycle ?? ""),
      session_s104_target_c105: Boolean(legacy.linkFor("S104", "C105", "explicit", "integration_target_cycle")),
      session_s104_target_c106: Boolean(legacy.linkFor("S104", "C106", "explicit", "integration_target_cycle")),
      session_s104_normalization_finding: legacy.findings.some((row) => String(row?.finding_type ?? "") === "SESSION_METADATA_NORMALIZATION_RECOMMENDED" && String(row?.entity_id ?? "") === "S104"),
      session_s104_no_ambiguous_finding: !legacy.findings.some((row) => String(row?.finding_type ?? "") === "AMBIGUOUS_RELATION" && String(row?.entity_id ?? "") === "S104"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      sqlite_file: sqliteFile,
      scenario_targets: {
        base: target,
        multi: multiTarget,
        legacy: legacyTarget,
      },
      checks,
      base_sessions: base.sessions,
      base_session_cycle_links: base.links,
      base_session_links: base.sessionLinks,
      base_findings: base.findings,
      multi_sessions: multi.sessions,
      multi_session_cycle_links: multi.links,
      multi_findings: multi.findings,
      legacy_sessions: legacy.sessions,
      legacy_session_cycle_links: legacy.links,
      legacy_findings: legacy.findings,
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
