# Installation Guide

## Template-only model

This workflow is installed by copying and merging template files into a client repository.
No compiled binaries are required.
The installer is a Node.js script and supports Node 18+ on Windows, Linux, and macOS.

## Spec vs Project Stub (Why both exist)

- Product spec source: `aidn-workflow/docs/SPEC.md`
  - Defines official workflow rules for the workflow product.
- Installed spec snapshot in client repos: `docs/audit/SPEC.md`
  - Managed snapshot used to keep core instructions in local runtime context.
- Project stub in client repos: `docs/audit/WORKFLOW.md`
  - Adapter file for local constraints and policies.

Client repositories receive template artifacts and a managed spec snapshot.

## Step 1 - Prerequisites

- Node.js 18 or newer
- This repository checked out locally

## Step 2 - Install core pack

From this repository root:

```bash
node tools/install.mjs --target ../your-repo --pack core
```

Install using workflow defaults (all packs listed in `package/manifests/workflow.manifest.yaml`):

```bash
node tools/install.mjs --target ../your-repo
```

Windows example:

```powershell
node tools/install.mjs --target C:\path\to\repo --pack core
```

Linux example:

```bash
node tools/install.mjs --target ../repo --pack core
```

Dry run example:

```bash
node tools/install.mjs --target ../your-repo --pack core --dry-run
```

Notes:
- The installer resolves `depends_on` recursively (for example `extended` installs `core` first).
- Compatibility is validated from product manifests (`node_min`, `os`) before file operations.
- If `codex_online: true`, installer requires the `codex` command to be installed and available in `PATH`.
- Compatibility policy and machine prereq result are printed in installer output (`Compatibility policy`, `Prereq check`).
- `.codex/skills.yaml` is rendered with the current workflow version tag (for example `v0.1.0`) and points to `https://github.com/leuzeus/aidn`.
- `AGENTS.md` non-interference policy:
  - if target `AGENTS.md` already exists, installer preserves it by default (no merge),
  - in `--assist`, preserving existing `AGENTS.md` is enforced by default,
  - use `--force-agents-merge` to explicitly update/insert the managed block,
  - use `--skip-agents` to always skip AGENTS merge.

## Step 3 - Customize docs/audit/WORKFLOW.md (Project Stub)

Before customization, review `docs/audit/SPEC.md` in the client repo.

Why it matters:
- Prevents hallucination about project constraints.
- Forces explicit local branch/cycle and snapshot policy.
- Regulates entropy before structural decisions drift.
- Preserves long-term coherence across cycles.
- Improves AI stability and reduces cognitive load during context reload.
- Keeps implementation choices aligned with your repo context.

Minimum fields to fill before real work:
- `project_name`
- `source_branch`
- `Project Constraints`
- `Branch & Cycle Policy`
- `Snapshot Discipline`
- `DoR policy` (minimal core gate + adaptive checks)

Short filled example:

```yaml
workflow_product: aidn-workflow
workflow_version: 0.1.0
installed_pack: core
project_name: my-product-repo
source_branch: main
```

Recommended practice:
- Treat this stub customization as part of baseline setup and commit it with other initial audit artifacts.

## Step 4 - Verify installation

```bash
node tools/install.mjs --target ../your-repo --pack core --verify
```

Verification checks required files declared in the pack manifest and returns a non-zero exit code on failure.
When dependencies are resolved, verification covers the union of required files across all installed packs.
The installer also prints a warning if the project stub still contains placeholders.

## Step 5 - Commit client repo files

- `AGENTS.md`
- `docs/audit/`
- `.codex/skills.yaml`
