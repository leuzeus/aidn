import path from "node:path";
import { runRepairLayerTriageUseCase } from "./repair-layer-triage-use-case.mjs";
import { writeJsonIfChanged } from "../../lib/index/io-lib.mjs";

function resolveRuntimeOutputPath(targetRoot, candidatePath) {
  if (!candidatePath) {
    return "";
  }
  if (path.isAbsolute(candidatePath)) {
    return path.resolve(candidatePath);
  }
  return path.resolve(targetRoot, candidatePath);
}

export async function writeRepairLayerTriageArtifacts({
  targetRoot,
  indexFile,
  backend,
  triageFile,
  summaryFile,
  renderScript,
  runNodeScript,
}) {
  const triage = await runRepairLayerTriageUseCase({
    args: {
      indexFile,
      backend: backend || "auto",
    },
    targetRoot,
  });
  const triageTarget = resolveRuntimeOutputPath(targetRoot, triageFile);
  const triageWrite = writeJsonIfChanged(triageTarget, triage);

  let summaryWrite = null;
  if (summaryFile && renderScript && typeof runNodeScript === "function") {
    const summaryTarget = resolveRuntimeOutputPath(targetRoot, summaryFile);
    runNodeScript(renderScript, [
      "--triage-file",
      triageWrite.path,
      "--out",
      summaryTarget,
    ]);
    summaryWrite = {
      path: summaryTarget,
    };
  }

  return {
    triage,
    triage_file: triageWrite.path,
    triage_write: triageWrite,
    summary_file: summaryWrite?.path ?? null,
    summary_write: summaryWrite,
  };
}
