import path from "node:path";
import {
  readWorkflowAdapterConfig,
  readWorkflowAdapterConfigFile,
  writeWorkflowAdapterConfig,
  writeWorkflowAdapterConfigFile,
} from "../../lib/config/workflow-adapter-config-lib.mjs";
import { runWorkflowAdapterConfigWizard } from "./workflow-adapter-config-wizard.mjs";
import { executeWorkflowAdapterMigration } from "./workflow-adapter-migration-service.mjs";

function buildDefaults(targetRoot, defaults = {}) {
  return {
    projectName: String(defaults.projectName ?? "").trim() || path.basename(path.resolve(targetRoot)),
    preferredStateMode: defaults.preferredStateMode,
    defaultIndexStore: defaults.defaultIndexStore,
  };
}

export function loadWorkflowAdapterConfigState({ targetRoot, defaults = {} }) {
  return readWorkflowAdapterConfig(targetRoot, buildDefaults(targetRoot, defaults));
}

export function initializeWorkflowAdapterConfigFromFile({ targetRoot, sourceFile, defaults = {}, dryRun = false }) {
  const targetState = loadWorkflowAdapterConfigState({ targetRoot, defaults });
  if (targetState.exists) {
    throw new Error(
      `Workflow adapter config already exists at ${targetState.path}. Refusing to overwrite it from --adapter-file.`,
    );
  }
  if (!sourceFile) {
    throw new Error("Missing adapter config source file.");
  }
  const sourceState = readWorkflowAdapterConfigFile(sourceFile, buildDefaults(targetRoot, defaults));
  if (!sourceState.exists) {
    throw new Error(`Adapter config source file not found: ${path.resolve(sourceFile)}`);
  }
  if (!dryRun) {
    writeWorkflowAdapterConfig(targetRoot, sourceState.data, buildDefaults(targetRoot, defaults));
  }
  return {
    created: !dryRun,
    dryRun,
    path: targetState.path,
    data: sourceState.data,
    source: sourceState.path,
  };
}

export function initializeWorkflowAdapterConfigDefaults({ targetRoot, defaults = {}, dryRun = false }) {
  const targetState = loadWorkflowAdapterConfigState({ targetRoot, defaults });
  if (targetState.exists) {
    return {
      exists: true,
      created: false,
      dryRun,
      path: targetState.path,
      data: targetState.data,
      source: "target",
    };
  }
  if (!dryRun) {
    writeWorkflowAdapterConfig(targetRoot, targetState.data, buildDefaults(targetRoot, defaults));
  }
  return {
    exists: !dryRun,
    created: !dryRun,
    dryRun,
    path: targetState.path,
    data: targetState.data,
    source: "defaults",
  };
}

export async function ensureWorkflowAdapterConfig({
  targetRoot,
  defaults = {},
  dryRun = false,
  verifyOnly = false,
  adapterFile = "",
  initDefaults = false,
}) {
  const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
  if (state.exists) {
    return {
      exists: true,
      created: false,
      path: state.path,
      data: state.data,
      source: "target",
    };
  }

  if (adapterFile) {
    return initializeWorkflowAdapterConfigFromFile({
      targetRoot,
      sourceFile: adapterFile,
      defaults,
      dryRun,
    });
  }

  if (initDefaults) {
    return initializeWorkflowAdapterConfigDefaults({
      targetRoot,
      defaults,
      dryRun,
    });
  }

  if (verifyOnly) {
    return {
      exists: false,
      created: false,
      path: state.path,
      data: state.data,
      source: "missing-verify",
    };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY || dryRun) {
    throw new Error(
      [
        `Missing workflow adapter config: ${state.path}`,
        "Run the install in an interactive terminal to launch the wizard,",
        "provide --adapter-file <path>, or use --init-defaults for a minimal generated config.",
      ].join(" "),
    );
  }

  const wizard = await runWorkflowAdapterConfigWizard({
    initialConfig: state.data,
    defaults: buildDefaults(targetRoot, defaults),
  });
  if (!wizard.saved) {
    throw new Error("Workflow adapter config creation cancelled.");
  }
  writeWorkflowAdapterConfig(targetRoot, wizard.data, buildDefaults(targetRoot, defaults));
  return {
    exists: true,
    created: true,
    path: state.path,
    data: wizard.data,
    source: "wizard",
  };
}

export async function runProjectConfigUseCase({
  args,
  targetRoot,
  repoRoot = process.cwd(),
}) {
  const defaults = {
    projectName: args.projectName,
    preferredStateMode: args.preferredStateMode,
    defaultIndexStore: args.defaultIndexStore,
  };

  if (args.migrateAdapter) {
    return executeWorkflowAdapterMigration({
      repoRoot,
      targetRoot,
      version: args.version ?? "",
      dryRun: args.dryRun === true,
    });
  }

  if (args.list) {
    const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
    return {
      ok: true,
      action: "list",
      target_root: targetRoot,
      exists: state.exists,
      path: state.path,
      config: state.exists ? state.data : null,
    };
  }

  if (args.adapterFile) {
    const created = initializeWorkflowAdapterConfigFromFile({
      targetRoot,
      sourceFile: args.adapterFile,
      defaults,
      dryRun: false,
    });
    return {
      ok: true,
      action: "init-from-file",
      target_root: targetRoot,
      exists: true,
      created: created.created,
      path: created.path,
      config: created.data,
    };
  }

  if (args.initDefaults) {
    const initialized = initializeWorkflowAdapterConfigDefaults({
      targetRoot,
      defaults,
      dryRun: args.dryRun === true,
    });
    return {
      ok: true,
      action: initialized.created ? "init-defaults" : "init-defaults-existing",
      target_root: targetRoot,
      exists: initialized.exists,
      created: initialized.created,
      dry_run: initialized.dryRun,
      path: initialized.path,
      config: initialized.data,
    };
  }

  const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
  const wizard = await runWorkflowAdapterConfigWizard({
    initialConfig: state.data,
    defaults: buildDefaults(targetRoot, defaults),
  });
  if (!wizard.saved) {
    return {
      ok: false,
      action: "cancelled",
      target_root: targetRoot,
      exists: state.exists,
      created: false,
      path: state.path,
      config: state.exists ? state.data : null,
    };
  }
  const filePath = state.exists
    ? writeWorkflowAdapterConfig(targetRoot, wizard.data, buildDefaults(targetRoot, defaults))
    : writeWorkflowAdapterConfig(targetRoot, wizard.data, buildDefaults(targetRoot, defaults));
  return {
    ok: true,
    action: state.exists ? "updated" : "created",
    target_root: targetRoot,
    exists: true,
    created: !state.exists,
    path: filePath,
    config: wizard.data,
  };
}
