import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { agentRunPhysicalPath, readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertGithubRequiredChecksPolicy, observeGithubRequiredChecks } from "../git-provider/github-required-checks.mjs";
import { createGithubSessionPush } from "../git-provider/github-session-push.mjs";
import { createGithubPrMerge } from "../git-provider/github-pr-merge.mjs";
import { createGithubPrReviewResolution } from "../git-provider/github-pr-review-resolution.mjs";
import { createGithubPrReviewReply } from "../git-provider/github-pr-review-reply.mjs";
import { createGithubPullRequestOpen } from "../git-provider/github-pull-request-open.mjs";
import { createGithubWorkflowAsyncAdapter, createGithubPrContentAsyncAdapter, createGithubPrMergeAsyncAdapter, createGithubPrMergeEffectAsyncAdapter, createGithubPrReviewEventAsyncAdapter, createGithubPrReviewEffectsAsyncAdapter } from "../git-provider/github-workflow-adapter.mjs";
import { createGithubReviewEvidenceAsyncAdapter, createGithubReviewContentAsyncAdapter } from "../git-provider/github-review-evidence.mjs";
import { driveGithubObservation, driveGithubObservationAsync, runGithubObservationCommand } from "../git-provider/github-observation-transport.mjs";
import { createLocalWorkflowPostMergeFetch } from "./local-workflow-post-merge-fetch.mjs";

const fail = code => { throw Object.assign(Error(code), { code, effect_status: "no_effect" }); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === fields;
const hash = /^[a-f0-9]{64}$/;
const nodeId = /^[A-Za-z0-9_=-]{1,256}$/;
const matches = (value, pattern) => typeof value === "string" && pattern.test(value);
const key = value => process.platform === "win32" ? value.toLowerCase() : value;
const file = (name, options) => readAgentRunFile(name, { json: false, maxBytes: 262144, ...options });
function optionalFile(name, options) {
  try { fs.lstatSync(name); } catch (cause) { if (cause.code === "ENOENT") return null; throw cause; }
  return file(name, options);
}

// The caller is the private STANDARD host. The only dependency seam replaces
// subprocess transports; the action, IR and project configuration select none.
export function createStandardGithubProviderHost({ configuration, home, identity, environment }, {
  runGithub = spawnSync, runGithubRead = runGithubObservationCommand, runGithubReply = runGithubObservationCommand,
  runGithubResolution = runGithubObservationCommand, runGithubMerge = runGithubObservationCommand, runRemoteGit = spawnSync,
} = {}) {
  const manifest = path.join(home, identity + ".github.json");
  let snapshot, binding;
  try {
    snapshot = optionalFile(manifest, { json: true });
    if (!snapshot) return null;
    binding = snapshot.value;
  } catch { fail("STANDARD_GITHUB_HOST_CONFIGURATION_INVALID"); }
  const { repository, actor, git, gh, reviewer, merge_method: mergeMethod, required_checks: requiredChecks } = binding ?? {};
  const principal = (value, login = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/) => matches(value.login, login) && matches(value.node_id, nodeId);
  const executable = value => exact(value, "path,sha256") && typeof value.path === "string"
    && path.isAbsolute(value.path) && matches(value.sha256, hash);
  if (!exact(binding, "actor,contract_version,gh,git,instance_id," + (mergeMethod === undefined ? "" : "merge_method,") + "repository," + (requiredChecks === undefined ? "" : "required_checks,") + (reviewer === undefined ? "" : "reviewer,") + "target_root")
    || mergeMethod !== undefined && (mergeMethod !== "MERGE" || requiredChecks === undefined)
    || binding.contract_version !== "standard-host-github.v1"
    || binding.target_root !== configuration.target_root || binding.instance_id !== configuration.instance_id
    || !exact(repository, "host,name,node_id,owner") || repository.host !== "github.com"
    || !matches(repository.owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/)
    || !matches(repository.name, /^[A-Za-z0-9_.-]{1,100}$/) || [".", ".."].includes(repository.name)
    || !matches(repository.node_id, nodeId) || !exact(actor, "login,node_id") || !principal(actor)
    || reviewer !== undefined && (!exact(reviewer, "login,node_id,type") || !["User", "Bot"].includes(reviewer.type)
      || !principal(reviewer, reviewer.type === "Bot" ? /^[A-Za-z0-9][A-Za-z0-9-]{0,99}(?:\[bot\])?$/ : undefined))
    || !executable(git) || !executable(gh) || key(git.path) === key(gh.path))
    fail("STANDARD_GITHUB_HOST_CONFIGURATION_INVALID");

  if (requiredChecks !== undefined) assertGithubRequiredChecksPolicy(requiredChecks);

  const root = configuration.target_root, configDir = path.join(home, identity + ".github");
  const { host, ...repo } = repository, fullName = repo.owner + "/" + repo.name;
  const url = "https://" + host + "/" + fullName;
  // Ambient Git config, proxy, token, host and PATH cannot redirect transport.
  const system = Object.fromEntries(Object.entries(environment).filter(([name]) => /^(systemroot|windir)$/i.test(name)));
  const env = Object.freeze({ ...system, HOME: home, USERPROFILE: home, TMP: home, TEMP: home,
    GH_CONFIG_DIR: configDir, GH_HOST: host, GH_PROMPT_DISABLED: "1", GH_DEBUG: "", GH_FORCE_TTY: "", GH_PAGER: "",
    GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1" });
  const gitEnv = { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
  function localGit(args, statuses = [0]) {
    const result = spawnSync(git.path, ["-C", root, ...args], { env: gitEnv, encoding: "utf8", shell: false,
      windowsHide: true, timeout: 10000, maxBuffer: 262144, stdio: "pipe" });
    if (result.error || result.signal || !statuses.includes(result.status)) fail("STANDARD_GITHUB_REPOSITORY_BINDING_INVALID");
    return result;
  }
  const gitRead = args => localGit(args).stdout;
  function repositoryBinding() {
    const [top, gitDir, commonDir, ...extra] = gitRead(["rev-parse", "--path-format=absolute",
      "--show-toplevel", "--absolute-git-dir", "--git-common-dir"]).trimEnd().split(/\r?\n/);
    if (!top || !gitDir || !commonDir || extra.length || key(path.resolve(top)) !== key(root))
      fail("STANDARD_GITHUB_REPOSITORY_BINDING_INVALID");
    const remote = gitRead(["config", "--includes", "--null", "--get-regexp", "^(remote\\.origin\\.(url|pushurl)|url\\..*\\.(insteadof|pushinsteadof))$"]);
    if (![url, url + ".git"].some(value => remote === "remote.origin.url\n" + value + "\0"))
      fail("STANDARD_GITHUB_REPOSITORY_BINDING_INVALID");
    return { gitDir: agentRunPhysicalPath(gitDir, { directory: true }),
      commonDir: agentRunPhysicalPath(commonDir, { directory: true }), remote };
  }
  function checkBinary(ref) {
    try {
      const actual = agentRunPhysicalPath(ref.path), stat = fs.statSync(actual);
      if (key(actual) === key(ref.path) && stat.isFile() && stat.size <= 134217728
        && createHash("sha256").update(fs.readFileSync(actual)).digest("hex") === ref.sha256) return;
    } catch {}
    fail("STANDARD_GITHUB_EXECUTABLE_PIN_CHANGED");
  }
  function profilePin() {
    try {
      agentRunPhysicalPath(configDir, { directory: true });
      return optionalFile(path.join(configDir, "config.yml"))?.sha256 ?? null;
    } catch { fail("STANDARD_GITHUB_HOST_PROFILE_INVALID"); }
  }
  checkBinary(git); checkBinary(gh);
  const profile = profilePin(), local = shadowHash(repositoryBinding());
  const contextSha = shadowHash({ profile: "standard-host-github.v1", manifest: snapshot.sha256, env, profile_sha256: profile, local });
  function revalidate({ repository = true, executables = true } = {}) {
    try { file(manifest, { sha256: snapshot.sha256 }); } catch { fail("STANDARD_GITHUB_HOST_CONFIGURATION_CHANGED"); }
    if (profilePin() !== profile) fail("STANDARD_GITHUB_HOST_PROFILE_CHANGED");
    if (executables) { checkBinary(git); checkBinary(gh); }
    if (repository) checkRepository();
  }
  function checkRepository() {
    if (shadowHash(repositoryBinding()) !== local) fail("STANDARD_GITHUB_REPOSITORY_BINDING_CHANGED");
  }
  function transportGuard(options) {
    const credentials = optionalFile(path.join(configDir, "hosts.yml"))?.sha256 ?? null;
    return () => {
      revalidate(options);
      if ((optionalFile(path.join(configDir, "hosts.yml"))?.sha256 ?? null) !== credentials)
        fail("STANDARD_GITHUB_HOST_CREDENTIAL_CHANGED");
    };
  }
  const options = { cwd: home, env, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 262144, stdio: "pipe" };
  function* authenticate(guard) {
    guard();
    function* command(args, commandEnv) {
      let result;
      try { result = yield [gh.path, args, { ...options, env: commandEnv }]; }
      catch { fail("STANDARD_GITHUB_AUTHENTICATION_UNAVAILABLE"); }
      // The next fixed request is yielded in this same synchronous continuation.
      guard();
      if (result?.status !== 0 || result.signal || result.error || typeof result.stdout !== "string"
        || Buffer.byteLength(result.stdout) > options.maxBuffer) fail("STANDARD_GITHUB_AUTHENTICATION_UNAVAILABLE");
      return result.stdout;
    }
    const token = (yield* command(["auth", "token", "--hostname", host], env)).trim();
    if (!/^[\x21-\x7e]{10,4096}$/.test(token)) fail("STANDARD_GITHUB_AUTHENTICATION_UNAVAILABLE");
    const authenticated = { ...env, GH_TOKEN: token };
    function* get(endpoint) {
      const value = yield* command(["api", "--hostname", host, "--method", "GET", endpoint], authenticated);
      try { return JSON.parse(value); } catch { fail("STANDARD_GITHUB_AUTHENTICATION_UNAVAILABLE"); }
    }
    const user = yield* get("user");
    if (user?.node_id !== actor.node_id || user.login !== actor.login) fail("STANDARD_GITHUB_IDENTITY_CHANGED");
    const project = yield* get("repos/" + fullName);
    if (project?.node_id !== repo.node_id || project.full_name !== fullName) fail("STANDARD_GITHUB_IDENTITY_CHANGED");
    return authenticated;
  }
  const github = { executable: gh.path, executableSha256: gh.sha256, workingDirectory: home, repository: repo, environment: env };
  function guardedRun(guard, run) {
    return (binary, args, input) => {
      const started = performance.now();
      const env = guard() ?? input.env;
      const timeout = Math.floor(input.timeout - (performance.now() - started));
      if (timeout < 1) fail("STANDARD_GITHUB_TRANSPORT_DEADLINE");
      if (input.signal?.aborted) fail("GITHUB_OBSERVATION_ABORTED");
      return run(binary, args, { ...input, env, timeout });
    };
  }
  const authorized = (guard, input) => ({
    ...input,
    assertAuthorized: typeof input?.assertAuthorized === "function" ? async () => { await input.assertAuthorized(); guard(); } : input?.assertAuthorized,
  });
  function pushPort(guard) {
    return createGithubSessionPush({ targetRoot: root, gitExecutable: git.path, gitSha256: git.sha256,
      githubExecutable: gh.path, githubSha256: gh.sha256, repository: repo, actor, environment: env, hostContextSha256: contextSha },
    { runGithub: guardedRun(guard, runGithub), runRemoteGit: guardedRun(guard, runRemoteGit) });
  }
  async function postMergeGit(args, signal, assertAuthorized) {
    function check() {
      guard();
      if (signal?.aborted) fail("STANDARD_GITHUB_POST_MERGE_FETCH_ABORTED");
      const unsafe = localGit(["config", "--includes", "--null", "--get-regexp",
        "^(url[.]|http[.]|credential[.]|fetch[.]bundleuri$|remote[.].*[.](uploadpack|proxy|promisor)$|extensions[.]partialclone$)"], [0, 1]);
      if (unsafe.status !== 1 || unsafe.stdout) fail("STANDARD_GITHUB_POST_MERGE_CONFIG_UNSUPPORTED");
    }
    const guard = transportGuard();
    check();
    const { GH_TOKEN: token } = await driveGithubObservationAsync(authenticate(guard), runGithubRead, signal);
    if (assertAuthorized) await assertAuthorized();
    check();
    const result = await runRemoteGit(git.path, ["-C", root,
      "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "http.sslVerify=true",
      "-c", "http.followRedirects=false", "-c", "http.proxy=", "-c", "credential.helper=", "-c", "core.askPass=",
      "-c", "fetch.writeCommitGraph=false", "--config-env=http.extraHeader=AIDN_GITHUB_AUTH_HEADER", ...args],
    { ...options, cwd: root, signal, env: { ...gitEnv, PATH: path.dirname(git.path), GIT_NO_REPLACE_OBJECTS: "1",
      AIDN_GITHUB_AUTH_HEADER: "AUTHORIZATION: basic " + Buffer.from("x-access-token:" + token).toString("base64") } });
    check();
    if (result?.status !== 0 || result.signal || result.error || typeof result.stdout !== "string"
      || Buffer.byteLength(result.stdout) > options.maxBuffer) fail("STANDARD_GITHUB_POST_MERGE_FETCH_UNAVAILABLE");
    return result.stdout.trimEnd();
  }
  const postMergeRemote = Object.freeze({
    context_sha256: contextSha,
    async observeTip(ref, { signal }) {
      const output = await postMergeGit(["ls-remote", "--refs", "--", url + ".git", ref], signal);
      if (!output) return null;
      const rows = output.split(/\r?\n/), [oid, name] = rows[0].split("\t");
      if (rows.length !== 1 || name !== ref) fail("STANDARD_GITHUB_POST_MERGE_REF_INVALID");
      return oid;
    },
    async transfer(oid, { signal, assertAuthorized }) {
      await postMergeGit(["fetch", "--no-write-fetch-head", "--no-tags", "--no-prune", "--no-recurse-submodules",
        "--no-auto-maintenance", "--refmap=", "--", url + ".git", oid], signal, assertAuthorized);
    },
  });
  const postMergeFetch = () => createLocalWorkflowPostMergeFetch({
    targetRoot: root, remote: postMergeRemote, environment: env, gitExecutable: git.path,
  });
  function openPort(guard) {
    let authenticated;
    const run = guardedRun(() => {
      authenticated ??= driveGithubObservation(authenticate(guard), runGithub);
      guard();
      return authenticated;
    }, runGithub);
    return createGithubPullRequestOpen({ ...github, hostContextSha256: contextSha }, { run });
  }
  function readPort(factory, method) {
    return async (request, readOptions = {}) => {
      const { signal } = readOptions;
      const guard = transportGuard();
      const authenticated = await driveGithubObservationAsync(authenticate(guard), runGithubRead, signal);
      const result = await factory({ ...github, reviewer, environment: authenticated },
        { run: guardedRun(guard, runGithubRead) })[method](request, readOptions);
      guard();
      return result;
    };
  }
  async function observeRequiredChecks(request, { signal } = {}) {
    const guard = transportGuard();
    const authenticated = await driveGithubObservationAsync(authenticate(guard), runGithubRead, signal);
    const run = guardedRun(guard, runGithubRead);
    const get = async endpoint => {
      const result = await run(gh.path, ["api", "--hostname", host, "--method", "GET", endpoint],
        { ...options, env: authenticated, signal });
      guard();
      if (signal?.aborted || result?.status !== 0 || result.signal || result.error || typeof result.stdout !== "string"
        || Buffer.byteLength(result.stdout) > options.maxBuffer) fail("STANDARD_PR_CHECK_INVENTORY_UNAVAILABLE");
      try { return JSON.parse(result.stdout); } catch { fail("STANDARD_PR_CHECK_INVENTORY_INVALID"); }
    };
    const checks = await observeGithubRequiredChecks({ get, repository: repo, policy: requiredChecks, request });
    return { policy_sha256: shadowHash({ manifest_sha256: snapshot.sha256, policy: requiredChecks }),
      actor_id: actor.node_id, checks };
  }
  const content = readPort(createGithubPrContentAsyncAdapter, "observePullRequest");
  const evidence = readPort(createGithubReviewContentAsyncAdapter, "observeReviewEvidence");
  const reviewEffects = readPort(createGithubPrReviewEffectsAsyncAdapter, "observePrReviewEffects");
  const protectedReviewMutation = (run, kind) => async (payload, { signal, assertAuthorized, assertSendFresh }) => {
    let guard, request;
    try {
      guard = transportGuard();
      const authenticated = await driveGithubObservationAsync(authenticate(guard), runGithubRead, signal);
      await assertAuthorized();
      guard();
      if (signal?.aborted) fail(kind + "_ABORTED");
      request = { ...options, env: authenticated, input: JSON.stringify(payload), signal };
      // The final synchronous check runs immediately before transport invocation.
      assertSendFresh?.(request.timeout);
    } catch (cause) {
      fail(/^[A-Z][A-Z0-9_]{0,127}$/.test(cause?.code ?? "") ? cause.code : kind + "_PRECONDITION_REQUIRED");
    }
    try {
      const result = await run(gh.path, ["api", "graphql", "--hostname", host, "--input", "-"], request);
      guard();
      if (result?.status !== 0 || result.signal || result.error || typeof result.stdout !== "string"
        || Buffer.byteLength(result.stdout) > options.maxBuffer) fail(kind + "_TRANSPORT_UNAVAILABLE");
      return JSON.parse(result.stdout);
    } catch {
      const code = kind + "_RECONCILIATION_REQUIRED";
      throw Object.assign(Error(code), { code, effect_status: "unknown" });
    }
  };
  const reviewHost = { repository: repo, actor, hostContextSha256: contextSha, observe: reviewEffects };
  const replyPort = createGithubPrReviewReply({ ...reviewHost, runMutation: protectedReviewMutation(runGithubReply, "GITHUB_PR_REPLY") });
  const resolutionPort = createGithubPrReviewResolution({ ...reviewHost, runMutation: protectedReviewMutation(runGithubResolution, "GITHUB_PR_RESOLUTION") });
  const mergePort = mergeMethod === undefined ? null : createGithubPrMerge({ ...reviewHost, method: mergeMethod,
    observe: readPort(createGithubPrMergeEffectAsyncAdapter, "observePrMerge"),
    runMutation: protectedReviewMutation(runGithubMerge, "GITHUB_PR_MERGE") });
  const readReviewEvent = readPort(createGithubPrReviewEventAsyncAdapter, "readEvent");
  function reviewEvents(read) {
    async function readEvent({ request, sourceRef, subject, signal }) {
      if (!matches(sourceRef, nodeId) || !subject) fail("GITHUB_REVIEW_EVENT_REQUEST_INVALID");
      return read({ request, sourceRef, subject }, { signal });
    }
    return {
      readEvent,
      async verifyEvent({ event, ...input }) {
        const current = await readEvent(input);
        if (!current || shadowHash(current) !== shadowHash(event)) fail("GITHUB_REVIEW_EVENT_CHANGED");
        return { outcome: "verified", current: true, authority_id: current.authority_id,
          event_sha256: shadowHash(current), subject_sha256: shadowHash(current.actor) };
      },
    };
  }
  // One bounded read-only review transaction uses one authenticated token.
  // The fixed GitHub queries do not use the checkout. Fence its exact origin
  // on both sides of the transaction while guarding credentials, profile and
  // executable pins at each subprocess boundary inside it.
  async function withReviewReads(collect, { signal } = {}) {
    const guard = transportGuard({ repository: false, executables: false });
    const guardAuth = () => { guard(); checkBinary(gh); };
    guard();
    checkBinary(git);
    checkRepository();
    const authenticated = await driveGithubObservationAsync(authenticate(guardAuth), runGithubRead, signal);
    const config = { ...github, reviewer, environment: authenticated };
    const transport = { run: guardedRun(guard, runGithubRead) };
    const events = createGithubPrReviewEventAsyncAdapter(config, transport);
    const content = createGithubPrContentAsyncAdapter(config, transport);
    const evidence = createGithubReviewContentAsyncAdapter(config, transport);
    const result = await collect({ ...reviewEvents(events.readEvent), reviewPort: {
      observePrContent: content.observePullRequest, observeReviewContent: evidence.observeReviewEvidence,
    } });
    guard();
    checkBinary(git);
    checkRepository();
    if (signal?.aborted) fail("GITHUB_OBSERVATION_ABORTED");
    return result;
  }
  return Object.freeze({ contextSha,
    async verifyIdentity(signal) { await driveGithubObservationAsync(authenticate(transportGuard()), runGithubRead, signal); },
    sessionPushPort: Object.freeze({
      inspect(branch) { const guard = transportGuard(); return pushPort(guard).inspect(branch); },
      observeOwned(branch, input) { const guard = transportGuard(); return pushPort(guard).observeOwned(branch, input); },
      observeRemote(branch, input) { const guard = transportGuard(); return pushPort(guard).observeRemote(branch, input); },
      push(observed, input) { const guard = transportGuard(); return pushPort(guard).push(observed, authorized(guard, input)); },
    }),
    sessionPullRequestPort: Object.freeze({
      prepare(request, id) { const guard = transportGuard(); return openPort(guard).prepare(request, id); },
      apply(plan, input) { const guard = transportGuard(); return openPort(guard).apply(plan, authorized(guard, input)); },
    }),
    sessionReviewPort: Object.freeze({
      observePullRequest: readPort(createGithubWorkflowAsyncAdapter, "observePullRequest"),
      observeReviewEvidence: readPort(createGithubReviewEvidenceAsyncAdapter, "observeReviewEvidence"),
      observePrContent: content, observeReviewContent: evidence,
      observePrMerge: readPort(createGithubPrMergeAsyncAdapter, "observePrMerge"),
      reviewEffectActor: Object.freeze({ ...actor }),
      observePrReviewEffects: reviewEffects,
      ...(requiredChecks ? { observeRequiredChecks } : {}),
      reply: replyPort, resolution: resolutionPort,
      ...(mergePort ? { merge: mergePort } : {}),
      postMergeFetch: Object.freeze({
        async prepareFastForward(fetchPrepared, input) {
          const guard = transportGuard();
          guard();
          const plan = await postMergeFetch().prepareFastForward(fetchPrepared, input);
          guard();
          return plan;
        },
        applyFastForward(plan, fetchPrepared, input) {
          const guard = transportGuard();
          guard();
          return postMergeFetch().applyFastForward(plan, fetchPrepared, authorized(guard, input));
        },
        recoverFastForward(plan, fetchPrepared, input) {
          const guard = transportGuard();
          guard();
          const result = postMergeFetch().recoverFastForward(plan, fetchPrepared, input);
          guard();
          return result;
        },
        prepare({ providerRepository, ...subject }, options) {
          revalidate();
          if (!providerRepository || shadowHash(providerRepository) !== shadowHash(repo)) fail("STANDARD_GITHUB_POST_MERGE_REPOSITORY_CHANGED");
          return postMergeFetch().prepare(subject, options);
        },
        apply(prepared, input) {
          const guard = transportGuard();
          guard();
          return postMergeFetch().apply(prepared, authorized(guard, input));
        },
        recover(prepared, input) {
          const guard = transportGuard();
          guard();
          const result = postMergeFetch().recover(prepared, input);
          guard();
          return result;
        },
        verifyCompletedSource(prepared, input) {
          revalidate();
          postMergeFetch().verifyCompletedSource(prepared, input);
          revalidate();
        },
        readMergedSession(prepared, input) {
          const guard = transportGuard();
          guard();
          const content = postMergeFetch().readMergedSession(prepared, input);
          guard();
          return content;
        },
        async observeAlignment(prepared, input) {
          const guard = transportGuard();
          guard();
          const result = await postMergeFetch().observeAlignment(prepared, input);
          guard();
          return result;
        },
      }),
    }),
    ...(reviewer ? { sessionReviewEventPort: Object.freeze({ ...reviewEvents(readReviewEvent), withReviewReads }) } : {}),
  });
}
