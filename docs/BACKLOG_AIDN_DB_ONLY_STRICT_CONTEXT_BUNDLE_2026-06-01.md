# Backlog AIDN - `db-only` strict, backend canonique et bundle Codex budgete

Date: 2026-06-01

## P0 - Contrat strict et securite migration

### P0-01 - Ecrire le plan et le backlog dates

Priorite: P0

Surfaces:

- `docs/PLAN_AIDN_DB_ONLY_STRICT_CONTEXT_BUNDLE_2026-06-01.md`
- `docs/BACKLOG_AIDN_DB_ONLY_STRICT_CONTEXT_BUNDLE_2026-06-01.md`

Criteres d'acceptation:

- le contrat cible est documente;
- la separation backend/mode d'etat est explicite;
- le backup externe et la quarantaine externe sont decrits;
- `gowire` est positionne comme lot separe.

Gates cibles:

- review documentaire;
- `git diff --check`.

### P0-02 - Formaliser `db-only` strict dans docs, ADR et matrice runtime

Priorite: P0

Surfaces:

- `docs/INSTALL.md`
- `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/ADR/ADR-0007-local-first-federation-boundary.md`
- `src/core/source-of-truth/source-of-truth-policy.mjs`

Criteres d'acceptation:

- `db-only` est defini comme mode strict sans ecriture visible detaillee automatique, mais avec bootstrap workflow et ancres minimales proteges;
- PostgreSQL est canonique quand configure;
- SQLite est limite au fallback local cache ou a la migration explicite;
- les projections visibles runtime/state detaillees sont decrites comme exports/materialisations;
- `CURRENT-STATE.md`, `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, snapshot et baseline sont decrits comme ancres minimales protegees;
- les assets scaffold workflow sont explicitement proteges contre le cleanup strict.

Gates cibles:

- `npm run perf:verify-source-of-truth-policy`
- `npm run perf:verify-shared-surface-boundary`

### P0-03 - Ajuster `install` pour stopper les ecritures visibles automatiques

Priorite: P0

Surfaces:

- `tools/install.mjs`
- `src/application/install/install-use-case.mjs`
- `packs/core/manifest.yaml`
- fixtures install.

Criteres d'acceptation:

- en `db-only` strict, `aidn install` copie/rend le bootstrap workflow et les ancres minimales (`CURRENT-STATE.md`, `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, snapshot, baseline);
- en `db-only` strict, `aidn install` ne copie/rend pas automatiquement les materialisations runtime/state detaillees (sessions/cycles historiques, coordination, agent health summaries);
- les assets de bootstrap workflow (`AGENTS.md`, `.codex`, `SPEC.md`, `WORKFLOW.md`, `WORKFLOW-KERNEL.md`, `WORKFLOW_SUMMARY.md`, `CODEX_ONLINE.md`) sont proteges et ne sont pas des candidats de cleanup;
- `--materialize-visible-artifacts` active explicitement l'ancien comportement visible;
- `--json` ou `--verify` seuls ne mutent jamais le checkout.

Gates cibles:

- `npm run perf:verify-install-import`
- `npm run perf:verify-cli-no-implicit-write`
- `npm run perf:verify-db-only-strict-context-bundle`

### P0-04 - Ajuster `install --verify`

Priorite: P0

Surfaces:

- `src/application/install/install-use-case.mjs`
- contrats de statut runtime si necessaire.

Criteres d'acceptation:

- en `db-only` strict, la verification n'exige pas les artefacts visibles;
- la verification exige les surfaces cachees minimales sous `.aidn/`;
- le backend canonique et le project context sont diagnostiques.

Gates cibles:

- `npm run perf:verify-db-only-strict-context-bundle`
- `npm run perf:verify-db-runtime-cli-fixtures`

### P0-05 - Ajouter backup externe, dry-run cleanup et quarantaine externe

Priorite: P0

Surfaces:

- `src/application/runtime/visible-artifacts-cleanup-service.mjs`
- `tools/runtime/visible-artifacts-cleanup.mjs`
- `bin/aidn.mjs`
- contrats JSON.

Criteres d'acceptation:

- le dry-run liste backup, quarantaine, candidats, proteges, inconnus et deja conformes;
- `--write` cree d'abord le backup externe;
- les materialisations runtime/state visibles gerees sont deplacees en quarantaine externe;
- les assets scaffold workflow et les ancres minimales de rechargement sont listes comme proteges et restent en place;
- la session active et le cycle actif references par `CURRENT-STATE.md` restent proteges;
- aucune suppression directe n'est faite;
- la destination par defaut est `<parent-du-projet>/.aidn-backups/<project_id>/<timestamp>/`.

Gates cibles:

- `npm run perf:verify-db-only-strict-context-bundle`
- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-output-contracts`

### P0-06 - Ajouter restauration depuis backup/quarantaine

Priorite: P0

Surfaces:

- `src/application/runtime/visible-artifacts-cleanup-service.mjs`
- `tools/runtime/visible-artifacts-restore.mjs`
- `bin/aidn.mjs`
- contrats JSON.

Criteres d'acceptation:

- le dry-run de restauration ne mute pas;
- `--write` restaure depuis `quarantine/` si disponible, sinon `original/`;
- les chemins restaures restent bornes au projet cible.

Gates cibles:

- `npm run perf:verify-db-only-strict-context-bundle`
- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-output-contracts`

### P0-07 - Enforcer PostgreSQL comme chemin canonique quand configure

Priorite: P0

Surfaces:

- `src/application/install/project-config-service.mjs`
- runtime persistence services;
- docs migration PostgreSQL.

Criteres d'acceptation:

- `runtime.persistence.backend=postgres` implique `localProjectionPolicy=none` par defaut si aucune politique explicite n'existe;
- le chemin normal ne depend pas de SQLite;
- SQLite + PostgreSQL est reserve a migration/compatibilite/diagnostic explicite.

Gates cibles:

- `npm run perf:verify-shared-state-backend`
- `npm run perf:verify-postgres-runtime-persistence-live-smoke` si environnement disponible.

## P1 - Bundle Codex cache et lecture ciblee

### P1-01 - Ajouter bundle cache budgete

Priorite: P1

Surfaces:

- `tools/codex/hydrate-context.mjs`
- `src/application/codex/hydrate-context-use-case.mjs`
- `src/core/contracts/cli-output/codex-hydrate-context.v1.schema.json`

Criteres d'acceptation:

- le bundle reste sous budget cible quand possible;
- le plafond dur n'est jamais depasse;
- les artefacts ont un tier `active|continuity|history`;
- `history` reste en metadonnees seules par defaut;
- le bundle expose les compteurs de budget et la source canonique.

Gates cibles:

- `npm run perf:verify-hydrate-context-runtime-state`
- `npm run perf:verify-db-only-strict-context-bundle`
- `npm run perf:verify-cli-output-contracts`

### P1-02 - Ajouter fetch cible depuis la BDD

Priorite: P1

Surfaces:

- `tools/runtime/artifact-fetch.mjs`
- `bin/aidn.mjs`
- contrats JSON runtime.

Criteres d'acceptation:

- lecture par `artifact_id`, `path`, `session_id` ou `cycle_id`;
- aucun fichier visible n'est materialise;
- la sortie indique backend, scope et digest source;
- fonctionne pour SQLite cache et PostgreSQL configure.

Gates cibles:

- `npm run perf:verify-db-only-strict-context-bundle`
- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-output-contracts`

### P1-03 - Durcir contrats JSON et fixtures

Priorite: P1

Surfaces:

- `src/core/contracts/cli-output/`
- `tools/perf/verify-*-fixtures.mjs`

Criteres d'acceptation:

- les contrats couvrent budget, selection, source-of-truth, cleanup et restore;
- les fixtures prouvent que les previews ne mutent pas.

Gates cibles:

- `npm run perf:verify-cli-output-contracts`
- `npm run perf:verify-cli-effect-policy`
- `npm run perf:verify-cli-no-implicit-write`

### P1-04 - Mettre a jour skills/scaffold

Priorite: P1

Surfaces:

- `scaffold/codex/**`
- `scaffold/root/AGENTS.md`
- docs agents.

Criteres d'acceptation:

- les skills ne supposent plus `docs/audit/*` disponible en `db-only` strict;
- les projections visibles sont explicitement demandees si necessaires.

Gates cibles:

- `npm run perf:verify-codex-db-only-skill-readiness`
- `npm run perf:verify-skill-hooks`

## P2 - Application pilote Gowire

### P2-01 - Migrer `gowire` apres validation AIDN

Priorite: P2

Surfaces:

- `G:\projets\gowire` en repo installe;
- BDD PostgreSQL AIDN de `gowire`;
- backup externe `G:\projets\.aidn-backups\gowire\<timestamp>\`.

Criteres d'acceptation:

- dry-run migration/cleanup complet;
- backup externe cree avant quarantaine;
- project context PostgreSQL valide;
- aucune creation de doublons apres reinstallation/import/adoption;
- anciens scopes path-based conserves comme alias de migration jusqu'a verification.

Gates cibles:

- `aidn runtime persistence-status --target G:\projets\gowire --json`
- `aidn install --target G:\projets\gowire --pack core --dry-run --no-codex-migrate-custom`
- `aidn install --target G:\projets\gowire --pack core --verify`
- diagnostics SQL doublons runtime et shared.
