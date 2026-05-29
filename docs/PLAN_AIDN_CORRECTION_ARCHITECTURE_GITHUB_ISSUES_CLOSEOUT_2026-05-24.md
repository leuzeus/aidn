# Plan de closeout des issues GitHub AIDN

Date: 2026-05-24  
Status: closeout ready

## Résumé

Ce plan clôt le triage des issues GitHub encore ouvertes liées au lot de correction architecturale. La vérification locale du dépôt montre que les sujets `db-only-readiness`, `repair-layer`, `pre-write-admit`, `backup/restore/adopt/reanchor` et le découpage CI sont déjà couverts par le code, les docs et les gates existants.

Les issues GitHub étaient encore ouvertes au moment de la vérification, mais elles sont devenues `stale` par rapport à l'état actuel du dépôt. Le bon traitement n'est donc pas un nouveau lot d'implémentation, mais un closeout documenté et synchronisé.

## Décision

- `#24`, `#27`, `#28`, `#29` et `#33` sont déjà fermées sur GitHub et restent en trace historique.
- `#25`, `#26`, `#30`, `#31` et `#32` sont traitées comme closeout `stale`:
  - leur intention est déjà absorbée par le code, les docs ou les gates;
  - aucun changement applicatif n'est requis;
  - la résolution attendue est la fermeture GitHub avec un commentaire de synchronisation.

## Preuves

| Issue | État GitHub à la vérification | Évidence locale | Décision |
| --- | --- | --- | --- |
| `#25` `db-only-readiness` | ouverte | `src/core/cli/effect-policy.mjs`, `docs/CLI_SURFACE_INVENTORY.md`, `docs/ADR/ADR-0004-public-cli-json-contracts.md`, `npm run perf:verify-db-only-readiness` | closeout `stale` |
| `#26` `repair-layer` | ouverte | `docs/CLI_SURFACE_INVENTORY.md`, `package.json`, `tools/runtime/repair-layer.mjs`, `tools/perf/verify-repair-layer-*.mjs` | closeout `stale` |
| `#30` `pre-write-admit` | ouverte | `src/application/runtime/pre-write-admit-use-case.mjs`, `tools/runtime/pre-write-admit.mjs`, `npm run perf:verify-pre-write-admit` | closeout `stale` |
| `#31` backup/restore/adopt/reanchor | ouverte | `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`, `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`, `npm run perf:verify-shared-coordination-backup`, `npm run perf:verify-shared-coordination-restore`, `npm run perf:verify-shared-coordination-doctor` | closeout `stale` |
| `#32` séparation CI par intention | ouverte | `.github/workflows/architecture-gates.yml`, `.github/workflows/cli-contracts.yml`, `.github/workflows/runtime-mode.yml`, `.github/workflows/runtime-ops.yml`, `.github/workflows/shared-boundary.yml`, `.github/workflows/release.yml`, `.github/workflows/perf-kpi.yml` | closeout `stale` |

## Exécution

1. Conserver les artefacts datés comme trace.
2. Fermer les issues GitHub `#25`, `#26`, `#30`, `#31` et `#32` avec un commentaire renvoyant à ce closeout.
3. Ne pas créer de nouveau lot d'implémentation pour ces sujets.
4. Si un écart réapparaît plus tard, le rouvrir comme nouveau sibling daté plutôt que de réécrire cet artefact.

## Vérifications

Les preuves déjà exécutées et retenues pour ce closeout sont:

- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-surface-parity`
- `npm run perf:verify-pre-write-admit`
- `npm run perf:verify-db-only-readiness`
- `npm run perf:verify-shared-coordination-backup`
- `npm run perf:verify-shared-coordination-restore`
- `npm run perf:verify-shared-coordination-doctor`

## Hypothèses

- Le statut GitHub est la source de vérité pour l'ouverture ou la fermeture d'une issue.
- L'état du dépôt et les gates servent à décider si une issue ouverte est devenue `stale`.
- Le closeout vise la synchronisation et la traçabilité, pas une réimplémentation.

## Résultat

Les issues `#25`, `#26`, `#30`, `#31` et `#32` ont été fermées sur GitHub avec un commentaire de synchronisation après la vérification locale.
