# Product, Installed, And Self-Host Boundaries

Date: 2026-03-13
Status: active

## Purpose

This note defines the stable boundary between:

- the `aidn` product repository
- installed client repositories
- explicit self-host workspaces used to dogfood `aidn` on `aidn`

The installed client contract stays unchanged.
The goal is to remove ambiguity inside the product repository.

## Product Repository

Inside the product repository:

- `docs/` is product documentation
- `src/`, `bin/`, `tools/`, `packs/`, and `package/` are product implementation surfaces
- `scaffold/` contains installable source material

`scaffold/` is not a live client repository.
It is the product-owned installation source used to render or copy installed artifacts.

## Installed Client Repository

Inside installed client repositories, the public contract remains:

- `docs/audit/*`
- `AGENTS.md`
- `.codex/*`
- `.aidn/config.json`
- `.aidn/project/workflow.adapter.json`
- `.aidn/runtime/*`

These paths are runtime-visible and must remain stable for `files`, `dual`, and `db-only`.

## Self-Host Workspace

The canonical self-host workspace path is:

- `tests/workspaces/selfhost-product/`

Rule:

- self-hosting should happen in that dedicated client-like workspace model, not in the product root

The committed directory is only the workspace contract and bootstrap seed.
When used for real dogfooding, runtime artifacts under `.aidn/` are legitimate only inside that workspace or temporary copies derived from it.

## Product-Local Scratch Runtime

If product-local scratch state is needed outside the self-host workspace, use:

- `.aidn-dev/`

Do not use product-root `.aidn/` as the normal dogfooding/runtime scratch path.

Reason:

- product-root `.aidn/` is too easy to confuse with a real installed client runtime

## `tools/` Decision

Current decision:

- keep `tools/` as-is

Reason:

- the main collision came from `template/` and ambiguous product-root `.aidn/`
- renaming `tools/` would create broad churn without solving the primary self-host confusion

This can be revisited later if contributor feedback shows persistent confusion.
