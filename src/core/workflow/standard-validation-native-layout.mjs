import path from "node:path";

// On Windows the sandbox group is shared. A deny-read ancestor installed by
// a Native actor can prevent a later validator from entering its own cwd.
// This necessary layout check grants no runtime availability or ACL repair.
export function assertStandardValidationNativeLayout({ execution, profile, boundary }) {
  if (boundary.platform !== "win32") return;
  const paths = path.win32;
  const inside = (root, file) => {
    const relative = paths.relative(paths.normalize(root).toLowerCase(), paths.normalize(file).toLowerCase());
    return relative === "" || !paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith("..\\");
  };
  const protectedRoots = execution.native?.protected_roots ?? [];
  if (!Array.isArray(protectedRoots) || protectedRoots.length > 16 || protectedRoots.some(root => typeof root !== "string" || !root.length))
    throw Object.assign(new Error("PROCESS_EXECUTION_PROTECTED_ROOT_INVALID"), { code: "PROCESS_EXECUTION_PROTECTED_ROOT_INVALID" });
  const denied = [...protectedRoots, execution.control_root, execution.native?.home].filter(value => typeof value === "string" && value.length);
  const required = [
    ["snapshot_root", profile.snapshot_root], ["scratch_root", boundary.roots?.scratch],
    ["runner", boundary.runner?.executable], ["trampoline", boundary.trampoline?.executable],
    ["access_observer", boundary.access_observer?.executable],
  ].filter(([, value]) => typeof value === "string" && value.length);
  for (const [role, file] of required) {
    const index = denied.findIndex(root => inside(root, file) || role === "scratch_root" && inside(file, root));
    if (index !== -1) throw Object.assign(new Error(`STANDARD_VALIDATION_NATIVE_READ_CONFLICT: ${role} overlaps Native denied root ${index}`),
      { code: "STANDARD_VALIDATION_NATIVE_READ_CONFLICT" });
  }
}
