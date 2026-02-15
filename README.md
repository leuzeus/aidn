# Codex Audit Workflow

Template-only packaging version.

## Spec vs Stub

- Product repository contains:
  - Official spec: `docs/SPEC.md`
  - Install templates: `template/`
- Client repositories receive:
  - Project adapter stub at `docs/audit/WORKFLOW.md`
  - Other audit template artifacts

## Quick install

```bash
node tools/install.mjs --target ../client --pack core
node tools/install.mjs --target ../client --pack core --verify
```
