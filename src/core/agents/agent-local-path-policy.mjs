// Application policy only: no filesystem lookup, ACL edit or claim of OS-level
// isolation. Existing physical-path checks still refuse links/aliases. Explicit
// exclusions cover renamed roots; standard personal/business OneDrive names
// are rejected by the agent execution entry points that apply this guard.
const standardOneDrive = /^(?:onedrive(?: - .+)?|onedri~[0-9]+)$/iu;
const normalized = value => {
  const components = [];
  for (const part of value.replaceAll("\\", "/").toLowerCase().split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && components.length && components.at(-1) !== ".." && !/^[a-z]:$/u.test(components.at(-1))) components.pop();
    else components.push(part.replace(/[. ]+$/u, ""));
  }
  return (value.startsWith("/") ? "/" : "") + components.join("/");
};
export function isExcludedAgentPath(value, excludedRoots = []) {
  if (typeof value !== "string") return false;
  if (value.split(/[\\/]/u).some(part => standardOneDrive.test(part.split(":")[0].replace(/[. ]+$/u, "")))) return true;
  const candidate = normalized(value);
  return excludedRoots.some(root => typeof root === "string" && root.length > 0
    && (candidate === normalized(root) || candidate.startsWith(normalized(root) + "/")));
}
export function assertAgentLocalPath(value, excludedRoots = []) {
  if (isExcludedAgentPath(value, excludedRoots)) {
    const code = "AGENT_CLOUD_PATH_EXCLUDED";
    throw Object.assign(new Error(code), { code });
  }
  // A DOS short-name alias cannot be resolved without observing its target.
  // Refuse it lexically instead of probing whether it redirects into a cloud root.
  if (typeof value === "string" && (value.includes("~") || value.replace(/^[A-Za-z]:/u, "").includes(":")
    || /^(?:\\\\[?.]\\|\/\/[?.]\/)/u.test(value))) {
    const code = "AGENT_PATH_ALIAS_UNSUPPORTED";
    throw Object.assign(new Error(code), { code });
  }
  return value;
}
