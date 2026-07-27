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

function withEffect(result, {
  effectClass,
  written = false,
  writeTargets = [],
  plannedWriteTargets = [],
}) {
  return {
    ...result,
    effect_class: effectClass,
    written: Boolean(written),
    write_targets: written ? [...writeTargets] : [],
    planned_write_targets: [...plannedWriteTargets],
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
    const write = args.write === true;
    const result = executeWorkflowAdapterMigration({
      repoRoot,
      targetRoot,
      version: args.version ?? "",
      dryRun: !write,
    });
    return withEffect(result, {
      effectClass: write ? "mutating" : "preview",
      written: write,
      writeTargets: [
        result.adapter_path,
        result.report_path,
        result.legacy_workflow_source_path,
        ...result.generated_docs.map((item) => path.resolve(targetRoot, item.target)),
      ],
      plannedWriteTargets: [
        result.adapter_path,
        result.report_path,
        result.legacy_workflow_source_path,
        ...result.generated_docs.map((item) => path.resolve(targetRoot, item.target)),
      ],
    });
  }

  if (args.list) {
    if (args.write) {
      throw new Error("--list is read-only and cannot be combined with --write");
    }
    const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
    return withEffect({
      ok: true,
      action: "list",
      target_root: targetRoot,
      exists: state.exists,
      path: state.path,
      config: state.exists ? state.data : null,
    }, {
      effectClass: "read-only",
    });
  }

  if (args.adapterFile) {
    const created = initializeWorkflowAdapterConfigFromFile({
      targetRoot,
      sourceFile: args.adapterFile,
      defaults,
      dryRun: args.write !== true,
    });
    const writeRequested = args.write === true;
    const written = writeRequested && created.created === true;
    return withEffect({
      ok: true,
      action: written ? "init-from-file" : "preview-init-from-file",
      target_root: targetRoot,
      exists: written,
      created: created.created,
      dry_run: !written,
      path: created.path,
      config: created.data,
    }, {
      effectClass: writeRequested ? "mutating" : "preview",
      written,
      writeTargets: [created.path],
      plannedWriteTargets: [created.path],
    });
  }

  if (args.initDefaults) {
    const initialized = initializeWorkflowAdapterConfigDefaults({
      targetRoot,
      defaults,
      dryRun: args.write !== true,
    });
    const writeRequested = args.write === true;
    const written = writeRequested && initialized.created === true;
    return withEffect({
      ok: true,
      action: initialized.created
        ? "init-defaults"
        : initialized.exists
          ? "init-defaults-existing"
          : "preview-init-defaults",
      target_root: targetRoot,
      exists: initialized.exists,
      created: initialized.created,
      dry_run: !written,
      path: initialized.path,
      config: initialized.data,
    }, {
      effectClass: writeRequested ? "mutating" : "preview",
      written,
      writeTargets: [initialized.path],
      plannedWriteTargets: [initialized.path],
    });
  }

  if (args.write !== true) {
    throw new Error("Project config wizard writes configuration; rerun with --write");
  }
  const state = loadWorkflowAdapterConfigState({ targetRoot, defaults });
  const wizard = await runWorkflowAdapterConfigWizard({
    initialConfig: state.data,
    defaults: buildDefaults(targetRoot, defaults),
  });
  if (!wizard.saved) {
    return withEffect({
      ok: false,
      action: "cancelled",
      target_root: targetRoot,
      exists: state.exists,
      created: false,
      path: state.path,
      config: state.exists ? state.data : null,
    }, {
      effectClass: "mutating",
    });
  }
  const filePath = state.exists
    ? writeWorkflowAdapterConfig(targetRoot, wizard.data, buildDefaults(targetRoot, defaults))
    : writeWorkflowAdapterConfig(targetRoot, wizard.data, buildDefaults(targetRoot, defaults));
  return withEffect({
    ok: true,
    action: state.exists ? "updated" : "created",
    target_root: targetRoot,
    exists: true,
    created: !state.exists,
    path: filePath,
    config: wizard.data,
  }, {
    effectClass: "mutating",
    written: true,
    writeTargets: [filePath],
    plannedWriteTargets: [filePath],
  });
}
