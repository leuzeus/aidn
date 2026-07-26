#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const porcelain = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}).trim();
const entries = porcelain ? porcelain.split(/\r?\n/) : [];
const output = {
  ok: entries.length === 0,
  status: entries.length === 0 ? "PASS" : "FAIL",
  entries,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
