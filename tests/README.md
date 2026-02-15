# Tests

## Fixture folders

- `tests/fixtures/repo-empty/`: empty target repository fixture.
- `tests/fixtures/repo-installed-core/`: target repository after core pack install.

## Regenerate fixtures

From repository root:

```bash
Remove-Item -Recurse -Force tests/fixtures/repo-installed-core/*
node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core
```

If you are on Linux/macOS:

```bash
rm -rf tests/fixtures/repo-installed-core/*
node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core
```

## Manual installer checks

Dry run against empty fixture:

```bash
node tools/install.mjs --target tests/fixtures/repo-empty --pack core --dry-run
```

Install then verify:

```bash
node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core
node tools/install.mjs --target tests/fixtures/repo-installed-core --pack core --verify
```
