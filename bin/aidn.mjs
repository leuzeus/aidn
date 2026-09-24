#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { activationOptionArgs, classifyCliActivation, resolveInternalCliEffectClass } from "../src/core/cli/activation-policy.mjs";
import { resolveCliEffectClass } from "../src/core/cli/effect-policy.mjs";
import { readActivation } from "../src/application/install/project-activation-service.mjs";
import {
  getDirectCommandDescriptor,
  getGroupCommandDescriptor,
  listCommandGroups,
  listDirectCommandDescriptors,
  listGroupCommandDescriptors,
  validateCommandRegistryDescriptors,
} from "../src/core/cli/command-registry.mjs";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BIN_DIR, "..");
const VERSION_FILE = path.join(REPO_ROOT, "VERSION");
const GROUPS = new Set(listCommandGroups());

function commandNames(group) {
  return listGroupCommandDescriptors(group).map((item) => item.name).sort();
}

function printUsage() {
  const direct = listDirectCommandDescriptors().map((item) => item.name).sort();
  console.log("Usage:");
  console.log("  aidn <command> [options]");
  console.log("  aidn <group> <subcommand> [options]");
  console.log("");
  console.log(`Commands: ${direct.join(", ")}`);
  console.log(`Groups: ${[...GROUPS].sort().join(", ")}`);
  console.log("");
  console.log("Examples:");
  console.log("  aidn bootstrap --target . --profile default");
  console.log("  aidn install --target ../repo --pack core --dry-run");
  console.log("  aidn runtime db-migrate --target . --json");
  console.log("  aidn runtime db-migrate --target . --write --json");
  console.log("  aidn runtime local-daemon --status --json");
  console.log("  aidn runtime project-runtime-state --target . --write --json");
  console.log("  aidn runtime project-handoff-packet --target . --write --sync-relay --json");
  console.log("  aidn project config --target . --list --json");
  console.log("  aidn project config --target . --init-defaults --write --json");
  for (const group of [...GROUPS].sort()) {
    console.log("");
    console.log(`${group[0].toUpperCase()}${group.slice(1)} subcommands:`);
    console.log(`  ${commandNames(group).join(", ")}`);
  }
}

function printGroupUsage(group) {
  console.log(`Usage: aidn ${group} <subcommand> [options]`);
  console.log("");
  console.log("Subcommands:");
  console.log(`  ${commandNames(group).join(", ")}`);
}

function printVersion() {
  try {
    const version = fs.readFileSync(VERSION_FILE, "utf8").trim();
    console.log(version || "unknown");
  } catch {
    console.log("unknown");
  }
}

function checkActivation(descriptor, args) {
  const options = activationOptionArgs(args);
  let target = process.cwd(), invalidTarget = false;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--target") continue;
    const value = String(options[index + 1] ?? "").trim();
    if (!value || value.startsWith("-")) invalidTarget = true;
    else target = path.resolve(process.cwd(), value);
    index += 1;
  }
  const activation = invalidTarget
    ? { active: false, state: "degraded", errors: ["ACTIVATION_INVALID_TARGET_ARGUMENT"] }
    : readActivation({ targetRoot: target });
  if (activation.active) return true;
  const payload = {
    schema_version: 1,
    command: descriptor.command,
    effect_class: descriptor.visibility === "internal"
      ? resolveInternalCliEffectClass(descriptor, options)
      : resolveCliEffectClass(descriptor.command, args),
    ok: false,
    status: "blocked",
    code: "AIDN_ACTIVATION_REQUIRED",
    target_root: activation.identity?.target_root ?? target,
    activation: { state: activation.state, active: false },
    errors: activation.errors.length ? activation.errors : ["AIDN_ACTIVATION_REQUIRED"],
    written: false,
    refused: true,
  };
  // A refusal is machine-readable even without --json; no implementation module
  // has been loaded and no persistence adapter has been constructed at this point.
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
  return false;
}

function runDescriptor(descriptor, args) {
  if (descriptor.dispatch_kind === "builtin") {
    if (descriptor.group === "root" && descriptor.name === "help") {
      printUsage();
      return;
    }
    if (descriptor.group === "root" && descriptor.name === "version") {
      printVersion();
      return;
    }
    if (descriptor.name === "help" && GROUPS.has(descriptor.group)) {
      printGroupUsage(descriptor.group);
      return;
    }
    console.error(`ERROR: unsupported builtin descriptor: ${descriptor.id}`);
    process.exit(1);
  }
  const activationPolicy = classifyCliActivation(descriptor, args);
  if (activationPolicy.requires_activation && !checkActivation(descriptor, args)) return;
  // Help has precedence over every effect selector. Do not forward other tokens
  // that a child parser could treat as values and thereby swallow --help.
  const forwardedArgs = activationPolicy.category === "help" ? ["--help"] : args;
  const absolutePath = path.join(REPO_ROOT, descriptor.implementation);
  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: script not found: ${absolutePath}`);
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    [absolutePath, ...descriptor.fixed_args, ...forwardedArgs],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) {
    console.error(`ERROR: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function main() {
  const registry = validateCommandRegistryDescriptors();
  if (!registry.ok) {
    console.error(`ERROR: invalid command registry: ${registry.issues.join("; ")}`);
    process.exit(1);
  }

  const argv = Object.freeze([...process.argv.slice(2)]);
  const command = argv[0] ?? "";
  if (!command) {
    printUsage();
    return;
  }

  const direct = getDirectCommandDescriptor(command);
  if (direct) {
    runDescriptor(direct, argv.slice(1));
    return;
  }

  if (GROUPS.has(command)) {
    const subcommand = argv[1] ?? "";
    if (!subcommand) {
      printGroupUsage(command);
      return;
    }
    const descriptor = getGroupCommandDescriptor(command, subcommand);
    if (!descriptor) {
      console.error(`ERROR: Unknown ${command} subcommand: ${subcommand}`);
      process.exit(1);
    }
    runDescriptor(descriptor, argv.slice(2));
    return;
  }

  console.error(`ERROR: unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main();
