# Codex capabilities and bounded spike - 2026-09-23

Status: exploration evidence and proposed design input; not delivery acceptance.
Scope: Windows local binaries, source review, real app-server discovery without a model call. No product code, live client project, global Codex configuration, trust state, remote publication, or existing chat was modified.

## Evidence classes and version anchors

- **E**: executed against the identified installed binary.
- **S**: inspected source at an immutable upstream commit; not a runtime result.
- **D**: official documentation fetched on 2026-09-23; not a version guarantee.
- **SKIP**: not executed, with the remaining protocol below.

| Surface | Observed identity | Evidence and limit |
| --- | --- | --- |
| CLI on PATH / active desktop backend process | `codex-cli 0.155.0-alpha.9.2`; SHA256 `BC45017E8239DC150258F69309CED9DF6BBCDF5B8E4F346DECF780AC0999E226`; 316853040 bytes | E: command resolution, `--version`, binary hash, running process executable path. Backend resides under the per-user OpenAI/Codex installation. |
| Windows application | Running `ChatGPT.exe` in package `OpenAI.Codex_26.915.4065.0_x64`; executable SHA256 `0D27AEF4010466BD8D2A95F6483938CFDB8926F6668ECC1182FACEC9B85B75D2` | E: process path proves an application is present and running independently of CLI PATH. GUI hook trust, restart, chat lifecycle and native controls were not driven. Executable file/product version is Chromium `153.0.8010.48`, not the Codex package version. |
| VS Code extension files | `openai.chatgpt` directories `26.721.41059` and `26.727.40816`; newer directory package.json version `26.727.40816` | E: installed files, not evidence of which extension VS Code currently activated. |
| Newer installed extension's bundled binary | `codex-cli 0.146.0-alpha.9.2`; SHA256 `ECD7A3EAFF5E42723DBBA03B5C91514B3986B5DB5CBCA8F34619620B5356F31F` | E: `--version`, hash and isolated app-server requests to this exact executable. No IDE GUI session tested. |
| Cloud | No cloud session or environment inspected | SKIP; local Windows results do not transfer to cloud. |
| Unix / WSL | No corresponding client executed | SKIP. |

Upstream anchors resolved through GitHub's read-only API:

- Tag `rust-v0.155.0-alpha.9.2` -> annotated tag `f507a90df8684231353b1e6effe4dd894fc60415` -> commit [`4607249e430dac1c961df4dc615beae88e33cec8`](https://github.com/openai/codex/commit/4607249e430dac1c961df4dc615beae88e33cec8).
- Tag `rust-v0.146.0-alpha.9.2` -> annotated tag `dce602519601a788211092549cfeb34933a4110b` -> commit [`86cc9f2177cad015befd595286d8767a650f7d13`](https://github.com/openai/codex/commit/86cc9f2177cad015befd595286d8767a650f7d13).
- Separately observed upstream `main`: [`39598ed17885970828acd42a6370131ed0190a98`](https://github.com/openai/codex/commit/39598ed17885970828acd42a6370131ed0190a98), commit time `2026-09-23T00:56:42Z`.

The source review uses the tag matching each binary's reported version, not main. No reproducible-build comparison or release checksum attestation was performed; matching version strings do not by themselves prove byte-for-byte correspondence with the tag.

## Real spike and scope of trust

Question: can existing AIDN skills be discovered through the installed Codex clients, and can hooks be diagnosed without a model call or automatic trust?

Corpus: a temporary copy of `tests/fixtures/repo-installed-core`, initialized as a Git repository, in a path containing spaces. This is fixture-based integration, not an external pilot or proof of the installer. AIDN's existing `tools/verify/codex-discovery-lib.mjs` performed `initialize`, `initialized`, then `skills/list` with `forceReload: true` and the fixture cwd. Each binary received a distinct, new temporary `CODEX_HOME` containing only `[analytics] enabled = false`.

| Check | Desktop backend / CLI 0.155 | IDE-bundled backend 0.146 | Interpretation |
| --- | --- | --- | --- |
| Generate installed experimental app-server JSON schema | PASS | PASS | Exact schema from each executable, not current web schema. |
| `initialize` and `skills/list` | PASS: 13 repo skills, zero errors; 362 ms | PASS: same 13, zero errors; 274 ms | One sample each, process lifecycle included; not model startup, resume or admission latency. |
| `hooks/list`, only project `.codex/hooks.json`, project untrusted | PASS: empty hooks | PASS: empty hooks | Both explicitly log that project config, hooks and exec policies are disabled until trust, while skills still load. This is successful trust exclusion, not operational project hooks. |
| `hooks/list`, additional temporary-home `hooks.json` with one command and one MCP handler | PASS: both listed, enabled, `trustStatus: untrusted` | Expected incompatibility: warning `unknown variant mcp_tool`, hooks empty | The older parser rejects the whole mixed hook file, including the otherwise valid command hook. RPC transport success is not hook capability success. |
| Hook command or MCP execution | SKIP | SKIP | No `thread/start`, `thread/resume`, `turn/start`, model request, or hook execution was issued. Listing untrusted metadata is not an execution proof. |

The user-scope hook source above is a disposable home created for the probe. It is not the user's real home. No project was marked trusted, no hook trust hash was approved, no trust override or sandbox bypass was used, and no global configuration was changed. Temporary user hooks were only parsed and listed. The copied scaffold project hook stayed excluded by project trust.

Discovered fixture skills: `branch-cycle-audit`, `close-session`, `context-reload`, `convert-to-spike`, `crash-recovery`, `cycle-close`, `cycle-create`, `drift-check`, `handoff-close`, `pr-orchestrate`, `promote-baseline`, `requirements-delta`, `start-session`.

Limit of the existing helper: it returns PASS when the returned error array is empty, even if its filtered skill list is empty. The probe initially hit a temporary Unicode-path encoding mismatch and obtained zero skills. That run is not accepted as discovery success. The corrected space-containing corpus returned the expected 13. Add an expected-name/count assertion to any future acceptance use. Accent handling remains unresolved harness/environment evidence, not an established AIDN or Codex defect. No Unix, WSL, GUI or subfolder acceptance result is claimed.

Temporary reproduction scripts: `probe-skills.mjs` and `probe-hooks.mjs`. Raw outputs: `skills-discovery-results.json`, `hooks-discovery-results.json`, `schema-summary.json`; generated schema directories: `schema-0155`, `schema-0146`. Raw files contain temporary local paths and must be normalized before tracking. `hooks-discovery-results.json` uses PASS for successful JSON-RPC responses; its warnings and empty hook list in 0.146 mean the MCP-handler capability test is incompatible, not operational.

## Installed events and handler support

The following exact event values were generated in `v2/HooksListResponse.json`:

| App-server event enum | Config event spelling | 0.155 schema | 0.146 schema | Matcher / lifecycle contract |
| --- | --- | --- | --- | --- |
| `sessionStart` | `SessionStart` | Present | Present | `startup`, `resume`, `clear`, `compact` |
| `sessionEnd` | `SessionEnd` | Present | Present | Main thread end, current reason `other`; no MCP handler per D |
| `userPromptSubmit` | `UserPromptSubmit` | Present | Present | Matcher ignored |
| `preToolUse` | `PreToolUse` | Present | Present | Canonical tool name and aliases |
| `permissionRequest` | `PermissionRequest` | Present | Present | Only an approval-requiring operation |
| `postToolUse` | `PostToolUse` | Present | Present | Tool already executed |
| `preCompact` | `PreCompact` | Present | Present | `manual`, `auto` |
| `postCompact` | `PostCompact` | Present | Present | `manual`, `auto` |
| `subagentStart` | `SubagentStart` | Present | Present | Agent type |
| `subagentStop` | `SubagentStop` | Present | Present | Agent type |
| `stop` | `Stop` | Present | Present | Matcher ignored; block asks for continuation |
| `interrupt` | `Interrupt` | Present | Absent | Main active turn; matcher ignored |

Schema presence does not prove GUI lifecycle execution. E runtime parser supports `command` and `mcp_tool` in 0.155. E 0.146 rejects `mcp_tool`. Its declared variants are `command`, `prompt`, `agent`; D says prompt/agent handlers are parsed but skipped, so do not propose them as an execution path. The 0.155 metadata also exposes `mcpTool` with server/tool, unlike 0.146. Both expose `managed`, `untrusted`, `trusted`, `modified` trust states.

Sources for external event semantics: [official hooks](https://learn.chatgpt.com/docs/hooks), source [schema 0.155](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/schema.rs), [schema 0.146](https://github.com/openai/codex/blob/86cc9f2177cad015befd595286d8767a650f7d13/codex-rs/hooks/src/schema.rs), [dispatcher event routing](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/engine/dispatcher.rs#L43-L75).

## Control, failure and bypass matrix

| Rule or need | Execution path and control | What can be prevented | Bypasses / failure behavior | Evidence |
| --- | --- | --- | --- | --- |
| AIDN admission before native tool | Synchronous local command hook -> AIDN CLI/core -> explicit deny | A covered pending local tool invocation, when hook loaded, trusted, enabled and successful | Missing/untrusted/disabled hook, unsupported tool path, runtime error or timeout can leave execution possible | S: PreToolUse parser and command runner; native runtime denial SKIP |
| AIDN admission through MCP hook | Native hook -> already-connected MCP server -> same core | Same covered invocation if a valid blocking response returns | Missing server/tool, connection error, MCP `is_error`, timeout; unsupported older client; no startup waiting | S: MCP executor and hook parser; real 0.146 parse incompatibility E; invocation failures SKIP |
| AIDN tool exposed through MCP, without native hook | Agent selects that MCP tool -> adapter -> core | Only the AIDN operation requested through that tool | Native shell/edit and other tools bypass the adapter entirely | Architectural boundary, not a blanket write interceptor |
| Shell / unified exec | Hook tool name `Bash` | Initial covered command | `write_stdin` does not invoke PreToolUse again for an admitted running session; later input is not a new admission | D: tool coverage; native session exercise SKIP |
| Patch edit | Canonical `apply_patch`, aliases `Edit`, `Write` | Covered patch before execution | Other paths, disabled hook, errors; post-hook cannot undo effects | S: `hook_names.rs`, registry; runtime SKIP |
| MCP tool call | Match tool name, e.g. `mcp__aidn__admit` | Covered tool invocation through Codex hook dispatch | Adapter cannot intercept unrelated tools; hook-invoked MCP itself does not recursively trigger normal hooks (D) | S: dispatch; runtime SKIP |
| Review after activity | PostToolUse, validation/drift checks | Result/continuation or later AIDN transition | Files may already be changed; no rollback guarantee | S: registry comment and result handling |
| Turn completion | Stop hook response | Can request another turn | Does not retroactively reject a completed tool; repeating Stop needs loop control | D/S; runtime SKIP |
| Project installation | Files present + skill discovery | Nothing by file presence alone | Project hooks excluded until project trust; hook definition trust additionally required | E: hooks/list vs skills/list |
| CI delivery checks | Existing repository gate | Delivery/merge according to actual provider policy | Does not prevent prior local writes | AIDN audit must establish exact gate policy separately |

Source-level failure detail at 0.155:

- `PreToolUse` begins with `should_block = false`. Runtime errors, invalid JSON, unsupported shapes, ordinary nonzero exit and missing exit status mark the hook failed while preserving false. A structured deny blocks. Exit 2 blocks only with a nonempty stderr reason; exit 2 with empty stderr fails open. See [pre_tool_use.rs lines 196-290](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/events/pre_tool_use.rs#L196-L290).
- Command spawn failure, stdin/wait error and timeout are `error` results. Thus a direct local hook removes the MCP connection dependency but is not intrinsically fail-closed. See [command_runner.rs lines 217-334](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/engine/command_runner.rs#L217-L334).
- MCP invocation explicitly passes `wait_for_server: false`; MCP `is_error` becomes an error. See [hook_mcp_executor.rs lines 18-53](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/core/src/hook_mcp_executor.rs#L18-L53). The runner turns failure into no exit status, empty stdout and an error, consumed by the same fail-open parser: [mcp_runner.rs lines 76-89](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/engine/mcp_runner.rs#L76-L89).
- Multiple matching local handlers are futures started together; completion reports are sorted in configured order. Any deny wins; competing rewrites use the last completed rewrite, not last configured. No hook can safely depend on another concurrently matching hook having finished. Sources: [dispatcher.rs lines 124-164](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/engine/dispatcher.rs#L124-L164), [pre_tool_use.rs lines 115-166](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/events/pre_tool_use.rs#L115-L166).
- A single configured handler matching several aliases runs once, but separately installed definitions are separate handlers. See [dispatcher.rs lines 43-75](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/hooks/src/engine/dispatcher.rs#L43-L75). Bootstrap/plugin ownership must prevent duplicated definitions.
- Native aliases are source-backed: [hook_names.rs lines 29-56](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/core/src/tools/hook_names.rs#L29-L56). Covered pre-hook dispatch and post-effect feedback handling live in [registry.rs](https://github.com/openai/codex/blob/4607249e430dac1c961df4dc615beae88e33cec8/codex-rs/core/src/tools/registry.rs).

For critical AIDN transitions, keep the core's prerequisite refusal independently executable. A hook wrapper may translate an AIDN failure into valid deny when it can run, but cannot convert its own non-execution or client-level fail-open into universal prevention. Keep guidance, AIDN refusal, covered native prevention, post-action detection and delivery gate as distinct claims.

## Options and proposed direction

| Option | Benefit | Cost / current limit | Proposed status |
| --- | --- | --- | --- |
| A: AGENTS + existing skills + local command hooks calling AIDN | Reuses core and CLI; no persistent server, extra API key or LLM call for admission; shortest dependency chain | Native trust/version/tool coverage and fail-open still matter; process launch cost must be measured | Preferred MVP foundation, subject to native E2E |
| B: A plus thin MCP adapter | Structured read-only discovery/state/admission/transition access to the same use cases; potentially avoids repeated CLI parsing | Additional process and readiness, schemas, timeouts, surface policy; MCP hook unsupported in installed IDE bundle; no universal interception | Defer until measurable tool UX/latency benefit; do not depend on it for SessionStart admission |
| C: Codex plugin packaging | Groups skills/MCP/hooks with native discovery and metadata | Current local marketplace/config/version differences; trust still human; duplicate install risk | Available upstream and in installed API schema, but AIDN plugin install/discovery/runtime SKIP; optional packaging experiment |
| Separate runner/app-server | Explicitly delegated lifecycle and approval interface for owned sessions | A separate client integration and lifecycle to maintain; not ownership of an arbitrary existing desktop chat | Advanced option only; retain bounded probes as diagnostics |

Plugin documentation supports a repo-local marketplace and a project enable setting, with trusted project configuration. Its local manual workflow includes a client restart. Plugin hook installation does not approve the hooks, and installing on the web does not deploy scripts into every execution environment. Current portable `plugin.json`/`mcp.json` differs from compatible `.codex-plugin/plugin.json`/`.mcp.json`; verify the target client parser before choosing packaging. Sources: [official packaging](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually), [bundled hooks](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks). No plugin was installed in this spike.

App-server feasibility is demonstrated for the bounded diagnostic handshake. The installed executable exposes schema generation and stdio. This does not demonstrate attaching to, controlling or taking over the already-running desktop chat. Use a separately owned session for any future runner. [Official app-server protocol](https://learn.chatgpt.com/docs/app-server#protocol) defines JSONL stdio and version-specific generated schemas. `thread/start` / `thread/resume` are separate from discovery and were not called. Required MCP startup can reject a session according to [official lifecycle](https://learn.chatgpt.com/docs/app-server#start-a-fresh-thread); this does not prove each subsequent hook fails closed.

Official [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) distinguishes startup and tool timeouts, optional startup grace and required servers. Project config needs trust. [Skill discovery](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) is native `.agents/skills` traversal, not AIDN's YAML inventory. Installed versions and per-surface observation must remain explicit in the diagnostic; desktop presence is not the same as CLI availability on PATH.

## Remaining native E2E protocol (SKIP in this session)

Use a disposable fixture and separate temporary home, pinned binary and a human-reviewed trust step. Never inject trusted-project entries or hook hashes. Record version, binary hash, fixture tree hash, branch, cwd/worktree, loaded hook hash, sandbox and actual approval origin. The human must review each changed definition. Do not connect a live client repository.

1. Through the native client, observe untrusted project exclusion, trust the disposable project, list hooks, then review exact AIDN hook definition. Re-run discovery and distinguish installed/detected/trusted from operational.
2. Launch and resume a disposable session, then compact manually/automatically where supported. Record events and compact context. A model call is needed for authentic agentic tool/compaction tests unless an upstream deterministic test harness is used; a homemade simulator is not native proof.
3. Attempt native `apply_patch`, initial shell, further `write_stdin` input and an MCP call. Use a visible harmless marker file. Valid deny must leave that operation's marker absent; valid admission must create exactly its authorized marker. Record the native hook/tool events.
4. Test valid structured deny, exit 2 with stderr, exit 2 without stderr, ordinary exit 1/exception, invalid JSON and timeout for the local command hook. Source predicts explicit-deny blocking and failure continuation; capture actual behavior, do not relabel continuation as a passing governance guarantee.
5. On an MCP-capable client, repeat valid deny, `is_error`, absent server, absent tool, unavailable connection, timeout and delayed startup. Also test `required` server startup separately. 0.146 should be classified incompatible before emitting `mcp_tool`, preventing a mixed-file regression.
6. Disable/unapprove the hook through native UI; verify AIDN's diagnostic becomes degraded. Check two hook sources, a single multi-alias matcher, concurrent denials/rewrites and repeated delivery. No duplicate effect is acceptable.
7. Revalidate admission after branch/worktree/content change and concurrent agents. Tie validation receipts to tested content/context. A model-provided PASS boolean cannot authorize a transition.
8. Run both actual Windows GUIs and CLI; then at least one Unix client. WSL is separate. Exercise spaces/accents, launch from subdirectory, app present with PATH launcher absent, interruption and recovery. Unsupported/unexecuted surfaces remain SKIP.

Exit criterion for the spike: capability matrix explains each observed discrepancy, native denial/panne claims carry a real trace or remain SKIP, and the design does not claim blanket write prevention. A local command hook is the recommended first admission path because it removes a server dependency, not because it changes Codex's failure semantics.
