#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSharedCoordinationStore, summarizeSharedCoordinationResolution } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
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
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime shared-coordination-doctor --target . --json");
}

function normalizeStatusCode(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function buildDoctorReport({ resolution, workspace, health }) {
  const backend = summarizeSharedCoordinationResolution(resolution);
  const findings = [];
  const recommendedActions = [];

  if (!resolution?.enabled) {
    findings.push({
      severity: "info",
      code: "shared-runtime-disabled",
      message: resolution?.reason || "shared coordination is disabled",
    });
    recommendedActions.push("Enable a shared-runtime locator with backend.kind=postgres only if cross-worktree shared coordination is required.");
  } else if (!resolution?.configured) {
    findings.push({
      severity: "error",
      code: normalizeStatusCode(resolution?.status),
      message: resolution?.reason || "shared coordination is not configured",
    });
    if (resolution?.status === "missing-env") {
      recommendedActions.push(`Set ${resolution?.connection?.env_key || "the configured PostgreSQL env var"} before running shared-coordination bootstrap or migrate.`);
    } else if (resolution?.status === "invalid-ref") {
      recommendedActions.push("Use an env-backed connection reference such as env:AIDN_PG_URL or provide an explicit connection string.");
    } else if (resolution?.status === "not-configured") {
      recommendedActions.push("Configure backend.kind=postgres and a valid connectionRef in the shared-runtime locator.");
    } else {
      recommendedActions.push("Resolve the shared runtime locator and PostgreSQL connection configuration before using shared coordination.");
    }
  } else if (!health?.ok) {
    findings.push({
      severity: "error",
      code: normalizeStatusCode(health?.error?.category || health?.status || "healthcheck-failed"),
      message: health?.error?.message || "shared coordination healthcheck failed",
    });
    recommendedActions.push("Resolve connectivity, driver, or authentication issues, then rerun shared-coordination-migrate.");
  } else {
    const schemaStatus = String(health?.schema_status ?? "unknown").trim();
    if (schemaStatus !== "ready") {
      findings.push({
        severity: schemaStatus === "version-ahead" ? "warn" : "error",
        code: normalizeStatusCode(schemaStatus),
        message: `shared coordination schema status is ${schemaStatus}`,
      });
      if (schemaStatus === "needs-bootstrap" || schemaStatus === "no-migrations") {
        recommendedActions.push("Run shared-coordination-migrate --dry-run first, then rerun without --dry-run to bootstrap the shared PostgreSQL schema.");
      } else if (schemaStatus === "version-behind") {
        recommendedActions.push("Run shared-coordination-migrate --dry-run to inspect the upgrade plan, then rerun it to upgrade with a rollback snapshot.");
      } else if (schemaStatus === "version-ahead") {
        recommendedActions.push("Use a compatible package version or review schema compatibility before continuing.");
      } else if (schemaStatus === "schema-drift") {
        recommendedActions.push("Take a shared-coordination-backup if possible, then run shared-coordination-migrate --dry-run before repairing the incomplete schema.");
      }
    } else if (Number(health?.legacy_workspace_rows ?? 0) > 0 || String(health?.compatibility_status ?? "").trim() === "mixed-legacy-v2") {
      findings.push({
        severity: "error",
        code: "mixed-legacy-v2",
        message: `shared coordination still contains ${Number(health?.legacy_workspace_rows ?? 0)} legacy workspace rows without project_id`,
      });
      recommendedActions.push("Finish the additive migration backfill so every workspace_registry row carries project_id before treating the backend as healthy.");
    } else {
      findings.push({
        severity: "info",
        code: "ready",
        message: "shared coordination backend is configured, healthy, and schema-aligned",
      });
    }
  }

  const ok = findings.every((item) => item.severity !== "error");
  return {
    ok,
    status: ok ? "pass" : "fail",
    workspace,
    shared_coordination_backend: backend,
    health: health ?? null,
    findings,
    recommended_actions: recommendedActions,
  };
}

export async function doctorSharedCoordination({
  targetRoot = ".",
  sharedCoordination = null,
  sharedCoordinationOptions = {},
} = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), targetRoot ?? ".");
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const resolution = sharedCoordination ?? await resolveSharedCoordinationStore({
    targetRoot: absoluteTargetRoot,
    workspace,
    ...sharedCoordinationOptions,
  });
  const health = resolution.store ? await resolution.store.healthcheck() : null;
  return {
    target_root: absoluteTargetRoot,
    ...buildDoctorReport({
      resolution,
      workspace,
      health,
    }),
  };
}

function printHuman(result) {
  console.log("Shared coordination doctor:");
  console.log(`- ok=${result.ok ? "yes" : "no"}`);
  console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
  console.log(`- status=${result.status}`);
  if (result.health) {
    console.log(`- schema_status=${result.health.schema_status || "unknown"}`);
    console.log(`- compatibility_status=${result.health.compatibility_status || "unknown"}`);
    console.log(`- latest_schema_version=${result.health.latest_applied_schema_version ?? 0}`);
  }
  for (const finding of result.findings) {
    console.log(`- ${finding.severity}:${finding.code} ${finding.message}`);
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await doctorSharedCoordination({
      targetRoot: args.target,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    if (!result.ok) {
      process.exit(1);
    }
  }).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
