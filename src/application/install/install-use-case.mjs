import fs from "node:fs";
import path from "node:path";
import {
  readAidnProjectConfig,
  writeAidnProjectConfig,
} from "../../lib/config/aidn-config-lib.mjs";
import {
  loadWorkflowManifests,
  resolvePackOrder,
} from "./manifest-loader.mjs";
import {
  formatCompatibility,
  resolveCompatibility,
  validateRuntimeCompatibility,
} from "./compatibility-policy.mjs";
import { buildNextAidnProjectConfig } from "./project-config-service.mjs";
import {
  resolveArtifactImportDefaults,
  runArtifactImport,
  verifyArtifactImportOutputs,
} from "./artifact-import-service.mjs";
import { migrateCustomFileWithCodex } from "../../adapters/codex/codex-migrate-custom.mjs";
import {
  CUSTOMIZABLE_TARGET_PATTERNS,
  collectExistingPlaceholderValues,
  getWorkflowPlaceholders,
  resolveInstallSourceBranch,
  resolveMissingPlaceholdersForCopyOp,
} from "./custom-file-policy.mjs";
import {
  copyRecursive,
  shouldRenderTemplate,
} from "./template-copy-service.mjs";
import { ensureWorkflowAdapterConfig } from "../project/project-config-use-case.mjs";
import { buildGeneratedDocTemplateVars } from "./generated-doc-template-vars.mjs";
import { renderManagedInstallDocs } from "./generated-doc-render-service.mjs";
import {
  mergeAppendUnique,
  mergeBlock,
  shouldSkipAgentsMerge,
} from "./template-merge-service.mjs";
import { readUtf8 } from "./template-io.mjs";

function verifyPaths(targetRoot, pathsToCheck) {
  const missing = [];
  for (const relativePath of pathsToCheck) {
    const absolute = path.resolve(targetRoot, relativePath);
    if (!fs.existsSync(absolute)) {
      missing.push(relativePath);
    }
  }
  return { ok: missing.length === 0, missing };
}

function collectInstructionPrecedenceWarnings(targetRoot) {
  const warnings = [];
  const rootAgentsOverride = path.resolve(targetRoot, "AGENTS.override.md");
  if (fs.existsSync(rootAgentsOverride)) {
    warnings.push(
      "Target root contains AGENTS.override.md. Codex will prefer it over the installed AGENTS.md.",
    );
  }
  return warnings;
}

export async function runInstallUseCase({ args, repoRoot, targetRoot }) {
  const configRead = readAidnProjectConfig(targetRoot);
  let currentAidnConfigData = configRead.data ?? {};
  let aidnConfigExists = configRead.exists === true;
  const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
  const inferredTemplateVars = collectExistingPlaceholderValues(targetRoot);
  delete inferredTemplateVars.SOURCE_BRANCH;
  const templateVars = {
    ...inferredTemplateVars,
    VERSION: version,
  };
  const { workflowManifest, compatMatrix } = loadWorkflowManifests(repoRoot);
  const compatibility = resolveCompatibility(workflowManifest, compatMatrix);
  const runtime = validateRuntimeCompatibility(compatibility);

  const workflowPacks = workflowManifest?.packs ?? [];
  if (workflowManifest && !Array.isArray(workflowPacks)) {
    throw new Error("workflow.manifest packs must be an array");
  }
  const requestedPacks = args.pack ? [args.pack] : workflowPacks;
  if (!requestedPacks || requestedPacks.length === 0) {
    throw new Error("No pack selected. Use --pack or define packs in workflow manifest.");
  }

  const { ordered: selectedPacks, packCache } = resolvePackOrder(
    repoRoot,
    requestedPacks,
  );
  const summary = {
    copied: 0,
    merged: 0,
    skipped: 0,
    preservedCustom: 0,
    preservedPlaceholdersApplied: 0,
    migratedCustom: 0,
    migrationFailed: 0,
    placeholderPrompted: 0,
    placeholderAutoFilled: 0,
    artifactImportAttempted: 0,
    artifactImportSucceeded: 0,
    artifactImportSkipped: 0,
    artifactImportVerified: 0,
    artifactImportVerifyFail: 0,
    artifactImportVerifySkipped: 0,
    configCreated: 0,
    configUpdated: 0,
    configSkipped: 0,
    generatedRendered: 0,
    generatedUnchanged: 0,
  };
  const initialImportDefaults = resolveArtifactImportDefaults(args, currentAidnConfigData);
  const resolvedSourceBranch = await resolveInstallSourceBranch({
    explicitSourceBranch: args.sourceBranch,
    configData: currentAidnConfigData,
    targetRoot,
    dryRun: args.dryRun,
    summary,
  });
  if (resolvedSourceBranch.value) {
    templateVars.SOURCE_BRANCH = resolvedSourceBranch.value;
  }
  const workflowAdapterConfig = await ensureWorkflowAdapterConfig({
    targetRoot,
    dryRun: args.dryRun,
    verifyOnly: args.verifyOnly,
    adapterFile: args.adapterFile,
    defaults: {
      projectName: path.basename(targetRoot),
      preferredStateMode: initialImportDefaults.stateMode,
      defaultIndexStore: initialImportDefaults.store,
    },
  });
  if (workflowAdapterConfig?.data?.projectName) {
    templateVars.PROJECT_NAME = workflowAdapterConfig.data.projectName;
  }
  Object.assign(
    templateVars,
    buildGeneratedDocTemplateVars({
      templateVars,
      aidnConfigData: currentAidnConfigData,
      workflowAdapterConfig,
    }),
  );
  const generatedDocExistingContent = {
    "docs/audit/workflow.md": fs.existsSync(path.join(targetRoot, "docs", "audit", "WORKFLOW.md"))
      ? readUtf8(path.join(targetRoot, "docs", "audit", "WORKFLOW.md"))
      : null,
    "docs/audit/workflow_summary.md": fs.existsSync(path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
      ? readUtf8(path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md"))
      : null,
    "docs/audit/codex_online.md": fs.existsSync(path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
      ? readUtf8(path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md"))
      : null,
    "docs/audit/index.md": fs.existsSync(path.join(targetRoot, "docs", "audit", "index.md"))
      ? readUtf8(path.join(targetRoot, "docs", "audit", "index.md"))
      : null,
  };
  const preservedCustomCandidates = [];

  console.log(`Product version: ${version}`);
  console.log(`Packs: ${selectedPacks.join(", ")}`);
  console.log(`Target: ${targetRoot}`);
  console.log(`Compatibility policy: ${formatCompatibility(compatibility)}`);
  console.log(
    `Prereq check: OK (node ${runtime.node}, os ${runtime.os}, codex ${runtime.codexInstalled ? "installed" : "missing"}, auth ${runtime.codexAuthenticated ? "ok" : "missing"})`,
  );
  console.log(
    `Custom-file policy: preserve=${CUSTOMIZABLE_TARGET_PATTERNS.length} patterns, codex_migrate=${args.codexMigrateCustom ? "enabled" : "disabled"}`,
  );
  if (Object.keys(inferredTemplateVars).length > 0) {
    console.log(`Placeholder inference: loaded ${Object.keys(inferredTemplateVars).length} values from existing project files`);
  }
  if (templateVars.SOURCE_BRANCH) {
    console.log(`Install metadata: source_branch=${templateVars.SOURCE_BRANCH} (${resolvedSourceBranch.source})`);
  }
  if (workflowAdapterConfig?.path) {
    console.log(
      `Workflow adapter config: ${workflowAdapterConfig.path} (${workflowAdapterConfig.source}${workflowAdapterConfig.created ? ", created" : ""})`,
    );
  }
  if (args.dryRun) {
    console.log("Mode: dry-run");
  } else if (args.verifyOnly) {
    console.log("Mode: verify");
  } else {
    console.log("Mode: install");
  }

  if (!args.verifyOnly) {
    for (const packName of selectedPacks) {
      const packInfo = packCache.get(packName);
      const manifest = packInfo.manifest;
      const copyOps = manifest.install?.copy ?? [];
      const mergeOps = manifest.install?.merge ?? [];
      const explicitFileSources = new Set();

      for (const op of copyOps) {
        const sourcePath = path.resolve(repoRoot, op.from);
        if (!fs.existsSync(sourcePath)) {
          continue;
        }
        if (fs.statSync(sourcePath).isFile()) {
          explicitFileSources.add(path.resolve(sourcePath));
        }
      }

      for (const op of copyOps) {
        const sourcePath = path.resolve(repoRoot, op.from);
        const targetPath = path.resolve(targetRoot, op.to);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Copy source does not exist: ${op.from}`);
        }

        const sourceStat = fs.statSync(sourcePath);
        await resolveMissingPlaceholdersForCopyOp({
          sourcePath,
          targetPath,
          skipSources: sourceStat.isDirectory() ? explicitFileSources : null,
          templateVars,
          targetRoot,
          dryRun: args.dryRun,
          summary,
          shouldRenderTemplate,
        });

        console.log(
          `${args.dryRun ? "[dry-run] " : ""}copy ${op.from} -> ${op.to} (pack ${packName})`,
        );
        const copyPolicy = {
          targetRoot,
          preserveCustomizableFiles: true,
          onPreservedPlaceholderApplied(info) {
            summary.preservedPlaceholdersApplied += 1;
            console.log(
              `${args.dryRun ? "[dry-run] " : ""}apply placeholders in preserved file: ${info.targetRelative}`,
            );
          },
          onPreservedCustomFile(candidate) {
            if (!candidate.differsFromTemplate) {
              return;
            }
            preservedCustomCandidates.push(candidate);
          },
          onOwnershipSkip(info) {
            console.log(
              `${args.dryRun ? "[dry-run] " : ""}skip copy ${info.targetRelative} (${info.ownership})`,
            );
          },
        };
        if (sourceStat.isDirectory()) {
          copyRecursive(
            sourcePath,
            targetPath,
            args.dryRun,
            explicitFileSources,
            templateVars,
            copyPolicy,
          );
        } else {
          copyRecursive(sourcePath, targetPath, args.dryRun, null, templateVars, copyPolicy);
        }
        summary.copied += 1;
      }

      for (const op of mergeOps) {
        const sourcePath = path.resolve(repoRoot, op.from);
        const targetPath = path.resolve(targetRoot, op.to);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Merge source does not exist: ${op.from}`);
        }
        const agentsPolicy = shouldSkipAgentsMerge(targetPath, args);
        if (agentsPolicy.skip) {
          console.log(
            `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, ${agentsPolicy.reason})`,
          );
          summary.skipped += 1;
          continue;
        }

        let result;
        if (op.strategy === "block") {
          result = await mergeBlock(sourcePath, targetPath, args.dryRun, {
            assist: args.assist,
            strict: args.strict,
            templateVars,
          });
        } else if (op.strategy === "append_unique") {
          result = mergeAppendUnique(sourcePath, targetPath, args.dryRun, templateVars);
        } else {
          throw new Error(`Unsupported merge strategy: ${op.strategy}`);
        }

        if (result.skippedByAssist) {
          console.log(
            `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, not approved in assist mode)`,
          );
          summary.skipped += 1;
        } else if (result.changed) {
          console.log(
            `${args.dryRun ? "[dry-run] " : ""}merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName})`,
          );
          summary.merged += 1;
        } else {
          console.log(
            `skip merge ${op.from} -> ${op.to} (${op.strategy}, pack ${packName}, no changes)`,
          );
          summary.skipped += 1;
        }
      }
    }

    const generatedDocs = renderManagedInstallDocs({
      repoRoot,
      targetRoot,
      dryRun: args.dryRun,
      templateVars,
      existingContentByTarget: generatedDocExistingContent,
    });
    for (const item of generatedDocs) {
      console.log(
        `${args.dryRun ? "[dry-run] " : ""}render generated doc: ${item.targetRelative} (${item.changed ? "updated" : "unchanged"})`,
      );
      if (item.changed) {
        summary.generatedRendered += 1;
      } else {
        summary.generatedUnchanged += 1;
      }
    }

    const uniqueCandidates = Array.from(
      new Map(preservedCustomCandidates.map((item) => [item.targetRelative.toLowerCase(), item])).values(),
    );
    summary.preservedCustom = uniqueCandidates.length;

    if (uniqueCandidates.length > 0) {
      console.log("");
      console.log("Preserved customized files (not overwritten):");
      for (const item of uniqueCandidates) {
        console.log(`- ${item.targetRelative}`);
      }
    }

    if (uniqueCandidates.length > 0 && args.codexMigrateCustom) {
      if (!runtime.codexInstalled) {
        console.warn("");
        console.warn("Codex migration skipped: codex command not found. Preserved files were left unchanged.");
      } else if (!runtime.codexAuthenticated) {
        console.warn("");
        console.warn("Codex migration skipped: codex is not authenticated. Run `codex login` then retry.");
      } else {
        for (const item of uniqueCandidates) {
          console.log(
            `${args.dryRun ? "[dry-run] " : ""}migrate custom file via codex: ${item.targetRelative}`,
          );
          const migration = migrateCustomFileWithCodex(targetRoot, item, args.dryRun);
          if (migration.migrated) {
            summary.migratedCustom += 1;
          } else if (migration.attempted) {
            summary.migrationFailed += 1;
            console.warn(`migration failed: ${item.targetRelative} (${migration.reason})`);
          } else {
            console.warn(`migration skipped: ${item.targetRelative} (${migration.reason})`);
          }
        }
      }
    } else if (uniqueCandidates.length > 0) {
      console.log("");
      console.log("Codex migration disabled: preserved customized files were left unchanged.");
    }

    let resolvedImportDefaults = resolveArtifactImportDefaults(args, currentAidnConfigData);
    if (args.skipArtifactImport) {
      summary.artifactImportSkipped += 1;
      console.log("artifact import skipped: explicit --skip-artifact-import");
    } else {
      const artifactImport = runArtifactImport(repoRoot, targetRoot, args.dryRun, args, currentAidnConfigData);
      resolvedImportDefaults = artifactImport.defaults ?? resolvedImportDefaults;
      if (artifactImport.skipped) {
        summary.artifactImportSkipped += 1;
        const prefix = args.dryRun ? "[dry-run] " : "";
        console.log(`${prefix}artifact import skipped: ${artifactImport.reason}`);
      } else if (artifactImport.ok) {
        summary.artifactImportAttempted += 1;
        summary.artifactImportSucceeded += 1;
        const payload = artifactImport.payload ?? {};
        const defaults = artifactImport.defaults ?? {};
        const outputs = Array.isArray(payload.outputs)
          ? payload.outputs.map((row) => `${row.kind}:${path.relative(targetRoot, row.path ?? "")}`).join(", ")
          : "";
        console.log(
          `artifact import: OK (store=${payload.store ?? "n/a"}, state_mode=${payload.state_mode ?? "n/a"}, source=${defaults.source ?? "n/a"}, artifacts=${payload.summary?.artifacts_count ?? "n/a"}${outputs ? `, outputs=${outputs}` : ""})`,
        );
        const importVerification = verifyArtifactImportOutputs(targetRoot, args, currentAidnConfigData);
        if (importVerification.checked) {
          if (importVerification.ok) {
            summary.artifactImportVerified += 1;
          } else {
            summary.artifactImportVerifyFail += 1;
            throw new Error(
              `Artifact import verification failed for store=${importVerification.defaults?.store ?? "unknown"}: missing ${importVerification.missing_files.join(", ")}`,
            );
          }
        } else {
          summary.artifactImportVerifySkipped += 1;
        }
      } else {
        summary.artifactImportAttempted += 1;
        const stderr = String(artifactImport.stderr ?? "").trim();
        const stdout = String(artifactImport.stdout ?? "").trim();
        const details = stderr || stdout || artifactImport.reason || "unknown error";
        throw new Error(`Artifact import failed: ${details}`);
      }
    }

    const nextAidnConfigData = buildNextAidnProjectConfig(
      currentAidnConfigData,
      resolvedImportDefaults,
      {
        ...args,
        sourceBranch: templateVars.SOURCE_BRANCH ?? args.sourceBranch,
      },
    );
    const currentConfigJson = JSON.stringify(currentAidnConfigData);
    const nextConfigJson = JSON.stringify(nextAidnConfigData);
    if (currentConfigJson !== nextConfigJson) {
      if (args.dryRun) {
        console.log(
          `[dry-run] ${aidnConfigExists ? "update" : "create"} .aidn/config.json (profile=${nextAidnConfigData.profile}, runtime.stateMode=${nextAidnConfigData.runtime?.stateMode}, install.artifactImportStore=${nextAidnConfigData.install?.artifactImportStore}, workflow.sourceBranch=${nextAidnConfigData.workflow?.sourceBranch ?? "n/a"})`,
        );
      } else {
        const configFilePath = writeAidnProjectConfig(targetRoot, nextAidnConfigData);
        console.log(
          `${aidnConfigExists ? "update" : "create"} .aidn/config.json -> ${configFilePath}`,
        );
      }
      if (aidnConfigExists) {
        summary.configUpdated += 1;
      } else {
        summary.configCreated += 1;
      }
      aidnConfigExists = true;
      currentAidnConfigData = nextAidnConfigData;
    } else {
      summary.configSkipped += 1;
    }
  }

  const verifyEntriesSet = new Set();
  for (const packName of selectedPacks) {
    const manifest = packCache.get(packName).manifest;
    const verifyEntries = manifest.verify?.must_exist ?? [];
    for (const entry of verifyEntries) {
      verifyEntriesSet.add(entry);
    }
  }
  const verifyEntries = Array.from(verifyEntriesSet);
  const verification = verifyPaths(targetRoot, verifyEntries);
  const artifactImportVerification = verifyArtifactImportOutputs(targetRoot, args, currentAidnConfigData);
  const workflowPlaceholders = getWorkflowPlaceholders(targetRoot);
  if (!verification.ok) {
    for (const missing of verification.missing) {
      console.error(`missing: ${missing}`);
    }
  }
  if (artifactImportVerification.checked && !artifactImportVerification.ok) {
    for (const missing of artifactImportVerification.missing_files) {
      console.error(`missing import artifact: ${missing}`);
    }
  }
  if (workflowPlaceholders.length > 0) {
    console.warn("");
    console.warn(
      `WARNING: docs/audit/WORKFLOW.md still has placeholders: ${workflowPlaceholders.join(", ")}`,
    );
    console.warn(
      'Customize the project stub. See docs/INSTALL.md sections "Spec vs Project Stub (Why both exist)" and "Step 4 - Customize docs/audit/WORKFLOW.md (Project Stub)".',
    );
  }
  const instructionPrecedenceWarnings = collectInstructionPrecedenceWarnings(targetRoot);
  if (instructionPrecedenceWarnings.length > 0) {
    console.warn("");
    for (const warning of instructionPrecedenceWarnings) {
      console.warn(`WARNING: ${warning}`);
    }
    console.warn(
      "Review Codex instruction precedence before relying on the installed project contract.",
    );
  }

  console.log("");
  console.log(`copied: ${summary.copied}`);
  console.log(`merged: ${summary.merged}`);
  console.log(`skipped: ${summary.skipped}`);
  console.log(`preserved_custom: ${summary.preservedCustom}`);
  console.log(`preserved_placeholders_applied: ${summary.preservedPlaceholdersApplied}`);
  console.log(`migrated_custom: ${summary.migratedCustom}`);
  console.log(`migration_failed: ${summary.migrationFailed}`);
  console.log(`placeholder_prompted: ${summary.placeholderPrompted}`);
  console.log(`placeholder_autofilled: ${summary.placeholderAutoFilled}`);
  console.log(`artifact_import_attempted: ${summary.artifactImportAttempted}`);
  console.log(`artifact_import_succeeded: ${summary.artifactImportSucceeded}`);
  console.log(`artifact_import_skipped: ${summary.artifactImportSkipped}`);
  console.log(`artifact_import_verify_ok: ${summary.artifactImportVerified}`);
  console.log(`artifact_import_verify_fail: ${summary.artifactImportVerifyFail}`);
  console.log(`artifact_import_verify_skipped: ${summary.artifactImportVerifySkipped}`);
  console.log(`config_created: ${summary.configCreated}`);
  console.log(`config_updated: ${summary.configUpdated}`);
  console.log(`config_skipped: ${summary.configSkipped}`);
  console.log(`generated_rendered: ${summary.generatedRendered}`);
  console.log(`generated_unchanged: ${summary.generatedUnchanged}`);
  if (artifactImportVerification.checked) {
    console.log(
      `artifact_import_verify: ${artifactImportVerification.ok ? "OK" : "FAIL"} (store=${artifactImportVerification.defaults?.store ?? "n/a"}, source=${artifactImportVerification.defaults?.source ?? "n/a"})`,
    );
  } else {
    console.log(
      `artifact_import_verify: SKIP (${artifactImportVerification.reason ?? "not checked"})`,
    );
  }
  console.log(`verified: ${verification.ok ? "OK" : "FAIL"}`);

  if ((artifactImportVerification.checked && !artifactImportVerification.ok) && (args.verifyOnly || !args.dryRun)) {
    process.exit(1);
  }
  if (!verification.ok && (args.verifyOnly || !args.dryRun)) {
    process.exit(1);
  }
}
