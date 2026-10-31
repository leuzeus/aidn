#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { runOwnedAgenticProcess } from "../../src/application/runtime/agentic-process-owned-run.mjs";

// Internal opt-in runner, not a new public aidn CLI command or installed hook.
try {
  const args = process.argv.slice(2), execute = args.includes("--execute");
  const allowed = new Set(["--execute", "--preview", "--configuration", "--configuration-sha256", "--authorization", "--authorization-sha256"]);
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) throw Error("PROCESS_RUNNER_ARGUMENT_INVALID");
    if (!["--execute", "--preview"].includes(flag) && (!args[index + 1] || args[index + 1].startsWith("--"))) throw Error("PROCESS_RUNNER_ARGUMENT_INVALID");
    values[flag] = ["--execute", "--preview"].includes(flag) ? true : args[++index];
  }
  if (execute === !!values["--preview"] || !values["--configuration"]
    || execute && !values["--authorization"] || !execute && (values["--authorization"] || values["--authorization-sha256"])) throw Error("PROCESS_RUNNER_ARGUMENT_INVALID");
  const read = name => {
    const file = values[`--${name}`], expected = values[`--${name}-sha256`], stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 262144 || !/^[a-f0-9]{64}$/.test(expected ?? "")) throw Error("PROCESS_RUNNER_INPUT_INVALID");
    const data = fs.readFileSync(file);
    if (createHash("sha256").update(data).digest("hex") !== expected) throw Error("PROCESS_RUNNER_PIN_CHANGED");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  };
  const result = await runOwnedAgenticProcess({ configuration: read("configuration"), authorization: execute ? read("authorization") : null, execute });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status === "FAILED") process.exitCode = 1;
} catch (error) {
  process.stderr.write((/^PROCESS_[A-Z_]+$/.test(error?.code ?? error?.message ?? "") ? error.code ?? error.message : "PROCESS_RUNNER_FAILED") + "\n");
  process.exitCode = 1;
}
