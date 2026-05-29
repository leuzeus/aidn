# Rapport de validation post-backlog EA/IA

## 1. Résumé exécutif

La validation post-backlog confirme que la couche runtime, la gouvernance informationnelle et la frontière local-first sont maintenant cohérentes et exécutables sur `dev`.

Ce qui est maintenant corrigé:

- `project-runtime-state` et `project-handoff-packet` sont read-only par défaut, avec écriture et sync explicites;
- `source-of-truth-policy`, `metadata-policy`, `governance-completeness` et `governance-runtime-cli` passent;
- `CLI surface parity`, `no implicit write`, `CLI output contracts` et `shared surface boundary` passent;
- `state-mode parity`, `handoff packet` et `pre-write-admit` passent sur fixtures;
- `baseline` et `snapshot` sont explicitement subsumés dans le modèle informationnel;
- la CI branche bien les familles de gates d’architecture, de gouvernance, de runtime et de release.

Ce qui reste confirmé:

- le lot release/provenance a été fermé par un gate explicite et revalidé sur le checkout courant;
- `build-release` ignore maintenant les fixtures temporaires de `tests/fixtures/tmp-*`, ce qui évite qu’un état de travail de test pollue la release.

Ce qui est incertain:

- aucun gap architectural confirmé ne reste ouvert à ce stade;
- la seule prudence restante concerne l’exécution concurrente de plusieurs builds release sur le même checkout, qui n’a pas été retenue comme écart produit dans ce tour.

Ce qui est uniquement documentaire:

- certains noms de gates demandés dans le cadrage, comme `perf:verify-runtime-modes` et `perf:verify-golden-fixtures`, ne sont pas matérialisés comme scripts littéraux; leur couverture est distribuée dans des gates plus petits déjà présents, tandis que `perf:verify-release-provenance` est maintenant un gate explicite;
- c’est acceptable pour ce tour, mais le rapport le signale clairement pour éviter toute sur-lecture de la CI.

Ce qui bloque encore la maturité informationnelle:

- plus rien de bloquant dans ce lot après revalidation; la provenance de release est maintenant explicitement vérifiée par gate.

Verdict:

- AIDN est cohérent et exécutable pour le runtime et la gouvernance;
- il est durable sur la frontière local-first;
- la durabilité est maintenant complète sur la frontière runtime/governance/release validée ici.

## 2. Matrice des écarts

| ID | Écart | Statut | Preuve | Fichiers concernés | Risque architecture d’entreprise | Risque architecture de l’information | Priorité | Correction proposée | Test ou gate attendu |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | `project-runtime-state --json` écrivait encore implicitement | corrigé | `project-runtime-state` garde `--write` explicite; `perf:verify-cli-no-implicit-write` PASS | `tools/runtime/project-runtime-state.mjs`, `src/core/cli/effect-policy.mjs`, `src/core/contracts/cli-output/runtime-project-runtime-state.v1.schema.json` | mutation surprise du checkout | confusion entre projection et état canonique | P0 | aucune correction supplémentaire | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` |
| G2 | `project-handoff-packet --json` écrivait encore implicitement | corrigé | `project-handoff-packet` garde `--write` et `--sync-relay` explicites; `perf:verify-handoff-packet` et `perf:verify-cli-no-implicit-write` PASS | `tools/runtime/project-handoff-packet.mjs`, `src/core/cli/effect-policy.mjs`, `src/core/contracts/cli-output/runtime-project-handoff-packet.v1.schema.json` | confusion local/shared | sync implicite ou mutation surprise | P0 | aucune correction supplémentaire | `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts`, `perf:verify-governance-runtime-cli` |
| G3 | `source-of-truth-policy` et `metadata-policy` étaient incomplètes | corrigé | `perf:verify-source-of-truth-policy`, `perf:verify-metadata-policy` et `perf:verify-governance-completeness` PASS | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0003-source-of-truth-policy.md`, `docs/ADR/ADR-0006-information-model.md` | gouvernance inégale | concepts gouvernés sans owner clair | P0 | aucune correction supplémentaire | `perf:verify-source-of-truth-policy`, `perf:verify-metadata-policy`, `perf:verify-governance-completeness` |
| G4 | `baseline` et `snapshot` n’étaient pas clarifiés | corrigé | `governance-completeness` passe et le diagnostic marque `baseline` / `snapshot` comme `subsumed` | `src/core/governance/concept-coverage.mjs`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | confusion sur les artefacts locaux | faux modèle de primitive partagée | P1 | aucune correction supplémentaire | `perf:verify-governance-completeness`, `perf:verify-governance-runtime-cli` |
| G5 | Les contrats JSON critiques étaient incomplets | corrigé | `perf:verify-cli-output-contracts` PASS sur les cinq contrats critiques | `src/core/contracts/cli-output/*`, `tools/perf/verify-cli-output-contracts-fixtures.mjs` | intégrations fragiles | forme publique instable | P0 | aucune correction supplémentaire | `perf:verify-cli-output-contracts` |
| G6 | Les golden fixtures manquaient | corrigé | `perf:verify-cli-output-contracts`, `perf:verify-handoff-packet`, `perf:verify-state-mode-parity` et `perf:verify-pre-write-admit` PASS | `tools/perf/*fixtures.mjs`, `tests/fixtures/*` | régressions silencieuses | absence de référence stable | P0 | aucune correction supplémentaire | `perf:verify-cli-output-contracts`, `perf:verify-handoff-packet`, `perf:verify-state-mode-parity` |
| G7 | `CLI_SURFACE_INVENTORY` était seulement partiellement aligné | corrigé | `perf:verify-cli-surface-parity` PASS; `README.md`, l’inventaire, `bin/aidn.mjs` et la policy d’effet racontent la même CLI | `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs`, `bin/aidn.mjs` | divergence de surface publique | automatisation trompée | P0 | aucune correction supplémentaire | `perf:verify-cli-surface-parity`, `perf:verify-cli-effect-policy`, `perf:verify-cli-surface-inventory` |
| G8 | Les gates CI n’étaient pas branchés | corrigé | les workflows `architecture-gates.yml`, `cli-contracts.yml`, `governance.yml`, `runtime-mode.yml`, `shared-boundary.yml`, `security-baseline.yml`, `runtime-ops.yml`, `perf-kpi.yml` et `release.yml` référencent les scripts présents | `.github/workflows/*`, `package.json` | signal CI non lisible | divergence non détectée | P0 | aucune correction supplémentaire dans ce tour | `perf:verify-cli-surface-parity`, `perf:verify-governance-completeness`, `perf:verify-release-flow` |
| G9 | La frontière local-first/shared runtime n’était pas testée | corrigé | `perf:verify-shared-surface-boundary` PASS et les ADR 0007/0008 restent cohérentes avec les workflows | `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/ADR/ADR-0008-shared-coordination-ports.md`, `.github/workflows/shared-boundary.yml` | fuite de surface partagée | relocation implicite d’artefacts checkout-bound | P0 | aucune correction supplémentaire | `perf:verify-shared-surface-boundary`, `perf:verify-shared-runtime-locator`, `perf:verify-shared-runtime-path` |
| G10 | La release/provenance restait peu claire | corrigé | `perf:verify-release-provenance` et `perf:verify-release-flow` PASS; `build-release` régénère le zip, le manifeste et les checksums sans être perturbé par les fixtures temporaires | `VERSION`, `package.json`, `release/manifest.json`, `release/checksums.txt`, `tools/build-release.mjs`, `.github/workflows/release.yml` | support et audit de release fiables | provenance vérifiable sur le checkout courant | P1 | aucune correction supplémentaire | `perf:verify-release-provenance`, `perf:verify-release-flow` |

## 3. Validation des commandes CLI sensibles

| Commande | Classe d’effet attendue | Classe d’effet déclarée | Comportement observé | Fichiers modifiés ou non | Contrat JSON associé | Fixture associée | Gate CI associé | Statut | Correction requise |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `aidn runtime project-runtime-state --json` | `projector` | `projector` | lecture seule, aucune mutation checkout-bound | aucun | `runtime-project-runtime-state.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |
| `aidn runtime project-runtime-state --json --write` | `projector` avec écriture explicite | `projector` | écrit seulement si `--write` est fourni | `docs/audit/RUNTIME-STATE.md` seulement sur fixture | `runtime-project-runtime-state.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |
| `aidn runtime project-handoff-packet --json` | `projector` | `projector` | lecture seule, aucune mutation checkout-bound | aucun | `runtime-project-handoff-packet.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |
| `aidn runtime project-handoff-packet --json --write` | `projector` avec écriture explicite | `projector` | écrit seulement si `--write` est fourni | `docs/audit/HANDOFF-PACKET.md` seulement sur fixture | `runtime-project-handoff-packet.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |
| `aidn runtime project-handoff-packet --json --sync-relay` | `projector` avec sync shared explicite | `projector` | la sync reste inactive sans backend partagé et ne modifie rien sur la fixture | aucun | `runtime-project-handoff-packet.v1.schema.json` | `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write`, `perf:verify-governance-runtime-cli` | conforme | aucune |
| `aidn runtime governance-diagnostics --json` | `read-only` | `read-only` | n’écrit rien et expose la couverture résiduelle | aucun | `runtime-governance-diagnostics.v1.schema.json` | `verify-governance-diagnostics-use-case-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-output-contracts`, `perf:verify-governance-runtime-cli` | conforme | aucune |
| `aidn runtime pre-write-admit --json` | `read-only` | `read-only` | admission sans mutation | aucun | `runtime-pre-write-admit.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |
| `aidn runtime handoff-admit --json` | `read-only` | `read-only` | admission sans mutation | aucun | `runtime-handoff-admit.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | aucune |

## 4. Validation des politiques Source of Truth et Metadata

| Concept | Source de vérité en mode files | Source de vérité en mode dual | Source de vérité en mode db-only | Métadonnées obligatoires | lifecycle_status | Contrat JSON associé | Diagnostic associé | Statut |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `project` | `.aidn/project/workflow.adapter.json` | idem | idem | `project_id`, `owner`, `source_of_truth`, `updated_at`, `lifecycle_status` | `draft -> active -> archived` | N/A | `governance-diagnostics` | complet |
| `workspace` | Git + workspace resolver | Git + resolver + contexte local | idem | `workspace_id`, `worktree_id`, `source_of_truth`, `updated_at`, `lifecycle_status` | `discovered -> active -> archived` | N/A | `governance-diagnostics` | complet |
| `worktree` | subsumé via workspace identity | subsumé via workspace identity | subsumé via workspace identity | `workspace_id`, `worktree_id`, locator explicite si shared | `discovered -> active -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `session` | `docs/audit/sessions/S*.md` | DB/index canonical + projection Markdown | DB canonical + projection Markdown | `session_id`, `contract_version`, `owner`, `state`, `updated_at`, `source_of_truth`, `lifecycle_status` | `draft -> active -> closing -> closed -> archived` | `runtime-project-runtime-state` indirect | `governance-diagnostics` | complet |
| `cycle` | `docs/audit/cycles/*/status.md` | DB/index canonical + projection Markdown | DB canonical + projection Markdown | `cycle_id`, `contract_version`, `owner`, `state`, `branch_name`, `dor_state`, `updated_at`, `source_of_truth`, `lifecycle_status` | `open -> implementing -> verifying -> done -> promoted|archived` | N/A | `governance-diagnostics` | complet |
| `artifact` | checkout scan de `docs/audit/*` | runtime artifact store | runtime artifact store | `id`, `type`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status`, `sha256`, `scope` | `draft -> active -> verified -> promoted|archived -> superseded` | N/A | `governance-diagnostics` | complet |
| `current_state` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `runtime_state_mode`, `active_session`, `active_cycle`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-runtime-state` | `governance-diagnostics` | complet |
| `runtime_state` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `runtime_state_mode`, `repair_layer_status`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-runtime-state` | `governance-diagnostics` | complet |
| `handoff_packet` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `handoff_status`, `active_session`, `active_cycle`, `source_of_truth`, `source_mode`, `lifecycle_status` | `draft -> ready -> consumed -> archived` | `runtime-project-handoff-packet` | `governance-diagnostics` | complet |
| `handoff_relay` | payload partagé explicitement configuré | payload partagé explicitement configuré | idem | métadonnées de projection seulement | `draft -> ready -> consumed -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `decision` | coordination record family | coordination_records + projection Markdown | coordination_records + projection Markdown | `decision_id`, `type`, `owner`, `decided_at`, `source_of_truth`, `lifecycle_status` | `proposed -> accepted|rejected -> superseded` | N/A | `governance-diagnostics` | complet |
| `incident` | incident Markdown / repair findings | repair findings + projection | repair findings + projection | `incident_id`, `severity`, `owner`, `status`, `created_at`, `updated_at`, `source_of_truth`, `lifecycle_status` | `opened -> triaged -> mitigated -> closed -> archived` | N/A | `governance-diagnostics` | complet |
| `coordination_record` | `docs/audit/COORDINATION-*` / runtime context | runtime context ou backend partagé explicite | runtime context ou backend partagé explicite | `record_id`, `agent_id`, `action`, `status`, `created_at`, `source_of_truth`, `lifecycle_status` | `created -> processed -> archived` | N/A | `governance-diagnostics` | complet |
| `coordination_summary` | `docs/audit/COORDINATION-SUMMARY.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `history_status`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-coordination-summary` | `governance-diagnostics` | complet |
| `coordination_log` | `docs/audit/COORDINATION-LOG.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | N/A | `governance-diagnostics` | complet |
| `user_arbitration` | `docs/audit/USER-ARBITRATION.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-coordinator-record-arbitration` related | `governance-diagnostics` | complet |
| `repair_finding` | local scan/report | repair-layer runtime tables | repair-layer runtime tables | `finding_id`, `finding_type`, `severity`, `status`, `source_of_truth`, `updated_at`, `lifecycle_status` | `open -> triaged -> resolved|waived -> archived` | N/A | `governance-diagnostics` | complet |
| `repair_decision` | subsumé via repair findings et coordination records | idem | idem | métadonnées repair-layer uniquement | `open -> triaged -> resolved|waived -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `baseline` | `docs/audit/baseline/current.md` + `history.md` | local snapshot store + projection | local snapshot store + projection | famille local-first subsumée; pas de policy metadata core dédiée | family lifecycle local | N/A | `governance-diagnostics` | subsumed |
| `snapshot` | `docs/audit/snapshots/context-snapshot.md` | local snapshot store + projection | local snapshot store + projection | famille local-first subsumée; pas de policy metadata core dédiée | point-in-time projection lifecycle | N/A | `governance-diagnostics` | subsumed |
| `migration_run` | télémétrie de migration locale | télémétrie de migration locale | télémétrie de migration locale | non gouverné par la policy metadata core | `recorded -> superseded -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |
| `gate_result` | télémétrie CI/workflow | télémétrie CI/workflow | télémétrie CI/workflow | non gouverné par la policy metadata core | `recorded -> superseded -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |
| `reference_data` | fixture corpus / local-only pilot corpus | fixture corpus / local-only pilot corpus | fixture corpus / local-only pilot corpus | metadata de fixture seulement | `seeded -> refreshed -> superseded` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |

## 5. Validation baseline et snapshot

Décisions tranchées:

- baseline est un concept autonome? non;
- snapshot est un concept autonome? non;
- source de vérité propre? oui, mais seulement comme famille d’artefacts local-first;
- cycle de vie propre? oui, au niveau de la famille;
- couvert par `metadata-policy`? pas comme primitive core séparée;
- couvert par `source-of-truth-policy`? oui, comme artefacts local-first subsumés;
- couvert par `governance-diagnostics`? oui, via `coverage_kind=subsumed`.

Conclusion:

- baseline et snapshot doivent rester documentés comme familles locales subsumées;
- ils ne doivent pas être promus en primitives partagées;
- cette décision est déjà cohérente avec ADR-0006, la source-of-truth policy et le diagnostic de gouvernance.

## 6. Validation des contrats JSON critiques

| Contrat | Statut | Ce qui est vérifié | Lecture sur les champs demandés | Keep / Extend / V2 | Fixture / gate |
| --- | --- | --- | --- | --- | --- |
| `runtime-project-runtime-state` | conforme | `perf:verify-cli-output-contracts` PASS | `contract_version` et `command` vivent dans les métadonnées de schéma; `write`, `written`, `target_root`, `runtime_state_mode`, `source_of_truth`, `source_mode`, `lifecycle_status` sont exposés; `errors`/`warnings` sont portés par les blocs de validation et de gouvernance | conserver v1 | `verify-cli-output-contracts-fixtures.mjs`, `perf:verify-cli-output-contracts` |
| `runtime-project-handoff-packet` | conforme | `perf:verify-cli-output-contracts` PASS | `contract_version` et `command` vivent dans les métadonnées de schéma; `write`, `written`, `sync_relay`, `shared_coordination_sync`, `target_root`, `runtime_state_mode`, `source_of_truth`, `source_mode`, `lifecycle_status` sont exposés; `warnings` et `issues` couvrent les diagnostics | conserver v1 | `verify-cli-output-contracts-fixtures.mjs`, `perf:verify-cli-output-contracts` |
| `runtime-pre-write-admit` | conforme | `perf:verify-cli-output-contracts` PASS | `warnings`, `blocking_reasons`, `source_of_truth` et les checks portent l’essentiel du contrat; le schéma reste volontairement v1 et tolérant | conserver v1 | `verify-cli-output-contracts-fixtures.mjs`, `perf:verify-cli-output-contracts` |
| `runtime-handoff-admit` | conforme | `perf:verify-cli-output-contracts` PASS | `warnings`, `issues`, `route`, `workspace`, `packet` et `source_of_truth` couvrent l’admission; pas de besoin v2 à ce stade | conserver v1 | `verify-cli-output-contracts-fixtures.mjs`, `perf:verify-cli-output-contracts` |
| `runtime-governance-diagnostics` | conforme | `perf:verify-cli-output-contracts` PASS, `perf:verify-governance-runtime-cli` PASS | le contrat expose la couverture résiduelle sans reclasser les concepts exclus; `errors` n’est pas un champ littéral car le contrat emploie `issues` et `operations` | conserver v1 | `verify-governance-diagnostics-use-case-fixtures.mjs`, `perf:verify-governance-runtime-cli` |

Conclusion:

- les cinq contrats critiques restent en v1;
- une v2 n’est pas justifiée par les preuves de cette session;
- si un consommateur a besoin de champs plus normalisés comme `write_targets` ou `errors`, ce serait un lot de migration séparé, pas un blocage actuel.
- les noms génériques demandés dans le cadrage ne sont pas tous des champs littéraux top-level; plusieurs sont déjà portés par les métadonnées de schéma ou par des blocs de validation spécialisés, et cette représentation reste compatible avec v1.

## 7. Validation CI et gates

| Gate attendu | Script npm associé | Outil associé | Workflow CI associé | Statut | Écart | Correction proposée |
| --- | --- | --- | --- | --- | --- | --- | --- |
| verify CLI surface inventory | `npm run perf:verify-cli-surface-inventory` | `tools/perf/verify-cli-surface-inventory.mjs` | `architecture-gates.yml`, `cli-contracts.yml` | conforme | aucun | aucune |
| verify CLI effect policy | `npm run perf:verify-cli-effect-policy` | `tools/perf/verify-cli-effect-policy.mjs` | `architecture-gates.yml`, `cli-contracts.yml` | conforme | aucun | aucune |
| verify no implicit write | `npm run perf:verify-cli-no-implicit-write` | `tools/perf/verify-cli-no-implicit-write-fixtures.mjs` | `architecture-gates.yml`, `security-baseline.yml`, `cli-contracts.yml` | conforme | aucun | aucune |
| verify CLI output contracts | `npm run perf:verify-cli-output-contracts` | `tools/perf/verify-cli-output-contracts-fixtures.mjs` | `architecture-gates.yml`, `cli-contracts.yml` | conforme | aucun | aucune |
| verify golden fixtures | `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-governance-completeness`, `npm run perf:verify-markdown-contract` | `tools/perf/*fixtures.mjs` | `governance.yml`, `cli-contracts.yml`, `architecture-gates.yml` | documentaire / couvert par équivalents | pas de script consolidé littéral | garder la couverture distribuée ou ajouter un wrapper plus tard |
| verify metadata policy | `npm run perf:verify-metadata-policy` | `tools/perf/verify-metadata-policy.mjs` | `architecture-gates.yml`, `governance.yml` | conforme | aucun | aucune |
| verify source-of-truth policy | `npm run perf:verify-source-of-truth-policy` | `tools/perf/verify-source-of-truth-policy.mjs` | `architecture-gates.yml`, `governance.yml` | conforme | aucun | aucune |
| verify governance completeness | `npm run perf:verify-governance-completeness` | `tools/perf/verify-governance-completeness.mjs` | `architecture-gates.yml`, `governance.yml` | conforme | aucun | aucune |
| verify governance runtime CLI | `npm run perf:verify-governance-runtime-cli` | `tools/perf/verify-governance-runtime-cli-fixtures.mjs` | `governance.yml`, `runtime-ops.yml` | conforme | aucun | aucune |
| verify shared surface boundary | `npm run perf:verify-shared-surface-boundary` | `tools/perf/verify-shared-surface-boundary.mjs` | `architecture-gates.yml`, `shared-boundary.yml` | conforme | aucun | aucune |
| verify runtime modes files/dual/db-only | `npm run perf:verify-state-mode-parity`, `npm run perf:verify-db-only-readiness` | `tools/perf/verify-state-mode-parity-fixtures.mjs`, `tools/perf/verify-db-only-readiness-fixtures.mjs` | `architecture-gates.yml`, `runtime-mode.yml` | documentaire / couvert par équivalents | pas de script consolidé littéral | garder la couverture distribuée |
| verify release version | `npm run perf:verify-release-version` | `tools/perf/verify-release-version.mjs` | `architecture-gates.yml`, `release.yml` | conforme | aucun | aucune |
| verify release provenance | `npm run perf:verify-release-provenance` | `tools/build-release.mjs`, `tools/perf/verify-release-artifacts.mjs` | `architecture-gates.yml`, `release.yml` | conforme | aucun | aucune |
| verify release flow | `npm run perf:verify-release-flow` | `npm run perf:verify-release-provenance` | `architecture-gates.yml`, `release.yml` | conforme | aucun | aucune |
| verify checksums | `npm run perf:verify-release-artifacts` | `tools/perf/verify-release-artifacts.mjs` | `architecture-gates.yml`, `release.yml` | conforme | aucun | aucune |
| verify backup/restore smoke test | `npm run perf:verify-shared-coordination-backup`, `npm run perf:verify-shared-coordination-restore`, `npm run perf:verify-shared-coordination-doctor` | `tools/perf/verify-shared-coordination-*-fixtures.mjs` | `architecture-gates.yml`, `runtime-ops.yml` | conforme | aucun | aucune |

## 8. Backlog réduit

Le backlog confirmé restant est nul.

La correction du lot release/provenance a été appliquée et revalidée dans ce tour.

## 9. Conclusion

AIDN est maintenant cohérent et exécutable sur les surfaces runtime, de gouvernance et de frontière local-first.

Il ne reste plus de zone ouverte dans le périmètre validé ici.

En l’état:

- runtime: cohérent;
- gouvernance informationnelle: cohérente;
- CI: branchée;
- release/provenance: cohérente et vérifiée.
