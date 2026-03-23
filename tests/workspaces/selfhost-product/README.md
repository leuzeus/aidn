# aidn Self-Host Workspace

This directory defines the canonical self-host workspace contract for dogfooding `aidn` on `aidn`.

Rules:

- do not treat the product repository root as the self-host target
- use this workspace model, or a temporary copy derived from it, when you want a client-like install target for `aidn`
- runtime `.aidn/` content is expected and legitimate only inside this workspace model, not at the product root

Typical flow from the product repository root:

```bash
node tools/install.mjs --target tests/workspaces/selfhost-product --pack core --source-branch main
node tools/install.mjs --target tests/workspaces/selfhost-product --pack core --verify
```

For automated verification, see:

- `node tools/perf/verify-selfhost-workspace-fixtures.mjs`
