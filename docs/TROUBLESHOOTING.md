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

## Forgot to customize the project stub

Symptom:
- Installer warning reports placeholders in `docs/audit/WORKFLOW.md` such as `{{PROJECT_NAME}}` or `{{SOURCE_BRANCH}}`.
- Team members are unclear on project constraints or branch policy.

Fix:
- Open `docs/audit/WORKFLOW.md` in the client repo.
- Complete the setup checklist and replace placeholder values.
- Follow `docs/INSTALL.md`, Step 3: `Customize docs/audit/WORKFLOW.md (Project Stub)`.
- Commit the updated stub as part of baseline setup.

## Confusion between product spec and project stub

Symptom:
- Team uses product spec path in client repos or edits the wrong file.
- Unclear whether to change `docs/SPEC.md`, `docs/audit/SPEC.md`, or `docs/audit/WORKFLOW.md`.

Fix:
- Use `docs/SPEC.md` only in the workflow product repository (source spec).
- Use `docs/audit/SPEC.md` in client repositories as the managed context snapshot (do not redefine rules there).
- Use `docs/audit/WORKFLOW.md` only for project-local constraints/policies.
- Re-run installer from the product repo to refresh client snapshot when the source spec changes.
- In client setup, follow `docs/INSTALL.md` section `Spec vs Project Stub (Why both exist)`.

## `docs/audit/SPEC.md` missing in client repository

Symptom:
- `docs/audit/SPEC.md` is missing after install or verify fails.

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
- In `--assist`, existing `AGENTS.md` is preserved by default.

## Re-run install safely

The installer is deterministic and idempotent for merge rules:
- `AGENTS.md` uses block replacement/append, not blind overwrite.
- `.gitignore` appends only unique lines.
- template copy steps overwrite targeted template-managed paths.

## AGENTS.md block explanation

`AGENTS.md` merge strategy is `block`:
- if target file does not exist, full template is written with markers.
- if target file exists, installer preserves it by default to avoid instruction interference.
- use `--force-agents-merge` to apply managed block replacement/insertion.
