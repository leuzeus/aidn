# Installation Guide

## Template-only model

This workflow is installed by copying and merging template files into a client repository.
No compiled binaries are required.
The installer is a Node.js script and supports Node 18+ on Windows, Linux, and macOS.

## Step 1 - Prerequisites

- Node.js 18 or newer
- This repository checked out locally

## Step 2 - Install core pack

From this repository root:

```bash
node tools/install.mjs --target ../your-repo --pack core
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

## Step 3 - Customize docs/audit/WORKFLOW.md (Project Stub)

Why it matters:
- Prevents hallucination about project constraints.
- Forces explicit local branch/cycle and snapshot policy.
- Keeps implementation choices aligned with your repo context.

Minimum fields to fill before real work:
- `project_name`
- `source_branch`
- `Project Constraints`
- `Branch & Cycle Policy`
- `Snapshot Discipline`

Short filled example:

```yaml
workflow_product: codex-audit-workflow
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
The installer also prints a warning if the project stub still contains placeholders.

## Step 5 - Commit client repo files

- `AGENTS.md`
- `docs/audit/`
- `.codex/skills.yaml`
