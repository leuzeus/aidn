# Installation Guide

## Template-only model

This workflow is installed by copying and merging template files into a client repository.
No compiled binaries are required.
The installer is a Node.js script and supports Node 18+ on Windows, Linux, and macOS.

## Prerequisites

- Node.js 18 or newer
- This repository checked out locally

## Install core pack

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

## Verify installation

```bash
node tools/install.mjs --target ../your-repo --pack core --verify
```

Verification checks required files declared in the pack manifest and returns a non-zero exit code on failure.

## What must be committed in the client repo

- `AGENTS.md`
- `docs/audit/`
- `.codex/skills.yaml`
