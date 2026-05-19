export function renderWorkflowVersion(source, version) {
  const normalizedVersion = String(version ?? "").trim();
  if (!normalizedVersion) {
    throw new Error("workflow version is required");
  }
  const pattern = /^(\s*workflow_version:\s*).+$/im;
  if (!pattern.test(String(source ?? ""))) {
    throw new Error("workflow_version field not found");
  }
  return String(source).replace(pattern, `$1${normalizedVersion}`);
}
