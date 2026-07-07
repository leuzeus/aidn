#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntimeArtifactStore } from "../../src/application/runtime/runtime-persistence-service.mjs";
import { resolveWorkspaceContext } from "../../src/application/runtime/workspace-resolution-service.mjs";
import { resolveEffectiveStateMode } from "../../src/core/state-mode/state-mode-policy.mjs";
import { writeUtf8IfChanged } from "../../src/lib/index/io-lib.mjs";
import {
  applyRuntimeStateReanchorPayload,
  buildRuntimeStateReanchorPlan,
} from "../../src/application/runtime/runtime-state-reanchor-service.mjs";
import { projectRuntimeState } from "./project-runtime-state.mjs";
import { projectHandoffPacket } from "./project-handoff-packet.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    backend: "",
    connectionString: "",
    connectionRef: "",
    currentStateOut: "docs/audit/CURRENT-STATE.md",
    runtimeStateOut: "docs/audit/RUNTIME-STATE.md",
    handoffOut: "docs/audit/HANDOFF-PACKET.md",
    reason: "",
    nextAgentGoal: "resume from reanchored runtime state",
    json: false,
    dryRun: false,
    write: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--connection-string") {
      args.connectionString = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--connection-ref") {
      args.connectionRef = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--current-state-out") {
      args.currentStateOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--runtime-state-out") {
      args.runtimeStateOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--handoff-out") {
      args.handoffOut = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--reason") {
      args.reason = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--next-agent-goal") {
      args.nextAgentGoal = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--write") {
      args.write = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing required --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn runtime state-reanchor --target . --json");
  console.log("  npx aidn runtime state-reanchor --target . --write --json");
  console.log("  npx aidn runtime state-reanchor --target . --backend postgres --connection-ref env:AIDN_PG_URL --write --json");
}

function resolveTargetPath(targetRoot, candidate) {
  if (path.isAbsolute(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(targetRoot, candidate);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sanitizePlan(plan) {
  return {
    ...plan,
    current_state_text: undefined,
    anchors: plan.anchors.map((anchor) => ({ ...anchor })),
  };
}

function sanitizeBackendForOutput(backend) {
  if (!backend || typeof backend !== "object") {
    return backend ?? null;
  }
  const clone = JSON.parse(JSON.stringify(backend));
  if (clone.connection && typeof clone.connection === "object") {
    if (Object.prototype.hasOwnProperty.call(clone.connection, "connection_string")) {
      clone.connection.connection_string = clone.connection.connection_string ? "[redacted]" : "";
    }
  }
  return clone;
}

export async function stateReanchor(options = {}) {
  const absoluteTargetRoot = path.resolve(process.cwd(), options.target ?? ".");
  const now = new Date().toISOString();
  const workspace = resolveWorkspaceContext({
    targetRoot: absoluteTargetRoot,
  });
  const effectiveStateMode = resolveEffectiveStateMode({
    targetRoot: absoluteTargetRoot,
    stateMode: options.stateMode,
  });
  const store = createRuntimeArtifactStore({
    targetRoot: absoluteTargetRoot,
    backend: options.backend,
    connectionString: options.connectionString,
    connectionRef: options.connectionRef,
    env: options.env ?? process.env,
    clientFactory: options.clientFactory ?? null,
    moduleLoader: options.moduleLoader ?? null,
  });
  const backend = store.describeBackend();
  const backendOutput = sanitizeBackendForOutput(backend);
  const snapshot = await store.loadSnapshot({
    includePayload: true,
    includeRuntimeHeads: true,
  });
  const plan = buildRuntimeStateReanchorPlan({
    targetRoot: absoluteTargetRoot,
    workspace,
    effectiveStateMode,
    snapshot: {
      ...snapshot,
      backend,
    },
    now,
    reason: options.reason,
  });
  const shouldWrite = Boolean(options.write) && !options.dryRun;
  const canWrite = shouldWrite && plan.status === "ready";
  const visibleWrite = {
    attempted: canWrite,
    current_state: {
      path: resolveTargetPath(absoluteTargetRoot, options.currentStateOut ?? "docs/audit/CURRENT-STATE.md"),
      written: false,
      bytes_written: 0,
    },
    runtime_state: {
      output_file: resolveTargetPath(absoluteTargetRoot, options.runtimeStateOut ?? "docs/audit/RUNTIME-STATE.md"),
      written: false,
    },
    handoff_packet: {
      output_file: resolveTargetPath(absoluteTargetRoot, options.handoffOut ?? "docs/audit/HANDOFF-PACKET.md"),
      written: false,
    },
  };
  const canonicalWrite = {
    attempted: false,
    written: false,
    outputs: [],
    anchors: [],
    reason: "",
  };

  if (shouldWrite && plan.status !== "ready") {
    canonicalWrite.reason = plan.reason;
  }

  if (canWrite) {
    visibleWrite.current_state = writeUtf8IfChanged(
      visibleWrite.current_state.path,
      plan.current_state_text,
    );
    const runtimeState = await projectRuntimeState({
      targetRoot: absoluteTargetRoot,
      out: options.runtimeStateOut ?? "docs/audit/RUNTIME-STATE.md",
      sharedStateOptions: {
        backend: options.backend,
        connectionString: options.connectionString,
        connectionRef: options.connectionRef,
        env: options.env ?? process.env,
        clientFactory: options.clientFactory ?? null,
        moduleLoader: options.moduleLoader ?? null,
      },
      write: true,
      dryRun: false,
    });
    visibleWrite.runtime_state = {
      output_file: runtimeState.output_file,
      written: runtimeState.written,
      digest: runtimeState.digest,
    };
    const handoff = await projectHandoffPacket({
      targetRoot: absoluteTargetRoot,
      runtimeStateFile: options.runtimeStateOut ?? "docs/audit/RUNTIME-STATE.md",
      out: options.handoffOut ?? "docs/audit/HANDOFF-PACKET.md",
      nextAgentGoal: options.nextAgentGoal ?? "resume from reanchored runtime state",
      handoffNote: "runtime state reanchor regenerated the recovery anchors",
      fromAgentRole: "coordinator",
      fromAgentAction: "relay",
      sharedStateOptions: {
        backend: options.backend,
        connectionString: options.connectionString,
        connectionRef: options.connectionRef,
        env: options.env ?? process.env,
        clientFactory: options.clientFactory ?? null,
        moduleLoader: options.moduleLoader ?? null,
      },
      write: true,
      dryRun: false,
      syncRelay: false,
    });
    visibleWrite.handoff_packet = {
      output_file: handoff.output_file,
      written: handoff.written,
      packet: handoff.packet,
    };

    const currentStatePath = visibleWrite.current_state.path;
    const runtimeStatePath = visibleWrite.runtime_state.output_file;
    const handoffPath = visibleWrite.handoff_packet.output_file;
    const applied = applyRuntimeStateReanchorPayload({
      targetRoot: absoluteTargetRoot,
      payload: snapshot.payload,
      now,
      anchors: [
        {
          artifact_path: "CURRENT-STATE.md",
          content: readText(currentStatePath),
          source_mode: "reconstructed",
        },
        {
          artifact_path: "RUNTIME-STATE.md",
          content: readText(runtimeStatePath),
          source_mode: "reconstructed",
        },
        {
          artifact_path: "HANDOFF-PACKET.md",
          content: readText(handoffPath),
          source_mode: "reconstructed",
        },
      ],
    });
    canonicalWrite.attempted = true;
    canonicalWrite.outputs = await store.writeIndexProjection({
      payload: applied.payload,
      sourceBackend: backend.backend_kind ?? backend.projection_backend_kind ?? "runtime-canonical",
      adoptionStatus: "state-reanchored",
      adoptionMetadata: {
        action: "state-reanchor",
        reason: options.reason || "manual runtime state repair",
        reanchor_confidence: plan.confidence,
        anchor_count: applied.anchors.length,
      },
    });
    canonicalWrite.written = canonicalWrite.outputs.some((item) => item?.written === true);
    canonicalWrite.anchors = applied.anchors;
    canonicalWrite.reason = "canonical runtime projection refreshed from reanchored anchors";
  }

  return {
    ts: now,
    ok: plan.status === "ready" || (!shouldWrite && plan.status === "needs_review"),
    target_root: absoluteTargetRoot,
    dry_run: Boolean(options.dryRun),
    write: canWrite,
    requested_write: Boolean(options.write),
    status: canWrite
      ? "reanchored"
      : (shouldWrite && plan.status !== "ready" ? "blocked" : plan.status),
    backend: backendOutput,
    workspace,
    project_context: snapshot.project_context ?? backend.project_context ?? null,
    effective_state_mode: effectiveStateMode,
    plan: sanitizePlan(plan),
    visible_write: visibleWrite,
    canonical_write: canonicalWrite,
  };
}

function main() {
  Promise.resolve().then(async () => {
    const args = parseArgs(process.argv.slice(2));
    const output = await stateReanchor(args);
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Runtime state reanchor: ${output.status}`);
      console.log(`- target=${output.target_root}`);
      console.log(`- backend=${output.backend?.backend_kind ?? output.backend?.projection_backend_kind ?? "unknown"}`);
      console.log(`- confidence=${output.plan.confidence}`);
      console.log(`- write=${output.write ? "yes" : "no"}`);
    }
    if (args.write && output.write !== true) {
      process.exit(1);
    }
  }).catch((error) => {
    const payload = {
      ts: new Date().toISOString(),
      ok: false,
      status: "error",
      message: String(error?.message ?? error),
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
