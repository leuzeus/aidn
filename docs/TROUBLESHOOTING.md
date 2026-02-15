# Troubleshooting

## Node not found

Symptom:
- `node` command is not recognized.

Fix:
- Install Node.js 18+.
- Reopen your terminal and run `node -v`.

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
- Unclear whether to change `docs/SPEC.md` or `docs/audit/WORKFLOW.md`.

Fix:
- Use `docs/SPEC.md` only in the workflow product repository.
- Use `docs/audit/WORKFLOW.md` only in client repositories.
- In client setup, follow `docs/INSTALL.md` section `Spec vs Project Stub (Why both exist)`.

## Merge conflict in AGENTS.md

Symptom:
- Workflow block appears duplicated or manually edited around merge markers.

Fix:
- Keep one managed block between:
  - `<!-- CODEX-AUDIT-WORKFLOW START -->`
  - `<!-- CODEX-AUDIT-WORKFLOW END -->`
- Re-run installer to refresh only that block:
  - `node tools/install.mjs --target <repo> --pack core`

## Re-run install safely

The installer is deterministic and idempotent for merge rules:
- `AGENTS.md` uses block replacement/append, not blind overwrite.
- `.gitignore` appends only unique lines.
- template copy steps overwrite targeted template-managed paths.

## AGENTS.md block explanation

`AGENTS.md` merge strategy is `block`:
- if target file does not exist, full template is written with markers.
- if markers exist, only the marked block is replaced.
- if markers do not exist, the managed block is appended to the end.
