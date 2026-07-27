import { spawnSync } from "node:child_process";

export const MAX_GIT_STATUS_ENTRIES = 50;
const MAX_DIAGNOSTIC_CHARACTERS = 8000;
const MAX_PATH_CHARACTERS = 600;

function configuredSecrets(env) {
  return [
    env?.AIDN_PG_SMOKE_URL,
    env?.AIDN_RUNTIME_PG_SMOKE_URL,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

export function redactDiagnostic(value, env = process.env) {
  let redacted = String(value ?? "");
  for (const secret of configuredSecrets(env)) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }
  redacted = redacted.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-postgres-url]");
  redacted = redacted.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s@"']+@/gi,
    "$1[redacted-credentials]@",
  );
  if (redacted.length <= MAX_DIAGNOSTIC_CHARACTERS) {
    return redacted;
  }
  const half = Math.floor((MAX_DIAGNOSTIC_CHARACTERS - 64) / 2);
  return `${redacted.slice(0, half)}\n...[diagnostic truncated]...\n${redacted.slice(-half)}`;
}

function normalizeExitCode(value) {
  return Number.isInteger(value) ? value : null;
}

export function runGitCommand(
  repoRoot,
  args,
  {
    env = process.env,
    spawnSyncImpl = spawnSync,
  } = {},
) {
  let result;
  try {
    result = spawnSyncImpl("git", args, {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      shell: false,
    });
  } catch (error) {
    result = {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error,
    };
  }
  return {
    executable: "git",
    args: [...args],
    exit_code: normalizeExitCode(result?.status),
    signal: result?.signal ?? null,
    error: result?.error ? redactDiagnostic(result.error.message, env) : null,
    stdout: redactDiagnostic(result?.stdout, env),
    stderr: redactDiagnostic(result?.stderr, env),
  };
}

function boundedPath(value, env) {
  const path = redactDiagnostic(value, env).replace(/\r?\n/g, "\\n");
  return path.length <= MAX_PATH_CHARACTERS
    ? path
    : `${path.slice(0, MAX_PATH_CHARACTERS - 24)}...[path truncated]`;
}

function parseStatusLine(line, env) {
  const kind = line[0] ?? "";
  if (kind === "?" || kind === "!") {
    return {
      status: kind === "?" ? "??" : "!!",
      path: boundedPath(line.slice(2), env),
    };
  }

  const fields = line.split(" ");
  const status = String(fields[1] ?? "??");
  let pathFieldIndex = -1;
  if (kind === "1") {
    pathFieldIndex = 8;
  } else if (kind === "2") {
    pathFieldIndex = 9;
  } else if (kind === "u") {
    pathFieldIndex = 10;
  }
  if (pathFieldIndex < 0 || fields.length <= pathFieldIndex) {
    return {
      status: "unparsed",
      path: boundedPath(line, env),
    };
  }

  const pathPayload = fields.slice(pathFieldIndex).join(" ");
  if (kind !== "2") {
    return {
      status,
      path: boundedPath(pathPayload, env),
    };
  }
  const [path, originalPath = ""] = pathPayload.split("\t", 2);
  return {
    status,
    path: boundedPath(path, env),
    ...(originalPath ? { original_path: boundedPath(originalPath, env) } : {}),
  };
}

export function parsePorcelainV2(stdout, {
  env = process.env,
  maxEntries = MAX_GIT_STATUS_ENTRIES,
} = {}) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("# "));
  const parsed = lines.map((line) => parseStatusLine(line, env));
  return {
    entries: parsed.slice(0, maxEntries),
    entry_count: parsed.length,
    entries_truncated: parsed.length > maxEntries,
  };
}

export function captureGitWorktreeStatus(
  repoRoot,
  {
    env = process.env,
    spawnSyncImpl = spawnSync,
    maxEntries = MAX_GIT_STATUS_ENTRIES,
  } = {},
) {
  const command = runGitCommand(
    repoRoot,
    ["status", "--porcelain=v2", "--untracked-files=all"],
    { env, spawnSyncImpl },
  );
  const parsed = parsePorcelainV2(command.stdout, { env, maxEntries });
  const commandOk = command.exit_code === 0 && !command.error && !command.signal;
  return {
    ok: commandOk,
    clean: commandOk && parsed.entry_count === 0,
    failure_kind: commandOk
      ? (parsed.entry_count === 0 ? null : "dirty-worktree")
      : "git-command-error",
    command,
    ...parsed,
  };
}

export function captureGitRepository(
  repoRoot,
  {
    env = process.env,
    spawnSyncImpl = spawnSync,
  } = {},
) {
  const command = runGitCommand(
    repoRoot,
    ["rev-parse", "--is-inside-work-tree"],
    { env, spawnSyncImpl },
  );
  const met = command.exit_code === 0
    && !command.error
    && !command.signal
    && command.stdout.trim() === "true";
  return {
    ok: met,
    failure_kind: met ? null : "git-command-error",
    command,
  };
}

export function captureGitHead(
  repoRoot,
  {
    env = process.env,
    spawnSyncImpl = spawnSync,
  } = {},
) {
  const command = runGitCommand(
    repoRoot,
    ["rev-parse", "--verify", "HEAD"],
    { env, spawnSyncImpl },
  );
  const met = command.exit_code === 0
    && !command.error
    && !command.signal
    && Boolean(command.stdout.trim());
  return {
    ok: met,
    failure_kind: met ? null : "git-command-error",
    command,
  };
}

function entryIdentity(entry) {
  return [
    entry.status,
    entry.path,
    entry.original_path ?? "",
  ].join("\u0000");
}

export function diffWorktreeEntries(before, after, {
  maxEntries = MAX_GIT_STATUS_ENTRIES,
} = {}) {
  const beforeKeys = new Set((before?.entries ?? []).map(entryIdentity));
  const afterKeys = new Set((after?.entries ?? []).map(entryIdentity));
  const introduced = (after?.entries ?? []).filter((entry) => !beforeKeys.has(entryIdentity(entry)));
  const resolved = (before?.entries ?? []).filter((entry) => !afterKeys.has(entryIdentity(entry)));
  return {
    introduced: introduced.slice(0, maxEntries),
    introduced_count: introduced.length,
    introduced_truncated: introduced.length > maxEntries,
    resolved: resolved.slice(0, maxEntries),
    resolved_count: resolved.length,
    resolved_truncated: resolved.length > maxEntries,
  };
}
