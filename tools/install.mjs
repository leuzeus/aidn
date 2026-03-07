#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  defaultIndexStoreFromStateMode,
  normalizeIndexStoreMode,
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigIndexStore,
  resolveConfigStateMode,
  stateModeFromIndexStore,
  writeAidnProjectConfig,
} from "./aidn-config-lib.mjs";
import {
  loadWorkflowManifests,
  resolvePackOrder,
} from "../src/application/install/manifest-loader.mjs";
import {
  formatCompatibility,
  resolveCompatibility,
  validateRuntimeCompatibility,
} from "../src/application/install/compatibility-policy.mjs";
import { buildNextAidnProjectConfig } from "../src/application/install/project-config-service.mjs";
import {
  CUSTOMIZABLE_TARGET_PATTERNS,
  collectExistingPlaceholderValues,
  getWorkflowPlaceholders,
  resolveMissingPlaceholdersForCopyOp,
} from "../src/application/install/custom-file-policy.mjs";
import {
  copyRecursive,
  shouldRenderTemplate,
} from "../src/application/install/template-copy-service.mjs";
import {
  mergeAppendUnique,
  mergeBlock,
  shouldSkipAgentsMerge,
} from "../src/application/install/template-merge-service.mjs";
import { readUtf8, writeUtf8 } from "../src/application/install/template-io.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    pack: "",
    dryRun: false,
    verifyOnly: false,
    skipArtifactImport: false,
    artifactImportStore: "",
    assist: false,
    strict: false,
    skipAgents: false,
    forceAgentsMerge: false,
    codexMigrateCustom: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--pack") {
      args.pack = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verify") {
      args.verifyOnly = true;
    } else if (token === "--skip-artifact-import") {
      args.skipArtifactImport = true;
    } else if (token === "--artifact-import-store") {
      args.artifactImportStore = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--assist") {
      args.assist = true;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--skip-agents") {
      args.skipAgents = true;
    } else if (token === "--force-agents-merge") {
      args.forceAgentsMerge = true;
    } else if (token === "--no-codex-migrate-custom") {
      args.codexMigrateCustom = false;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.target) {
    throw new Error("Missing required argument value: --target");
  }
  if (args.artifactImportStore && !normalizeIndexStoreMode(args.artifactImportStore)) {
    throw new Error("Invalid --artifact-import-store. Expected file|sql|dual|sqlite|dual-sqlite|all");
  }

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/install.mjs --target ../repo");
  console.log("  node tools/install.mjs --target ../repo --pack core");
  console.log("  node tools/install.mjs --target . --pack core --dry-run");
  console.log("  node tools/install.mjs --target . --pack core --verify");
  console.log("  node tools/install.mjs --target . --pack core --skip-artifact-import");
  console.log("  node tools/install.mjs --target . --pack core --artifact-import-store dual-sqlite");
  console.log("  node tools/install.mjs --target ../repo --pack core --assist");
  console.log("  node tools/install.mjs --target ../repo --pack core --strict");
  console.log("  node tools/install.mjs --target ../repo --pack core --skip-agents");
  console.log("  node tools/install.mjs --target ../repo --pack core --force-agents-merge");
  console.log("  node tools/install.mjs --target ../repo --pack core --no-codex-migrate-custom");
}

function resolveArtifactImportDefaults(args, configData = {}) {
  const explicitStore = normalizeIndexStoreMode(args?.artifactImportStore);
  if (explicitStore) {
    return {
      store: explicitStore,
      withContent: explicitStore === "sqlite" || explicitStore === "dual-sqlite" || explicitStore === "all",
      stateMode: stateModeFromIndexStore(explicitStore),
      source: "cli",
    };
  }

  const envStore = normalizeIndexStoreMode(process.env.AIDN_INDEX_STORE_MODE);
  if (envStore) {
    return {
      store: envStore,
      withContent: envStore === "sqlite" || envStore === "dual-sqlite" || envStore === "all",
      stateMode: stateModeFromIndexStore(envStore),
      source: "env-index-store",
    };
  }

  const envStateMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envStateMode) {
    const store = defaultIndexStoreFromStateMode(envStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: envStateMode,
      source: "env-state-mode",
    };
  }

  const configStore = resolveConfigIndexStore(configData);
  if (configStore) {
    return {
      store: configStore,
      withContent: configStore === "sqlite" || configStore === "dual-sqlite" || configStore === "all",
      stateMode: stateModeFromIndexStore(configStore),
      source: "config-index-store",
    };
  }

  const configStateMode = resolveConfigStateMode(configData);
  if (configStateMode) {
    const store = defaultIndexStoreFromStateMode(configStateMode);
    return {
      store,
      withContent: store === "sqlite" || store === "dual-sqlite" || store === "all",
      stateMode: configStateMode,
      source: "config-state-mode",
    };
  }

  return {
    store: "dual-sqlite",
    withContent: true,
    stateMode: "dual",
    source: "default",
  };
}

function runArtifactImport(repoRoot, targetRoot, dryRun, args, configData = {}) {
  const defaults = resolveArtifactImportDefaults(args, configData);
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      attempted: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults,
    };
  }
  const scriptPath = path.join(repoRoot, "tools", "perf", "index-sync.mjs");
  if (!fs.existsSync(scriptPath)) {
    return {
      attempted: false,
      skipped: true,
      reason: "tools/perf/index-sync.mjs not found",
      defaults,
    };
  }
  const cmd = [
    scriptPath,
    "--target",
    targetRoot,
    "--store",
    defaults.store,
    "--json",
  ];
  if (defaults.withContent) {
    cmd.push("--with-content");
  }

  if (dryRun) {
    return {
      attempted: false,
      skipped: true,
      dryRun: true,
      reason: `dry-run (would run index-sync store=${defaults.store}, state_mode=${defaults.stateMode}, source=${defaults.source})`,
    };
  }

  const result = spawnSync(process.execPath, cmd, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `process error: ${result.error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }
  if (result.status !== 0) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `exit ${result.status}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? "{}"));
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      ok: false,
      reason: `invalid JSON output from index-sync: ${error.message}`,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  return {
    attempted: true,
    skipped: false,
    ok: true,
    payload,
    defaults,
  };
}

function expectedArtifactImportFilesForStore(store) {
  const base = ".aidn/runtime/index";
  if (store === "file") {
    return [`${base}/workflow-index.json`];
  }
  if (store === "sql") {
    return [`${base}/workflow-index.sql`];
  }
  if (store === "dual") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sql`];
  }
  if (store === "sqlite") {
    return [`${base}/workflow-index.sqlite`];
  }
  if (store === "dual-sqlite") {
    return [`${base}/workflow-index.json`, `${base}/workflow-index.sqlite`];
  }
  if (store === "all") {
    return [
      `${base}/workflow-index.json`,
      `${base}/workflow-index.sql`,
      `${base}/workflow-index.sqlite`,
    ];
  }
  return [];
}

function verifyArtifactImportOutputs(targetRoot, args, configData = {}) {
  if (args.dryRun) {
    return {
      checked: false,
      skipped: true,
      reason: "dry-run",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  if (args.skipArtifactImport) {
    return {
      checked: false,
      skipped: true,
      reason: "explicit --skip-artifact-import",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const auditRoot = path.resolve(targetRoot, "docs", "audit");
  if (!fs.existsSync(auditRoot)) {
    return {
      checked: false,
      skipped: true,
      reason: "docs/audit not found",
      defaults: resolveArtifactImportDefaults(args, configData),
      expected_files: [],
      missing_files: [],
    };
  }
  const defaults = resolveArtifactImportDefaults(args, configData);
  const expected = expectedArtifactImportFilesForStore(defaults.store);
  const missing = expected.filter((relativePath) => !fs.existsSync(path.resolve(targetRoot, relativePath)));
  return {
    checked: true,
    skipped: false,
    ok: missing.length === 0,
    defaults,
    expected_files: expected,
    missing_files: missing,
  };
}


function buildCodexMigrationPrompt(relativeTargetPath, sourceRendered) {
  const ext = path.extname(relativeTargetPath).toLowerCase();
  const fence = ext === ".md" ? "markdown" : (ext === ".yaml" || ext === ".yml" ? "yaml" : "");
  return [
    "Migrate one customized workflow file in-place.",
    `Target file: ${relativeTargetPath}`,
    "Instructions:",
    "- Keep project-specific customizations and local decisions.",
    "- Integrate missing structure or guardrails from the provided updated template when relevant.",
    "- The updated template already contains resolved metadata placeholders; preserve equivalent local values.",
    "- Force installed metadata version values from the template (for example workflow_version and skills ref/tag URLs).",
    "- Do not re-introduce unresolved placeholders.",
    "- Preserve valid syntax and readability.",
    "- Edit only the target file and save it.",
    "",
    "Updated template content:",
    `\`\`\`${fence}`,
    sourceRendered,
    "```",
  ].join("\n");
}

function migrateCustomFileWithCodex(targetRoot, candidate, dryRun) {
  if (dryRun) {
    return { attempted: false, migrated: false, reason: "dry-run" };
  }
  if (!candidate.sourceRendered) {
    return { attempted: false, migrated: false, reason: "non-text-template" };
  }

  const prompt = buildCodexMigrationPrompt(candidate.targetRelative, candidate.sourceRendered);
  let result;
  if (process.platform === "win32") {
    const escapedTarget = String(targetRoot).replace(/"/g, '\\"');
    result = spawnSync(`codex exec --full-auto -C "${escapedTarget}" -`, {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
    });
  } else {
    result = spawnSync("codex", [
      "exec",
      "--full-auto",
      "-C",
      targetRoot,
      "-",
    ], {
      input: prompt,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  if (result.error) {
    return { attempted: true, migrated: false, reason: `error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    return {
      attempted: true,
      migrated: false,
      reason: stderr ? `exit ${result.status}: ${stderr}` : `exit ${result.status}`,
    };
  }

  return { attempted: true, migrated: true, reason: "ok" };
}

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

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "..");
    const targetRoot = path.resolve(process.cwd(), args.target);
    const configRead = readAidnProjectConfig(targetRoot);
    let currentAidnConfigData = configRead.data ?? {};
    let aidnConfigExists = configRead.exists === true;
    const version = readUtf8(path.join(repoRoot, "VERSION")).trim();
    const inferredTemplateVars = collectExistingPlaceholderValues(targetRoot);
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
        args,
      );
      const currentConfigJson = JSON.stringify(currentAidnConfigData);
      const nextConfigJson = JSON.stringify(nextAidnConfigData);
      if (currentConfigJson !== nextConfigJson) {
        if (args.dryRun) {
          console.log(
            `[dry-run] ${aidnConfigExists ? "update" : "create"} .aidn/config.json (profile=${nextAidnConfigData.profile}, runtime.stateMode=${nextAidnConfigData.runtime?.stateMode}, install.artifactImportStore=${nextAidnConfigData.install?.artifactImportStore})`,
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
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
