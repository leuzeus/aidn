#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSharedCoordinationStore, summarizeSharedCoordinationResolution } from "../../src/application/runtime/shared-coordination-store-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    projectId: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--project-id") {
      args.projectId = String(argv[i + 1] ?? "").trim();
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
  console.log("  npx aidn runtime shared-coordination-projects --target . --json");
  console.log("  npx aidn runtime shared-coordination-projects --target . --project-id project-main --json");
}

function deriveProjectsDiagnostic(result) {
  const backend = result?.shared_coordination_backend ?? {};
  const projects = Array.isArray(result?.projects) ? result.projects : [];
  const inspectedWorkspaces = Array.isArray(result?.inspected_workspaces) ? result.inspected_workspaces : [];
  const status = String(result?.status ?? "unknown").trim() || "unknown";
  const backendStatus = String(backend?.status ?? "disabled").trim() || "disabled";
  let recommendedAction = "inspect shared coordination backend readiness before retrying project enumeration";
  if (status === "ready") {
    recommendedAction = result?.inspected_project
      ? "shared coordination project inspection completed"
      : "shared coordination project enumeration completed";
  } else if (backendStatus === "missing-env") {
    recommendedAction = "set the shared PostgreSQL env reference, then rerun shared-coordination-projects";
  } else if (backendStatus === "disabled") {
    recommendedAction = "keep local-first mode or explicitly enable shared-runtime before querying shared projects";
  } else if (status === "unsupported") {
    recommendedAction = "upgrade or replace the shared coordination store adapter to expose project enumeration";
  }
  return {
    scope: "shared-coordination-projects",
    backend_kind: String(backend?.backend_kind ?? "unknown").trim() || "unknown",
    backend_status: backendStatus,
    status,
    project_count: projects.length,
    inspected_project_id: String(result?.inspected_project?.project_id ?? "").trim() || "",
    inspected_workspace_count: inspectedWorkspaces.length,
    summary: String(result?.reason ?? "shared coordination projects status unavailable").trim() || "shared coordination projects status unavailable",
    recommended_action: recommendedAction,
  };
}

export async function sharedCoordinationProjects({
  targetRoot = ".",
  projectId = "",
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
  const backend = summarizeSharedCoordinationResolution(resolution);
  const listProjects = typeof resolution?.store?.listProjects === "function"
    ? resolution.store.listProjects.bind(resolution.store)
    : null;
  const inspectProject = typeof resolution?.store?.inspectProject === "function"
    ? resolution.store.inspectProject.bind(resolution.store)
    : null;

  if (!listProjects || !inspectProject) {
    const result = {
      target_root: absoluteTargetRoot,
      ok: false,
      status: resolution?.store ? "unsupported" : (resolution?.status || "disabled"),
      reason: resolution?.store
        ? "shared coordination store does not expose project enumeration methods"
        : (resolution?.reason || "shared coordination backend is not available"),
      workspace,
      shared_coordination_backend: backend,
      project_id_filter: projectId || "",
      projects: [],
      inspected_project: null,
      inspected_workspaces: [],
    };
    return {
      ...result,
      projects_diagnostic: deriveProjectsDiagnostic(result),
    };
  }

  const projectsResult = await listProjects();
  const inspectResult = projectId ? await inspectProject({ projectId }) : null;
  const ok = projectsResult.ok === true && (!inspectResult || inspectResult.ok === true);
  const result = {
    target_root: absoluteTargetRoot,
    ok,
    status: ok ? "ready" : "read-failed",
    reason: ok ? "shared coordination projects loaded" : "failed to enumerate shared coordination projects",
    workspace,
    shared_coordination_backend: backend,
    project_id_filter: projectId || "",
    projects: projectsResult.projects ?? [],
    inspected_project: inspectResult?.project ?? null,
    inspected_workspaces: inspectResult?.workspaces ?? [],
  };
  return {
    ...result,
    projects_diagnostic: deriveProjectsDiagnostic(result),
  };
}

function printHuman(result) {
  console.log("Shared coordination projects:");
  console.log(`- backend_kind=${result.shared_coordination_backend.backend_kind}`);
  console.log(`- status=${result.status}`);
  console.log(`- project_count=${result.projects.length}`);
  for (const project of result.projects) {
    console.log(`- project_id=${project.project_id} workspace_count=${project.workspace_count} worktree_count=${project.worktree_count} planning_state_count=${project.planning_state_count} handoff_relay_count=${project.handoff_relay_count} coordination_record_count=${project.coordination_record_count}`);
  }
  if (result.inspected_project) {
    console.log(`- inspected_project_id=${result.inspected_project.project_id}`);
    console.log(`- inspected_project_root=${result.inspected_project.project_root_ref}`);
    console.log(`- inspected_workspace_count=${result.inspected_project.workspace_count}`);
    for (const workspace of result.inspected_workspaces) {
      console.log(`- workspace_id=${workspace.workspace_id} workspace_id_source=${workspace.workspace_id_source} repo_root=${workspace.repo_root}`);
    }
  }
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await sharedCoordinationProjects({
      targetRoot: args.target,
      projectId: args.projectId,
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
