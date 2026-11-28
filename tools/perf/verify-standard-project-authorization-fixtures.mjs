import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeInstallation, planInstallation } from "../../src/application/install/installation-service.mjs";
import { resolveRuntimeProjectContext } from "../../src/application/runtime/runtime-project-context-service.mjs";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { readStandardProjectAuthorization } from "../../src/adapters/runtime/standard-project-authorization-store.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "aidn-authorization-fixture-"));
const originalHome = process.env.AIDN_STANDARD_HOST_HOME;
const originalCodex = process.env.CODEX_HOME;
const originalThread = process.env.CODEX_THREAD_ID;
const form = process.platform === "win32";
const thread = "60000000-0000-4000-8000-000000000006";
try {
  const makeDirectory = name => {
    const directory = path.join(base, name);
    fs.mkdirSync(directory);
    return directory;
  };
  const targetRoot = makeDirectory("project");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: targetRoot, windowsHide: true });
  const home = makeDirectory("host");
  const administrator = generateKeyPairSync("ed25519");
  const issuer = generateKeyPairSync("ed25519");
  const unrelated = generateKeyPairSync("ed25519");
  const formKey = generateKeyPairSync("ed25519");
  const pem = key => key.export({ type: "spki", format: "pem" });
  const signed = (body, key) => ({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), key).toString("base64") });
  process.env.AIDN_STANDARD_HOST_HOME = home;
  const codex = makeDirectory("codex");
  const codexConfig = path.join(codex, "config.toml");
  const known = "# Preserve user formatting\r\n[mcp_servers.other]\r\ncommand = \"existing\"\r\n";
  fs.writeFileSync(codexConfig, known);
  process.env.CODEX_HOME = codex;
  process.env.CODEX_THREAD_ID = thread;
  fs.writeFileSync(path.join(home, "project-authorization-admin.pem"), pem(administrator.publicKey));
  const scope = resolveRuntimeProjectContext({ targetRoot });
  const fields = { contract_version: "standard-project-authorization.v1", project_id: scope.project_id,
    runtime_scope_id: scope.runtime_scope_id, revision: 1, previous_sha256: null, principals: [{
      authority_id: "fixture_operator", public_key: pem(issuer.publicKey),
      decisions: [{ question_contract: "standard-mode-question.v1", choices: ["COMMITTING"] }],
    }, ...(form ? [{ authority_id: "fixture_codex", public_key: pem(formKey.publicKey),
      decisions: [{ question_contract: "standard-mode-question.v1", choices: ["COMMITTING"] }],
      codex_form: { thread_id: thread, client: "codex-desktop-windows" } }] : [])] };
  const approved = signed(fields, administrator.privateKey);
  const file = path.join(base, "approved.json");
  fs.writeFileSync(file, JSON.stringify(approved));
  const configuration = path.join(home, "standard.json");
  fs.writeFileSync(configuration, JSON.stringify({ execution: { target_root: targetRoot, native: { protected_roots: [home] } } }));
  const args = { pack: "core", initDefaults: true, projectName: "Authorization fixture", sourceBranch: "main",
    ...(form && { standardCodexConfigurationFile: configuration }),
    skipArtifactImport: true, artifactImportStore: "file", standardAuthorizationFile: file };
  const options = { repoRoot, targetRoot, args };
  const live = () => readStandardProjectAuthorization({ home, targetRoot });
  const cli = (...extra) => execFileSync(process.execPath, [path.join(repoRoot, "bin/aidn.mjs"),
    "install", "--target", targetRoot, "--pack", "core", "--init-defaults", "--source-branch", "main", "--skip-artifact-import",
    "--artifact-import-store", "file", "--standard-authorization", file,
    ...(form ? ["--standard-codex-configuration", configuration] : []), ...extra], { cwd: targetRoot, windowsHide: true, encoding: "utf8" });
  const output = cli("--dry-run");
  assert(output.includes(shadowHash(approved)));
  assert.deepEqual(fs.readdirSync(targetRoot), [".git"]);
  assert.equal(live().current, null);
  assert.equal(fs.readFileSync(codexConfig, "utf8"), known);
  assert(!fs.existsSync(path.join(home, "codex-form-binding.json")));

  fs.writeFileSync(file, JSON.stringify(signed(fields, unrelated.privateKey)));
  const unauthorized = await executeInstallation({ ...options, dryRun: false });
  assert.equal(unauthorized.conflicts[0].code, "STANDARD_AUTHORIZATION_APPROVAL_INVALID");
  fs.writeFileSync(file, JSON.stringify(signed({ ...fields, project_id: "foreign-project" }, administrator.privateKey)));
  assert.equal((await planInstallation(options)).conflicts[0].code, "STANDARD_AUTHORIZATION_SCOPE_CHANGED");
  fs.writeFileSync(file, JSON.stringify(approved));
  assert.deepEqual(fs.readdirSync(targetRoot), [".git"]);
  assert.equal(live().current, null);

  const intent = await planInstallation(options);
  assert(intent.ok, intent.errors.join(", "));
  const effect = intent.external_effects.find(row => row.id === "standard-project-authorization");
  assert.equal(effect.contract_sha256, shadowHash(approved));
  if (form) {
    assert(intent.external_effects.some(row => row.id === "standard-codex-form"));
    fs.appendFileSync(codexConfig, "# editor change\r\n");
    assert.equal((await executeInstallation({ ...options, dryRun: false, expectedPlanId: intent.plan_id })).conflicts[0].code, "STALE_INSTALL_PLAN");
    fs.writeFileSync(codexConfig, known);
  }
  const stopped = await executeInstallation({ ...options, dryRun: false, expectedPlanId: intent.plan_id, failBeforeVersion: true });
  assert(!stopped.ok);
  assert.equal(stopped.conflicts[0].code, "INJECTED_INSTALLATION_BEFORE_VERSION");
  assert.equal(live().current_sha256, shadowHash(approved));
  const resumed = await executeInstallation({ repoRoot, targetRoot, action: "resume", dryRun: false });
  assert(resumed.ok, resumed.errors.join(", "));
  assert.equal(live().current_sha256, shadowHash(approved));
  assert(cli().includes("STANDARD project authorization: revision 1"));
  if (form) {
    const registered = fs.readFileSync(codexConfig, "utf8");
    assert(registered.startsWith(known));
    assert.equal((registered.match(/\[mcp_servers\.aidn_form_/gu) ?? []).length, 1);
    assert(registered.includes("--managed-form"));
    const binding = JSON.parse(fs.readFileSync(path.join(home, "codex-form-binding.json")));
    assert.equal(binding.configuration, configuration);
    assert.equal(binding.authority_id, "fixture_codex");
    const replaced = registered.replace("--managed-form", "owned-by-user");
    fs.writeFileSync(codexConfig, replaced);
    assert.equal((await planInstallation(options)).conflicts[0].code, "CODEX_FORM_REGISTRATION_CONFLICT");
    assert.equal(fs.readFileSync(codexConfig, "utf8"), replaced);
    fs.writeFileSync(codexConfig, registered);
  }

  const authority = createStandardHostAuthority({ configuration: { target_root: targetRoot, instance_id: "fixture",
    control_root: makeDirectory("control"), review_root: makeDirectory("review"),
    native: { home: makeDirectory("native"), tool_roots: [], protected_roots: [home] },
  } }, { useProvider: false });
  const question = { contract_version: "standard-mode-question.v1", operation_id: "fixture" };
  const reference = "fixture-message";
  const author = "fixture_operator";
  const evidence = [{ ref: "codex:thread/10000000-0000-4000-8000-000000000001/turn/20000000-0000-4000-8000-000000000002/message/30000000-0000-4000-8000-000000000003",
    sha256: "b".repeat(64) }];
  const now = Date.now();
  const envelope = ({ choice = "COMMITTING", refs = evidence, key = issuer.privateKey, subject = question } = {}) => signed({
    contract_version: "standard-host-source.v1", kind: "human", authority_id: author, source_ref: reference, subject_sha256: shadowHash(subject),
    issued_at_ms: now, expires_at_ms: now + 60000, payload: { authority_id: author, choice, evidence_refs: refs },
  }, key);
  const check = (source, subject = question) => authority.verifyHumanEnvelope(source, reference, subject);
  assert.deepEqual(check(envelope()), envelope());
  assert.throws(() => check(envelope({ refs: [] })), /STANDARD_AUTHORIZATION_CODEX_EVIDENCE_REQUIRED/);
  assert.throws(() => check(envelope({ choice: "THINKING" })), /STANDARD_AUTHORIZATION_DECISION_REFUSED/);
  assert.throws(() => check(envelope({ key: unrelated.privateKey })), /STANDARD_HOST_SOURCE_NOT_AUTHENTICATED/);
  const merge = { ...question, contract_version: "standard-pr-merge-consent-question.v2", issued_at_ms: now };
  assert.throws(() => check(envelope({ subject: merge }), merge), /STANDARD_AUTHORIZATION_DECISION_REFUSED/);
  const trust = authority.trustSha();

  const revoked = signed({ ...fields, revision: 2, previous_sha256: shadowHash(approved), principals: [] }, administrator.privateKey);
  fs.writeFileSync(file, JSON.stringify(revoked));
  const revocation = { ...options, args: { ...args, standardCodexConfigurationFile: undefined } };
  const replacement = await executeInstallation({ ...revocation, dryRun: false });
  assert(replacement.ok, replacement.errors.join(", "));
  assert.equal(live().current_sha256, shadowHash(revoked));
  assert.notEqual(authority.trustSha(), trust);
  assert.throws(() => check(envelope()), /STANDARD_HOST_SOURCE_NOT_AUTHENTICATED/);
  fs.writeFileSync(file, JSON.stringify(approved));
  assert.equal((await planInstallation(options)).conflicts[0].code, "STANDARD_AUTHORIZATION_STALE");
  assert.equal(live().current.revision, 2);

  console.log(JSON.stringify({ status: "PASS", install: "public preview, execution, interrupted completion, resume and idempotent reinstall",
    refusals: ["untrusted administrator", "foreign scope", "different choice", "different question", "wrong issuer", "missing message", "revoked issuer", "rollback"],
    codex_registration: form ? "PASS" : "SKIP", production_user: "SKIP" }));
} finally {
  if (originalHome === undefined) delete process.env.AIDN_STANDARD_HOST_HOME;
  else process.env.AIDN_STANDARD_HOST_HOME = originalHome;
  if (originalCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalCodex;
  if (originalThread === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = originalThread;
  removePathWithRetry(base);
}
