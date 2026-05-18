# Troubleshooting

## Node not found

Symptom:
- `node` command is not recognized.

Fix:
- Install Node.js 18+.
- Reopen your terminal and run `node -v`.

## Codex CLI missing (codex_online=true)

Symptom:
- Installer fails with `codex_online=true requires Codex CLI to be installed...`.

Fix:
- Install Codex CLI and ensure `codex` is available in `PATH`.
- Verify with `codex --version`.

## Verify failure

Symptom:
- `node tools/install.mjs --target <repo> --pack core --verify` prints `verified: FAIL`.

Fix:
- Read missing paths in command output.
- Re-run install:
  - `node tools/install.mjs --target <repo> --pack core`
- Run verify again.
- If output includes `missing import artifact: ...`, run:
  - `npx aidn perf index --target . --json`
  - then rerun verify.

## Artifact import failed during install

Symptom:
- Installer stops with `Artifact import failed: ...`.

Fix:
- Check `docs/audit/` exists and contains expected workflow files.
- Run import manually from client repo:
  - `npx aidn perf index --target . --json`
- Re-run install:
  - `node tools/install.mjs --target <repo> --pack core`
- If you need to bypass import temporarily:
  - `node tools/install.mjs --target <repo> --pack core --skip-artifact-import`
- If import runs with an unexpected backend, force it explicitly:
  - `node tools/install.mjs --target <repo> --pack core --artifact-import-store file`
  - `node tools/install.mjs --target <repo> --pack core --artifact-import-store dual-sqlite`

## Invalid .aidn/config.json

Symptom:
- Runtime or installer fails with `Invalid JSON in .../.aidn/config.json`.

Fix:
- Correct JSON syntax in `.aidn/config.json`.
- Or regenerate from install:
  - `node tools/install.mjs --target <repo> --pack core`

## Runtime backup, restore, or migration is blocked

Symptom:
- `db-status`, `persistence-adopt`, `persistence-migrate`, `shared-coordination-backup`, or `shared-coordination-restore` returns `blocked`, `target-unavailable`, `schema-incomplete`, or a connection resolution error.

Meaning:
- local SQLite runtime state, PostgreSQL runtime persistence, and shared coordination are separate operational surfaces.
- a shared coordination backup does not back up `docs/audit/*` or the local SQLite projection.
- a runtime persistence backup does not make shared coordination safe to overwrite.

Fix:
- Inspect local runtime first:
  - `npx aidn runtime db-status --target . --json`
  - `npx aidn runtime persistence-status --target . --json`
- Inspect shared coordination separately:
  - `npx aidn runtime shared-coordination-status --target . --json`
- Before applying a migration or restore, create the relevant backup:
  - `npx aidn runtime db-backup --target . --json`
  - `npx aidn runtime persistence-backup --target . --json`
  - `npx aidn runtime shared-coordination-backup --target . --json`
- Preview restore before writing:
  - `npx aidn runtime shared-coordination-restore --target . --json`
  - `npx aidn runtime shared-coordination-restore --target . --write --json`

If the failure mentions schema compatibility:
- run the migration preview first
- verify the target `scope_key` and backend kind
- do not purge or overwrite target rows until a backup exists

If the failure mentions a missing PostgreSQL connection:
- confirm the config uses `connectionRef` such as `env:AIDN_PG_URL`
- confirm the environment variable is set in the current shell
- do not paste raw connection strings into tracked files or issue output

References:
- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`
- `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`

## Forgot to customize the project stub

Symptom:
- Installer warning reports placeholders in `docs/audit/WORKFLOW.md`.
- Team members are unclear on branch ownership, continuity, or local constraints.

Fix:
- Open `docs/audit/WORKFLOW.md` in the client repo.
- Complete the setup checklist and replace placeholder values.
- Follow `docs/INSTALL.md`, Step 3.

## Assistant lost context or restarted

Symptom:
- Assistant starts proposing edits too quickly.
- Assistant ignores cycle/session context.
- Assistant behaves as if only part of the workflow is loaded.

Fix:
- Re-anchor in this order:
  - `docs/audit/CURRENT-STATE.md`
  - `docs/audit/WORKFLOW-KERNEL.md`
  - `docs/audit/WORKFLOW_SUMMARY.md`
  - `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
- If needed, continue with:
  - active session file
  - active cycle `status.md`
  - `docs/audit/WORKFLOW.md`
  - `docs/audit/SPEC.md`
- Use `docs/audit/REANCHOR_PROMPT.md` as the restart protocol.
- Do not allow durable writes until mode, branch kind, active cycle, `dor_state`, and first implementation step are explicit.

If runtime output additionally shows:
- `Runtime digest: docs/audit/RUNTIME-STATE.md`
  - open that file first for short runtime repair/freshness signals
- `Current state stale: docs/audit/CURRENT-STATE.md`
  - do not trust `CURRENT-STATE.md` as a sufficient summary
  - reload session/cycle facts and refresh summary state through workflow skills before writing

Important:
- this is usually a runtime re-anchor problem, not proof that `AGENTS.md` is obsolete
- in long Codex sessions, startup guidance may no longer be sufficient on its own
- rely on workflow skills, runtime hooks, and short audit artifacts to recover write discipline

## Confusion between spec, summary, and workflow adapter

Symptom:
- Team edits the wrong file.
- Canonical rules are duplicated in state files.

Fix:
- Canonical rules: `docs/audit/SPEC.md`
- Minimal re-anchor rules: `docs/audit/WORKFLOW-KERNEL.md`
- Current operational summary: `docs/audit/CURRENT-STATE.md`
- Runtime digest: `docs/audit/RUNTIME-STATE.md`
- Quick operating reload: `docs/audit/WORKFLOW_SUMMARY.md`
- Local adapter: `docs/audit/WORKFLOW.md`
- Artifact map: `docs/audit/ARTIFACT_MANIFEST.md`
- Rule/state guidance: `docs/audit/RULE_STATE_BOUNDARY.md`

## `apply_patch` or local AI editing feels too eager

Symptom:
- A local AI client tries to edit before the workflow context is fully reloaded.
- This may be observed with recent Codex local app flows, including Windows.

Fix:
- Treat `apply_patch` and direct edits as durable writes.
- Apply the same pre-write gate as any other mutation:
  - confirm mode
  - confirm branch kind
  - confirm active cycle when relevant
  - confirm `dor_state`
  - confirm first implementation step
- If context is incomplete or contradictory, stay read-only and use `docs/audit/REANCHOR_PROMPT.md`.
- Treat this as a sign of workflow drift, not as a special exemption of `apply_patch` from the workflow.
- To validate the resilience guardrails in the package and reference installed fixture, run:
  - `npm run perf:verify-context-resilience`
- To validate only the state summary against snapshot/session/cycle artifacts, run:
  - `npm run perf:verify-current-state-consistency -- --target <repo>`
- To validate the runtime hints and digest guidance, run:
  - `npm run perf:verify-runtime-digest-hints`
- Full command reference:
  - `docs/VERIFY_CONTEXT_RESILIENCE.md`

## Codex app says it stayed read-only so it skipped `start-session`

Symptom:
- A Codex desktop/app session says `start-session` was not executed because it is "mutative".
- The assistant claims it did only an informal re-anchor because the request was analysis-only.
- Workflow branch/session continuity was therefore never admitted.

Why this is wrong:
- In aid'n, `start-session` is admission-first.
- The admission phase is required even for analysis-only requests because it decides `resume | choose | create | stop` before any durable write.
- Read-only intent can justify stopping after admission; it does not justify skipping the admission step itself.

Fix:
- Run:
  - `npx aidn codex run-json-hook --skill start-session --mode <THINKING|EXPLORING|COMMITTING> --target . --strict --json`
- Read the admission result first.
- If it returns `stop`, surface the blocking reason and required user choice.
- Only continue in read-only mode after that explicit admission outcome is known.
- Do not replace `start-session` with an undocumented "re-anchor only" shortcut.

Typical root cause:
- Additional app-level guidance treats any potentially mutating skill as forbidden in read-only analysis.
- That heuristic is too coarse for aid'n because some workflow skills have mandatory non-mutating admission phases.

Reference:
- `scaffold/codex/start-session/SKILL.md`
- `scaffold/root/AGENTS.md`
- `scaffold/codex/README_CodexOnline.md`

## Missing continuity or incident templates after install

Symptom:
- Files such as `docs/audit/CONTINUITY_GATE.md` or `docs/audit/incidents/TEMPLATE_INC_TMP.md` are missing.

Fix:
- Re-run install:
  - `node tools/install.mjs --target <repo> --pack core`
- Re-run verify:
  - `node tools/install.mjs --target <repo> --pack core --verify`

## Repair-layer says a cycle is unresolved but the `status.md` exists locally

Symptom:
- runtime triage reports a cycle reference problem
- you can see `docs/audit/cycles/CXXX-*/status.md` on disk
- the message used to look like "missing cycle status" even though the file exists locally

Meaning:
- `UNTRACKED_CYCLE_STATUS_REFERENCE`
  - the matching `status.md` exists locally, but git/runtime tracking has not picked it up yet
- `UNINDEXED_CYCLE_STATUS_REFERENCE`
  - the matching `status.md` is tracked, but the current runtime index still does not see it
- `UNRESOLVED_CYCLE_REFERENCE`
  - no matching `status.md` was found in the index or on disk

Fix:
- For a tracked-but-not-indexed artifact:
  - `npx aidn perf index --target . --store sqlite --sqlite-output .aidn/runtime/index/workflow-index.sqlite --json`
  - or rerun your normal DB-backed sync flow
- For a local-but-untracked artifact:
  - track the `status.md` in git
  - then refresh the runtime index
- For a truly missing artifact:
  - restore or create the referenced `status.md`

Notes:
- this is often an index visibility problem, not a workflow continuity contradiction
- `pre-write-admit` should now warn with the real cause instead of implying the cycle artifact is absent

## Merge conflict in AGENTS.md

Symptom:
- Workflow block appears duplicated or manually edited around merge markers.

Fix:
- Keep one managed block between:
  - `<!-- CODEX-AUDIT-WORKFLOW START -->`
  - `<!-- CODEX-AUDIT-WORKFLOW END -->`
- Re-run installer to refresh only that block:
  - `node tools/install.mjs --target <repo> --pack core`
- If you need to keep local instructions untouched:
  - `node tools/install.mjs --target <repo> --pack core --skip-agents`
- If you explicitly want to update managed block in existing AGENTS:
  - `node tools/install.mjs --target <repo> --pack core --force-agents-merge`

## Wrong instruction file seems active

Symptom:
- Codex behaves differently from the installed root `AGENTS.md`.
- The workflow contract appears to be ignored even though install succeeded.

Fix:
- Remember the Codex precedence chain:
  - `~/.codex/AGENTS.override.md` or `~/.codex/AGENTS.md`
  - repo root `AGENTS.override.md` or `AGENTS.md`
  - closer nested `AGENTS.override.md` or `AGENTS.md`
- From the client repo root, run:
  - `codex --ask-for-approval never "Summarize the current instructions."`
- From a nested directory, run:
  - `codex --cd <subdir> --ask-for-approval never "Show which instruction files are active."`
- If guidance is still unexpected:
  - inspect `~/.codex/AGENTS.override.md`
  - inspect repo-level `AGENTS.override.md`
  - inspect nested overrides closer to the working directory
  - confirm whether `CODEX_HOME` points to a non-default profile

## Re-run install safely

The installer is deterministic and idempotent for merge rules:
- `AGENTS.md` uses block replacement/append, not blind overwrite.
- `.gitignore` appends only unique lines.
- Template copy steps overwrite targeted template-managed paths.
