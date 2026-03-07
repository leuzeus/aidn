import { resolveEffectiveRuntimeMode } from "./runtime-mode-service.mjs";
import { requiresStrictRuntime } from "../../core/state-mode/state-mode-policy.mjs";

export function runSyncDbFirstUseCase({ args, targetRoot, processAdapter, perfIndexSyncScript }) {
  const runtimeMode = resolveEffectiveRuntimeMode({
    targetRoot,
    stateMode: args.stateMode,
    indexStore: args.store || "file",
    indexStoreExplicit: Boolean(args.store),
  });
  const strictByState = requiresStrictRuntime(runtimeMode.stateMode);
  const strict = args.strict || strictByState;

  if (runtimeMode.stateMode === "files" && !args.forceInFiles) {
    return {
      ts: new Date().toISOString(),
      ok: true,
      skipped: true,
      reason: "state_mode_files",
      target_root: targetRoot,
      state_mode: runtimeMode.stateMode,
      strict,
    };
  }

  const payload = processAdapter.runJsonNodeScript(perfIndexSyncScript, [
    "--target",
    targetRoot,
    "--store",
    runtimeMode.indexStore,
    "--with-content",
    "--json",
  ]);

  return {
    ts: new Date().toISOString(),
    ok: true,
    skipped: false,
    target_root: targetRoot,
    state_mode: runtimeMode.stateMode,
    strict,
    store: runtimeMode.indexStore,
    payload,
  };
}
