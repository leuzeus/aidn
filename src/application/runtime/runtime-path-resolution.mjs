import fs from "node:fs";
import path from "node:path";

export function resolveRuntimePath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return path.resolve(candidatePath);
  }
  const targetCandidate = path.resolve(targetRoot, candidatePath);
  const cwdCandidate = path.resolve(process.cwd(), candidatePath);
  if (fs.existsSync(targetCandidate)) {
    return targetCandidate;
  }
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  if (fs.existsSync(path.dirname(cwdCandidate)) && !fs.existsSync(path.dirname(targetCandidate))) {
    return cwdCandidate;
  }
  return targetCandidate;
}
