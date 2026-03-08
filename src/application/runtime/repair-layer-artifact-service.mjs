import { runRepairLayerTriageUseCase } from "./repair-layer-triage-use-case.mjs";
import { writeJsonIfChanged } from "../../lib/index/io-lib.mjs";
import { resolveRuntimePath } from "./runtime-path-resolution.mjs";

export function writeRepairLayerTriageArtifacts({
  targetRoot,
  indexFile,
  backend,
  triageFile,
  summaryFile,
  renderScript,
  runNodeScript,
}) {
  const triage = runRepairLayerTriageUseCase({
    args: {
      indexFile,
      backend: backend || "auto",
    },
    targetRoot,
  });
  const triageTarget = resolveRuntimePath(targetRoot, triageFile);
  const triageWrite = writeJsonIfChanged(triageTarget, triage);

  let summaryWrite = null;
  if (summaryFile && renderScript && typeof runNodeScript === "function") {
    const summaryTarget = resolveRuntimePath(targetRoot, summaryFile);
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
