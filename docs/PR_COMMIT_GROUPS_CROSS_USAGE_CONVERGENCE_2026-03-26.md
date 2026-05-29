# Commit Groups - Cross-Usage Convergence Branch

## Group 1 - Canonical docs and templates

- `50c602b` `docs: add cross-usage convergence plan`
- `5d9f708` `docs: add cross-usage convergence to spec`
- `639852e` `docs: add cross-usage policy to workflow adapter`
- `1d2f657` `docs: add usage matrix cycle templates`
- `c2828ab` `docs: enforce usage matrix in agent workflow`
- `26a8f92` `docs: surface usage matrix in reload docs`
- `75c232f` `docs: document cross-usage configuration`
- `cfc6525` `docs: close cross-usage convergence backlog`

## Group 2 - Adapter/config integration

- `07c32ed` `feat: add structured cross-usage adapter policy`
- `881243b` `test: cover cross-usage adapter policy`
- `085a8c3` `test: refresh installed-core workflow fixtures`

## Group 3 - Admission and hook enforcement

- `c62937d` `feat: enforce usage matrix at baseline promotion`
- `80df19c` `test: refresh promote-baseline cycle templates`
- `b854dd4` `feat: enforce usage matrix at cycle close`
- `b694101` `test: cover cycle-close usage matrix gate`
- `26f5963` `feat: gate cycle-close usage matrix in pre-write admit`
- `62d6af9` `test: cover cycle-close pre-write usage matrix gate`
- `7b7feb9` `feat: expose cycle-close gate details in codex hook output`
- `cd64fcf` `docs: clarify cycle-close usage matrix stop conditions`
- `43fd8b7` `test: verify cycle-close gate details in codex output`
- `c9ef10b` `feat: gate promote-baseline usage matrix in pre-write admit`
- `4148b04` `docs: clarify promote-baseline usage matrix stop conditions`
- `1d32579` `test: cover promote-baseline usage matrix gates`

## Group 4 - Verifier cleanup hardening

- `a29dd22` `test: harden fixture cleanup on windows`
- `737a351` `test: reuse windows-safe cleanup across admission fixtures`
- `e4cdfcd` `test: apply windows-safe cleanup to core fixture verifiers`
- `4fa0ab8` `test: extend windows-safe cleanup to repair fixture verifiers`
- `fa813ec` `test: apply windows-safe cleanup to coordinator install verifiers`
- `4a51507` `test: extend windows-safe cleanup to coordinator fixture verifiers`
- `079d60a` `test: extend windows-safe cleanup to multi-agent db-only verifiers`
- `42077b1` `test: apply windows-safe cleanup to config db-runtime verifiers`
- `99cc305` `test: harden sync db-first fixture cleanup`
- `bbba438` `test: harden mode migrate fixture cleanup`
- `50043b5` `test: harden repair-layer findings fixture cleanup`
- `b2a397e` `test: harden repair-layer fixture cleanup`
- `8a078f9` `test: harden coordination fixture cleanup`
- `9fec2ff` `test: harden handoff runtime-state fixture cleanup`
- `b620647` `test: harden db schema integration fixture cleanup`
- `82a1da9` `test: harden db-only readiness fixture cleanup`
- `64b6474` `test: harden repair context fixture cleanup`
- `c768b1a` `test: harden promoted workflow fixture cleanup`
- `bfcb99c` `test: harden remaining fixture cleanup`
- `efb3fe1` `test: harden session plan fixture cleanup`
- `77c58b2` `test: harden reset runtime cleanup`

## Group 5 - Runtime correctness fixes discovered during hardening

- `3c91fbc` `fix: write repair-layer triage artifacts under target root`
- `75b1f76` `fix: write repair-layer reports under target root`
- `03b8511` `fix: avoid false positives in db-only readiness scan`
- `e0b9f8e` `test: align repair block hook expectations`
- `5f1915e` `fix: harden runtime path cleanup`
- `19d87c5` `test: cover runtime path cleanup`

## Suggested squash strategy

If a shorter merge history is preferred, a defensible squash strategy is:

1. Keep Group 1 as one docs commit.
2. Keep Groups 2 and 3 as one feature commit plus one test/docs follow-up commit.
3. Keep Group 4 as one tooling-hardening commit.
4. Keep Group 5 as one runtime-fixes commit plus one verifier commit.

If atomic traceability is preferred, keep the branch as-is.
