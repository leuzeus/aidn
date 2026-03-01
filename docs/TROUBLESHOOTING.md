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
- Installer warning reports placeholders in `docs/audit/WORKFLOW.md`.
- Team members are unclear on branch ownership, continuity, or local constraints.

Fix:
- Open `docs/audit/WORKFLOW.md` in the client repo.
- Complete the setup checklist and replace placeholder values.
- Follow `docs/INSTALL.md`, Step 3.

## Confusion between spec, summary, and workflow adapter

Symptom:
- Team edits the wrong file.
- Canonical rules are duplicated in state files.

Fix:
- Canonical rules: `docs/audit/SPEC.md`
- Quick operating reload: `docs/audit/WORKFLOW_SUMMARY.md`
- Local adapter: `docs/audit/WORKFLOW.md`
- Rule/state guidance: `docs/audit/RULE_STATE_BOUNDARY.md`

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

## Re-run install safely

The installer is deterministic and idempotent for merge rules:
- `AGENTS.md` uses block replacement/append, not blind overwrite.
- `.gitignore` appends only unique lines.
- Template copy steps overwrite targeted template-managed paths.
