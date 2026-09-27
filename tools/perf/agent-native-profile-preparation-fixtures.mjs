import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { prepareAgentNativeQualification, nativeQualificationHomeIdentity } from "../verify/prepare-agent-native-qualification.mjs";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";

// Filesystem fixtures are deliberately separate from the pure import guard.
// The native executable below is inert bytes and must never be invoked.
export async function runAgentNativeProfilePreparationFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-profile-preparation-"));
  const home = path.join(root, "profil existant été"), binary = path.join(root, "inert-codex.exe");
  const npmCli = path.join(root, "inert-npm-cli.js"), outputRoot = path.join(root, "candidate");
  fs.mkdirSync(home);
  fs.writeFileSync(binary, "not an executable"); fs.writeFileSync(npmCli, "throw new Error('must not run')");
  fs.writeFileSync(path.join(home, "config.toml"), 'model="synthetic-private-model"\n');
  fs.writeFileSync(path.join(home, "auth.json"), '{"synthetic":"never disclose"}\n');
  const snapshot = () => fingerprintAgentExecutionValue(fs.readdirSync(home).sort().map(file =>
    [file, fs.readFileSync(path.join(home, file), "utf8")]));
  const before = snapshot(), calls = [], original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    calls.push(command);
    assert.equal(command, "git", "preview may inspect source Git identity only");
    // Source metadata is a closed double, independent of the fixture runner's
    // checkout ownership. No global Git exception or actual child is needed.
    assert.equal(options.shell, false);
    const known = [
      ["rev-parse", "HEAD"], ["status", "--porcelain=v1", "--untracked-files=all"],
      ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"],
      ["ls-files", "--others", "--exclude-standard", "-z"],
    ];
    const operation = known.find(tail => JSON.stringify(args.slice(-tail.length)) === JSON.stringify(tail));
    assert.ok(operation, "only the four closed source metadata queries are permitted");
    return { status: 0, signal: null, stdout: operation[0] === "rev-parse" ? "1".repeat(40) + "\n" : "", stderr: "" };
  };
  syncBuiltinESMExports();
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks++; process.stdout.write("PASS " + name + "\n"); };
  const options = { outputRoot, codexBinary: binary, npmCli, nativeProfileMode: "preexisting", codexHome: home };
  try {
    await check("preexisting preparation preview neither writes nor launches the native profile", async () => {
      const preview = await prepareAgentNativeQualification(options);
      assert.equal(preview.status, "preview"); assert.equal(preview.written, false);
      assert.equal(preview.planned_paths.codexHome, fs.realpathSync.native(home));
      assert.equal(preview.native_profile.mode, "preexisting");
      assert.equal(preview.native_profile.home_identity_sha256, fingerprintAgentExecutionValue(nativeQualificationHomeIdentity(home)));
      assert.equal(preview.native_execution, "NOT_RUN"); assert.equal(preview.llm_calls, 0);
      assert.equal(snapshot(), before); assert.equal(fs.existsSync(outputRoot), false);
      assert.doesNotMatch(JSON.stringify(preview), /synthetic-private-model|never disclose/);
    });
    for (const [name, delta, code] of [
      ["missing explicit home", { codexHome: undefined }, "PREPARATION_NATIVE_PROFILE_SELECTION_REQUIRED"],
      ["implicit mode", { nativeProfileMode: undefined }, "PREPARATION_NATIVE_PROFILE_SELECTION_REQUIRED"],
      ["unsupported mode", { nativeProfileMode: "automatic" }, "PREPARATION_NATIVE_PROFILE_MODE_INVALID"],
      ["string write intent", { write: "true" }, "PREPARATION_EXPLICIT_WRITE_BOOLEAN_REQUIRED"],
      ["relative home", { codexHome: "relative" }, "PREPARATION_ABSOLUTE_PATH_REQUIRED"],
      ["file home", { codexHome: binary }, "PREPARATION_NATIVE_HOME_REQUIRED"],
      ["output in profile", { outputRoot: path.join(home, "output") }, "PREPARATION_NATIVE_PROFILE_OVERLAP"],
    ]) await check("preparation rejects " + name, () => assert.rejects(() => prepareAgentNativeQualification({ ...options, ...delta }), { code }));
    await check("legacy isolated preparation keeps an owned empty-home plan", async () => {
      const preview = await prepareAgentNativeQualification({ outputRoot, codexBinary: binary, npmCli });
      assert.deepEqual(preview.native_profile, { mode: "isolated" });
      assert.equal(preview.planned_paths.codexHome, path.join(outputRoot, "codex-home"));
      assert.equal(fs.existsSync(outputRoot), false);
    });
    await check("all preparation refusals preserve selected profile and create no candidate", () => {
      assert.equal(snapshot(), before); assert.equal(fs.existsSync(outputRoot), false);
      assert.ok(calls.every(command => command === "git"));
    });
    return checks;
  } finally {
    childProcess.spawnSync = original; syncBuiltinESMExports();
    const resolved = path.resolve(root), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith("aidn-profile-preparation-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
