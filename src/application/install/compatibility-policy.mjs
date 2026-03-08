import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function normalizeOsLabel(platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "mac";
  }
  return "linux";
}

function commandExists(commandName) {
  const pathValue = process.env.PATH ?? "";
  if (!pathValue) {
    return false;
  }

  const dirs = pathValue.split(path.delimiter).filter((entry) => entry && entry.trim().length > 0);
  const isWindows = process.platform === "win32";
  const extensions = isWindows
    ? Array.from(
      new Set(
        ((process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM;.PS1")
          .split(";")
          .map((ext) => ext.trim().toLowerCase())
          .filter((ext) => ext.length > 0))
          .concat([".ps1"]),
      ),
    )
    : [""];

  for (const dir of dirs) {
    if (isWindows) {
      for (const ext of extensions) {
        const candidate = path.join(dir, `${commandName}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return true;
        }
      }
      const plainCandidate = path.join(dir, commandName);
      if (fs.existsSync(plainCandidate) && fs.statSync(plainCandidate).isFile()) {
        return true;
      }
    } else {
      const candidate = path.join(dir, commandName);
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) {
        continue;
      }
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // continue scanning
      }
    }
  }

  return false;
}

function checkCodexAuthentication() {
  if (!commandExists("codex")) {
    return {
      checked: false,
      authenticated: false,
      reason: "codex command not found",
      output: "",
      status: null,
    };
  }

  const result = spawnSync("codex login status", {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
    shell: true,
  });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
  const lower = output.toLowerCase();
  const loggedIn = lower.includes("logged in") && !lower.includes("not logged in");
  const authenticated = result.status === 0 && loggedIn;

  return {
    checked: true,
    authenticated,
    reason: authenticated ? "ok" : "codex login status did not confirm authentication",
    output,
    status: result.status,
  };
}

function asStringArray(value, label) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} must contain non-empty strings`);
    }
    out.push(item.trim());
  }
  return out;
}

function asNumber(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new Error(`${label} must be an integer`);
}

function asBoolean(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function intersectOrdered(primary, secondary) {
  const secondarySet = new Set(secondary);
  return primary.filter((item) => secondarySet.has(item));
}

export function resolveCompatibility(workflowManifest, compatMatrix) {
  const workflowCompat = workflowManifest?.compatibility ?? null;
  const nodeMinWorkflow = asNumber(workflowCompat?.node_min, "workflow.compatibility.node_min");
  const nodeMinMatrix = asNumber(compatMatrix?.node_min, "compat.matrix.node_min");
  const codexWorkflow = asBoolean(workflowCompat?.codex_online, "workflow.compatibility.codex_online");
  const codexMatrix = asBoolean(compatMatrix?.codex_online, "compat.matrix.codex_online");
  const osWorkflow = asStringArray(workflowCompat?.os, "workflow.compatibility.os");
  const osMatrix = asStringArray(compatMatrix?.os, "compat.matrix.os");

  if (nodeMinWorkflow != null && nodeMinMatrix != null && nodeMinWorkflow !== nodeMinMatrix) {
    throw new Error(
      `Compatibility conflict: node_min differs (${nodeMinWorkflow} vs ${nodeMinMatrix})`,
    );
  }
  if (codexWorkflow != null && codexMatrix != null && codexWorkflow !== codexMatrix) {
    throw new Error(
      `Compatibility conflict: codex_online differs (${codexWorkflow} vs ${codexMatrix})`,
    );
  }

  let osEffective = null;
  if (osWorkflow && osMatrix) {
    osEffective = intersectOrdered(osWorkflow, osMatrix);
    if (osEffective.length === 0) {
      throw new Error(
        `Compatibility conflict: no overlapping OS between workflow (${osWorkflow.join(", ")}) and matrix (${osMatrix.join(", ")})`,
      );
    }
  } else {
    osEffective = osWorkflow ?? osMatrix;
  }

  const nodeMin = nodeMinWorkflow ?? nodeMinMatrix;
  const codexOnline = codexWorkflow ?? codexMatrix;
  if (nodeMin == null && osEffective == null && codexOnline == null) {
    return null;
  }

  return {
    nodeMin,
    os: osEffective,
    codexOnline,
  };
}

export function validateRuntimeCompatibility(compatibility) {
  const codexAuth = checkCodexAuthentication();
  const runtime = {
    node: process.versions.node,
    os: normalizeOsLabel(process.platform),
    codexInstalled: commandExists("codex"),
    codexAuthenticated: codexAuth.authenticated,
    codexAuthChecked: codexAuth.checked,
    codexAuthReason: codexAuth.reason,
  };

  if (!compatibility) {
    return runtime;
  }

  if (compatibility.nodeMin != null) {
    const currentMajor = Number(runtime.node.split(".")[0]);
    if (currentMajor < compatibility.nodeMin) {
      throw new Error(
        `Node ${currentMajor} is not supported (requires >= ${compatibility.nodeMin})`,
      );
    }
  }

  if (compatibility.os && compatibility.os.length > 0) {
    if (!compatibility.os.includes(runtime.os)) {
      throw new Error(
        `OS ${runtime.os} is not supported by compatibility matrix (${compatibility.os.join(", ")})`,
      );
    }
  }

  if (compatibility.codexOnline === true && !runtime.codexInstalled) {
    throw new Error(
      "codex_online=true requires Codex CLI to be installed and available in PATH (command: codex)",
    );
  }
  if (compatibility.codexOnline === true && !runtime.codexAuthenticated) {
    throw new Error(
      "codex_online=true requires an authenticated Codex session. Run: codex login",
    );
  }

  return runtime;
}

export function formatCompatibility(compatibility) {
  if (!compatibility) {
    return "none";
  }
  const parts = [];
  if (compatibility.nodeMin != null) {
    parts.push(`node>=${compatibility.nodeMin}`);
  }
  if (compatibility.os && compatibility.os.length > 0) {
    parts.push(`os=[${compatibility.os.join(", ")}]`);
  }
  if (compatibility.codexOnline != null) {
    parts.push(`codex_online=${compatibility.codexOnline}`);
  }
  return parts.join(", ");
}
