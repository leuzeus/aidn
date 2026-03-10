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

## Missing continuity or incident templates after install

Symptom:
- Files such as `docs/audit/CONTINUITY_GATE.md` or `docs/audit/incidents/TEMPLATE_INC_TMP.md` are missing.

Fix:
- Re-run install:
  - `node tools/install.mjs --target <repo> --pack core`
- Re-run verify:
  - `node tools/install.mjs --target <repo> --pack core --verify`

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
