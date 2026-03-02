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
