# Backlog Product Self-Host Standardization - 2026-03-13

## Goal

Track the work needed to standardize the `aidn` product repository so product development, installed client repos, and self-host workspaces do not collide semantically or structurally.

Reference plan:

- `docs/PLAN_PRODUCT_SELFHOST_STANDARDIZATION_2026-03-13.md`

## Backlog Items

### PSS-01 - Define Product Path Policy

Status: completed
Priority: high

Files:

- architecture docs
- install docs
- path helper modules as needed

Why:

- the migration needs one explicit vocabulary for `product`, `scaffold`, `installed`, and `self-host`

Done when:

- the boundary between product-internal and installed-public paths is documented
- the self-host workspace rule is explicit
- root `.aidn/` usage policy is documented

### PSS-02 - Introduce Scaffold Path Abstraction

Status: completed
Priority: high

Files:

- install/render/template IO code
- migration/test helpers

Why:

- renaming `template/` safely requires removing ad hoc path assumptions first

Done when:

- code resolves scaffold roots through one shared helper or policy
- product logic no longer hardcodes `scaffold/` in scattered places

### PSS-03 - Rename `template/` To `scaffold/`

Status: completed
Priority: high

Files:

- `template/*` tree
- all product references
- docs and tests

Why:

- `scaffold` is clearer and avoids confusion with a live installed repo

Done when:

- the source tree uses `scaffold/`
- no active code path still expects `template/`
- generated/install behavior is unchanged

### PSS-04 - Update Install And Rendering Pipelines After Rename

Status: completed
Priority: high

Files:

- install services
- render services
- CLI entrypoints

Why:

- install must continue to copy and render the same public contract after internal path standardization

Done when:

- install succeeds from the renamed scaffold source
- generated docs still match expected outputs
- migration tooling still works

### PSS-05 - Update Tests And Fixture Tooling After Rename

Status: completed
Priority: high

Files:

- perf tests
- install tests
- fixture tooling

Why:

- the path rename will otherwise leave latent breakage in product verification

Done when:

- all affected tests pass with `scaffold/`
- no fixture setup logic assumes `template/`

### PSS-06 - Define Product Runtime Scratch Namespace

Status: completed
Priority: high

Files:

- runtime docs
- local tooling helpers if needed
- ignore rules

Why:

- product-local scratch/runtime state must not masquerade as installed `.aidn/`

Done when:

- one explicit product-local scratch namespace is chosen
- root `.aidn/` is no longer recommended for product-local dogfooding state
- ignore rules and docs are aligned

### PSS-07 - Add Dedicated Self-Host Workspace Contract

Status: completed
Priority: high

Files:

- workspace docs
- optional helper scripts
- smoke tests

Why:

- self-hosting should be explicit and isolated from the product root

Done when:

- one dedicated self-host workspace path is defined
- install/reinstall/verify workflow is documented for that workspace
- self-host runtime `.aidn/` usage is clearly legitimate only inside that workspace

### PSS-08 - Add Self-Host Smoke Verification

Status: completed
Priority: medium

Files:

- perf or install verification scripts
- optional workspace fixture/bootstrap helpers

Why:

- once a self-host path exists, it needs regression coverage

Done when:

- a smoke test validates package install + verify in the self-host workspace model
- `dual` and `db-only` expectations remain intact where applicable

### PSS-09 - Document Product vs Installed vs Self-Host Boundaries

Status: completed
Priority: medium

Files:

- `README.md`
- `docs/INSTALL.md`
- optional dedicated architecture note

Why:

- contributors need a crisp rule set to avoid falling back into ambiguous usage

Done when:

- docs explicitly distinguish:
  - product repo assets
  - installed client assets
  - self-host workspace assets

### PSS-10 - Evaluate Optional `tools/` To `devtools/` Rename

Status: completed
Priority: low

Files:

- architecture docs
- tooling references

Why:

- this may improve clarity further, but it is not required for the main collision fix

Done when:

- an explicit decision is recorded:
  - keep `tools/` as-is
  - or schedule a later rename

Decision recorded:

- keep `tools/` as-is for now

Reason:

- `template/` and product-root `.aidn/` were the main collision sources
- renaming `tools/` now would add broad churn without materially improving the self-host boundary

## Recommended First Executable Lot

1. `PSS-01`
2. `PSS-02`
3. `PSS-06`
4. `PSS-07`

## Recommended Second Lot

1. `PSS-03`
2. `PSS-04`
3. `PSS-05`

## Recommended Third Lot

1. `PSS-08`
2. `PSS-09`
3. `PSS-10`

## Open Questions

- should the self-host workspace live under `playgrounds/` or `tests/workspaces/`? resolved: `tests/workspaces/`
- should scaffold path abstraction be a dedicated lib or stay within install/template IO services?
- should product-local scratch state use `.aidn-dev/` or a subdirectory under `tmp/`? resolved: `.aidn-dev/`

## Result

Backlog completed.
