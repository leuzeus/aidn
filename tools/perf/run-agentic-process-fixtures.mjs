#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import manifest from "../../package/catalogs/agentic-process-fixtures.v1.json" with { type: "json" };
import { runNodeFixtureCases } from "../verify/node-fixture-runner-lib.mjs";

if (process.argv.length !== 2) throw Error("AGENTIC_FIXTURE_RUNNER_ARGUMENT_INVALID");
if (manifest.contract_version !== "agentic-process-fixtures.v1" || Object.keys(manifest).sort().join(",") !== "cases,contract_version")
  throw Error("AGENTIC_FIXTURE_MANIFEST_INVALID");
const result = await runNodeFixtureCases(manifest.cases, { cwd: fileURLToPath(new URL("../../", import.meta.url)) });
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.exit_code;
