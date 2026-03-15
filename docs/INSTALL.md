# Installation Guide

## Scaffold-based model

This workflow is installed by copying and merging scaffold files into a client repository.
No compiled binaries are required.
The installer is a Node.js script and supports Node 18+ on Windows, Linux, and macOS.

## Spec vs Project Stub (Why both exist)

- Product spec source: `aidn-workflow/docs/SPEC.md`
  - Defines official workflow rules for the workflow product.
- Installed spec snapshot in client repos: `docs/audit/SPEC.md`
  - Managed snapshot used to keep core instructions in local runtime context.
- Project stub in client repos: `docs/audit/WORKFLOW.md`
  - Adapter file for local constraints and policies.

Client repositories receive scaffold artifacts and a managed spec snapshot.

Installed workflow support files now also include:

- `docs/audit/WORKFLOW-KERNEL.md` for the shortest safe re-anchor path
- `docs/audit/CURRENT-STATE.md` for current operational summary
- `docs/audit/RUNTIME-STATE.md` for short runtime/freshness signals
- `docs/audit/REANCHOR_PROMPT.md` for assistant restart / partial-memory recovery
- `docs/audit/ARTIFACT_MANIFEST.md` for "where to read what"

## Step 1 - Prerequisites

- Node.js 18 or newer
- npm 9+ recommended

## Step 2 - Install aidn as npm package (recommended)

Install from GitHub:

```bash
npm install --save-dev github:leuzeus/aidn#dev
```

Install from local path (offline/local dev):

```bash
npm install --save-dev ../aidn
```

After install, use the package CLI via `npx aidn ...`.

## Step 3 - Install core or composite pack

From your client repository root:

```bash
npx aidn install --target . --pack core
```

Install the explicit composite profile:

```bash
npx aidn install --target . --pack extended
```

Install using workflow defaults (the default compatibility profile listed in `package/manifests/workflow.manifest.yaml`):

```bash
npx aidn install --target .
```

Install with explicit source branch metadata:

```bash
npx aidn install --target . --pack core --source-branch main
```

Windows example:

```powershell
npx aidn install --target C:\path\to\repo --pack core
```

Linux example:

```bash
npx aidn install --target ../repo --pack core
```

Dry run example:

```bash
npx aidn install --target . --pack core --dry-run
```

Artifact import store override example:

```bash
npx aidn install --target . --pack core --artifact-import-store dual-sqlite
```

Notes:
- The installer resolves `depends_on` recursively (for example `extended` installs `core` first).
- Pack intent is:
  - `core`: compatibility/default install profile
  - `runtime-local`: targeted refresh of local runtime adapter examples
  - `codex-integration`: targeted refresh of local Codex skill assets
  - `extended`: explicit full-stack composite profile
- Compatibility is validated from product manifests (`node_min`, `os`) before file operations.
- If `codex_online: true`, installer requires the `codex` command to be installed and available in `PATH`.
- If `codex_online: true`, installer also requires Codex authentication (`codex login`).
- Compatibility policy and machine prereq result are printed in installer output (`Compatibility policy`, `Prereq check`).
- `.codex/skills.yaml` is rendered with the current workflow version tag (scaffold value `v{{VERSION}}`, rendered at install time using the `VERSION` file) and points to `https://github.com/leuzeus/aidn`.
- The installer also copies local skill sources under `.codex/skills/*` (one folder per skill) for local/offline availability.
- Codex instruction layering after install is:
  - optional global layer: `~/.codex/AGENTS.md` or `~/.codex/AGENTS.override.md`
  - installed project layer: root `AGENTS.md`
  - optional nested project overrides: closer `AGENTS.md` or `AGENTS.override.md`
- `aidn` installs and maintains only the project layer; it does not write to `~/.codex`.
- Placeholder policy:
  - installer resolves placeholders across copied scaffold files (not only `{{VERSION}}`),
  - `SOURCE_BRANCH` can be defined explicitly at install time with `--source-branch <name>`,
  - `SOURCE_BRANCH` is resolved from explicit configuration only: `--source-branch` first, then existing `.aidn/config.json` (`workflow.sourceBranch`),
  - if `SOURCE_BRANCH` is still missing and install is interactive, the installer asks for it explicitly,
  - when non-interactive, missing values are auto-filled with safe defaults (for example `TO_DEFINE`),
  - placeholders already present in project files are inferred and reused during updates/migrations, except `SOURCE_BRANCH` which is not inferred from existing workflow/session/cycle documents.
  - non-interactive `SOURCE_BRANCH` fallback order is: Git remote default branch > current branch > `main`.
- `AGENTS.md` non-interference policy:
  - if target `AGENTS.md` already exists, installer preserves it by default (no merge),
  - in `--assist`, preserving existing `AGENTS.md` is enforced by default,
  - use `--force-agents-merge` to explicitly update/insert the managed block,
  - use `--skip-agents` to always skip AGENTS merge.
- `AGENTS.override.md` precedence note:
  - if target root `AGENTS.override.md` already exists, Codex will prefer it over the installed root `AGENTS.md`,
  - review that file before assuming the installed `AGENTS.md` is active,
  - nested `AGENTS.override.md` files can also override broader project guidance.
- Customized project files policy:
  - the installer does not overwrite existing files that are expected to be customized in the client repo,
  - known placeholders (for example `{{VERSION}}`) are still replaced in preserved files when values are available,
  - when `codex` is available, installer attempts an AI-assisted migration for those files,
  - AI migration requires a logged-in Codex session (`codex login status` must be authenticated),
  - if migration is unavailable/fails, files remain unchanged,
  - disable AI migration with `--no-codex-migrate-custom`.
- Artifact import policy:
  - after install (non-verify mode), installer automatically imports `docs/audit/*` artifacts into `.aidn/runtime/index/*`,
  - import store precedence: `--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE` mapping,
  - `AIDN_STATE_MODE` mapping remains: `files -> file`, `dual -> dual-sqlite`, `db-only -> sqlite`,
  - default install profile is DB-backed: `runtime.stateMode=dual` and `install.artifactImportStore=dual-sqlite`,
  - disable automatic import with `--skip-artifact-import`,
  - installer auto-creates or updates `.aidn/config.json` (non-destructive merge) to persist runtime defaults,
  - installer also persists the resolved project source branch in `.aidn/config.json` under `workflow.sourceBranch`,
  - runtime source-branch readers use `.aidn/config.json` first, then fall back to installed workflow artifacts for backward compatibility.
- Optional Codex project config:
  - `aidn` does not install `.codex/config.toml` by default,
  - use a project Codex config only when you need non-default `project_doc_fallback_filenames` or `project_doc_max_bytes`.

## Step 4 - Configure The Project Adapter

The project adapter is no longer a hand-maintained `WORKFLOW.md` file.

The durable input is:

- `.aidn/project/workflow.adapter.json`

The generated outputs are:

- `docs/audit/WORKFLOW.md`
- `docs/audit/WORKFLOW_SUMMARY.md`
- `docs/audit/CODEX_ONLINE.md`
- `docs/audit/index.md`

Use one of these entry points to manage the adapter config:

```bash
npx aidn project config --target . --wizard
npx aidn project config --target . --list --json
```

For already-installed repositories that still carry local workflow policy in `docs/audit/WORKFLOW.md`, migrate once with:

```bash
npx aidn project config --target . --migrate-adapter --version "$(cat node_modules/aidn-workflow/VERSION)" --json
```

If your shell does not support that inline version command, pass the installed package version explicitly.

Legacy note:

- `legacyPreserved.importedSections` is compatibility-only
- new or migrated repositories should move active policy into structured adapter fields and deterministic generated sections
- readers still accept `legacyPreserved.importedSections` for older repositories during the transition window
- once migration drains that field, do not reintroduce durable policy there

### Ownership classes used by install/reinstall

- `generated`
  - deterministic outputs rendered from scaffold files + `.aidn/config.json` + `.aidn/project/workflow.adapter.json`
  - current set:
    - `docs/audit/WORKFLOW.md`
    - `docs/audit/WORKFLOW_SUMMARY.md`
    - `docs/audit/CODEX_ONLINE.md`
    - `docs/audit/index.md`
- `seed-once`
  - created if missing, then preserved on reinstall
  - current set:
    - `docs/audit/baseline/current.md`
    - `docs/audit/baseline/history.md`
    - `docs/audit/parking-lot.md`
- `runtime-state`
  - owned by runtime/session flows, not by reinstall
  - current set:
    - `docs/audit/snapshots/context-snapshot.md`
- `preserved-custom`
  - still eligible for placeholder normalization and optional Codex migration if explicitly enabled
  - current set:
    - `docs/audit/glossary.md`

Persistence rules:

- install creates `.aidn/project/workflow.adapter.json` if missing
- reinstall and reinitialization never overwrite that file automatically
- generated files may be rewritten deterministically
- `seed-once` and `runtime-state` files are preserved

If your repository ignores `.aidn/`, carve out an exception for `.aidn/project/workflow.adapter.json` when you want team-shared persistence across clones.

### What to edit directly

- edit `.aidn/project/workflow.adapter.json` via `aidn project config`
- do not rely on direct edits to generated sections of `docs/audit/WORKFLOW.md`, `WORKFLOW_SUMMARY.md`, `CODEX_ONLINE.md`, or `index.md`
- keep project memory in `baseline/*`, `parking-lot.md`, and runtime state in `snapshots/context-snapshot.md`
- when changing generated workflow wording, edit the readable fragment templates under `scaffold/fragments/workflow/` and keep the JS layer focused on data preparation

## Product Boundary Note

Inside the `aidn` product repository:

- `scaffold/` is product-owned install source material, not a live installed repo
- product-local scratch runtime should use `.aidn-dev/` if needed
- self-host dogfooding should use the dedicated workspace model under `tests/workspaces/selfhost-product/`

Boundary reference:

- `docs/PRODUCT_SELFHOST_BOUNDARIES.md`

Before configuring adapter policy, review in this order:
1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
5. `docs/audit/WORKFLOW.md`
6. `docs/audit/SPEC.md` when canonical rule precision is needed

Why it matters:
- Reduces assistant re-anchor time after partial context loss.
- Prevents ambiguity around canonical rules vs local adapter policies.
- Forces explicit local branch/cycle and continuity policy.
- Regulates entropy before structural decisions drift.
- Preserves long-term coherence across cycles.

Minimal durable-write rule after install:
- before any durable write, confirm mode, branch kind, active cycle when relevant, `dor_state`, and the first implementation step
- use `docs/audit/REANCHOR_PROMPT.md` if an assistant restarted or lost context

Minimum adapter fields to fill before real work:
- `projectName`
- runtime, architecture, and delivery constraints
- `runtimePolicy.preferredStateMode`
- `runtimePolicy.defaultIndexStore`
- `dorPolicy`
- snapshot policy fields that should survive reinstall

Recommended practice:
- Treat adapter config setup as part of baseline setup and commit or persist it with the repository.

## Step 5 - Verify installation

```bash
npx aidn install --target . --pack core --verify
```

Verification checks required files declared in the pack manifest and returns a non-zero exit code on failure.
When dependencies are resolved, verification covers the union of required files across all installed packs.
Verification also checks expected imported index artifacts under `.aidn/runtime/index/*` using import-store precedence (`--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE`).
Use `--skip-artifact-import` with `--verify` to skip this import-artifact check.
The installer also prints a warning if the project stub still contains placeholders.
For workflow-resilience maintenance in the product repository, use:
- `npm run perf:verify-context-resilience`
- command details in `docs/VERIFY_CONTEXT_RESILIENCE.md`

To verify the actual Codex instruction chain from the client repo, also run:

```bash
codex --ask-for-approval never "Summarize the current instructions."
codex --cd docs/audit --ask-for-approval never "Show which instruction files are active."
```

If the wrong guidance appears:
- check for `AGENTS.override.md` at the repo root
- check for nested `AGENTS.override.md` closer to the current directory
- check for `~/.codex/AGENTS.override.md` or a custom `CODEX_HOME`

Default runtime config file generated by install (`.aidn/config.json`) example:

```json
{
  "version": 1,
  "profile": "dual",
  "install": {
    "artifactImportStore": "dual-sqlite"
  },
  "runtime": {
    "stateMode": "dual"
  },
  "workflow": {
    "sourceBranch": "main"
  }
}
```

## Step 6 - Commit client repo files

- `AGENTS.md`
- `docs/audit/`
- `.codex/skills.yaml`
- `.aidn/project/workflow.adapter.json` when you want shared, versioned project adapter settings

Usually do not treat `.aidn/config.json` as the shared adapter source of truth. It stores runtime/install defaults such as `workflow.sourceBranch`, while `.aidn/project/workflow.adapter.json` stores durable project policy used by deterministic generation.

Commit optional `.codex/config.toml` only if your team deliberately uses project-level Codex discovery settings such as:
- `project_doc_fallback_filenames`
- `project_doc_max_bytes`

Recommended first reload path in client repos:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter

## Runtime perf tooling (important)

- `tools/perf/*` stays in the aidn product repository and is not copied into client repositories.
- Use the installed package CLI from the client repo:
  - `npx aidn perf checkpoint --target . --mode COMMITTING --index-store all --index-sync-check --json`
  - `npx aidn perf session-start --target . --mode COMMITTING --json`
  - `npx aidn perf session-close --target . --mode COMMITTING --json`
- Runtime artifacts are written under `<target>/.aidn/runtime/*` (not in `<target>/tools`).
- Optional runtime state mode:
  - `AIDN_STATE_MODE=files|dual|db-only`
  - default mapping: `files -> file`, `dual -> dual-sqlite`, `db-only -> sqlite`
  - default fresh install uses `dual` (DB-backed) when no override is provided
  - explicit CLI `--index-store` still has priority.
  - in `dual`/`db-only`, index payload content embedding is enabled by default so files can be reconstructed from DB.
