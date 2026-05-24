# Rapport de validation post-backlog EA/IA

## 1. Résumé exécutif

La validation post-backlog confirme que le cœur de la plateforme AIDN est maintenant cohérent, exécutable et durable dans sa frontière local-first actuelle.

Ce qui est corrigé ou confirmé comme stable :

- la surface CLI publique, les policies d’effet et les contrats JSON restent alignés ;
- `--json` ne provoque aucune mutation implicite ;
- les écritures de projection restent explicites avec `--write` ;
- la synchronisation shared reste explicite avec `--sync-relay` ;
- les policies `source-of-truth` et `metadata` restent cohérentes avec les ADR ;
- le diagnostic de gouvernance expose maintenant explicitement la couverture résiduelle ;
- la provenance de release est de nouveau vérifiée après régénération du zip et des checksums.

Ce qui restait incertain avant cette passe et qui est maintenant rendu explicite :

- `worktree`, `handoff_relay` et `repair_decision` sont documentés comme concepts subsumés ;
- `migration_run`, `gate_result` et `reference_data` sont documentés comme concepts exclus du modèle de gouvernance core ;
- le diagnostic `governance-diagnostics` expose désormais `coverage_exceptions` et `coverage_exception_summary` ;
- `release/checksums.txt` a été réaligné avec le zip de release courant.

Écarts confirmés par le code avant correction :

- la couverture résiduelle n’était pas exposée comme tableau distinct dans le diagnostic de gouvernance ;
- la provenance de release ne passait pas tant que le zip courant n’était pas régénéré.

Écarts purement documentaires :

- les ADR et les README de contrats avaient déjà le bon périmètre global, mais pas la classification explicite des concepts résiduels ;
- le contrat `runtime-governance-diagnostics` était valide, mais il ne rendait pas encore visible la couverture résiduelle.

Écarts qui bloquaient la maturité informationnelle :

- la couverture résiduelle n’était pas visible de façon machine-lisible ;
- la provenance de release pouvait diverger du zip courant si les checksums n’étaient pas régénérés.

Conclusion :

- l’architecture est maintenant cohérente et exécutable pour les surfaces gouvernées ;
- les concepts résiduels sont explicitement classés, donc ils ne masquent plus un trou de modèle ;
- la durabilité est bonne tant que la frontière local-first reste respectée et que la release est régénérée après changement du contenu embarqué.

## 2. Matrice de validation

| Domaine | Élément attendu | Fichier source de la règle | Fichier ou commande vérifiée | Statut | Preuve observée | Correction requise | Priorité |
|---|---|---|---|---|---|---|---|
| 1. Parité documentation / CLI / effect-policy / scripts runtime | La surface publique, les alias, les commandes stables et les effect policies doivent décrire la même CLI | `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs`, `bin/aidn.mjs` | `npm run perf:verify-cli-surface-parity`, `npm run perf:verify-cli-surface-inventory`, `npm run perf:verify-cli-effect-policy` | conforme | Les trois gates passent ; la surface inventorie les commandes publiques et les classes d’effet attendues | Aucune | P2 |
| 2. Sémantique read-only / mutating / projector / executor | Les commandes doivent avoir la bonne classe d’effet déclarée | `src/core/cli/effect-policy.mjs`, `docs/ADR/ADR-0005-read-write-cli-semantics.md` | `npm run perf:verify-cli-no-implicit-write` | conforme | `project-runtime-state` et `project-handoff-packet` sont `projector`, `governance-diagnostics`, `pre-write-admit`, `handoff-admit` sont `read-only` | Aucune | P0 |
| 3. Absence d’écriture implicite | `--json` ne doit jamais muter le checkout ; `--write` et `--sync-relay` restent explicites | `src/core/cli/effect-policy.mjs`, `tools/runtime/*` | `npm run perf:verify-cli-no-implicit-write`, commandes directes sur fixture | conforme | `--json` ne modifie rien ; `--write` écrit seulement quand il est explicite ; `--sync-relay` reste inactif sans backend partagé | Aucune | P0 |
| 4. Contrats JSON publics | Les sorties JSON critiques doivent être contractées et vérifiées par schéma | `src/core/contracts/cli-output/*`, `docs/ADR/ADR-0004-public-cli-json-contracts.md` | `npm run perf:verify-cli-output-contracts` | conforme | Le gate passe pour tous les contrats critiques, dont `runtime-governance-diagnostics` | Aucune | P1 |
| 5. Golden fixtures | Les comportements clés doivent rester stables sur fixture | `tools/perf/*fixtures.mjs` | `node tools/perf/verify-governance-diagnostics-use-case-fixtures.mjs`, `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-markdown-contract` | conforme | Les fixtures passent et valident le diagnostic, les contrats JSON et les projections Markdown | Aucune | P1 |
| 6. Source-of-truth policy | Les concepts gouvernés doivent avoir une source de vérité explicite par mode | `src/core/source-of-truth/source-of-truth-policy.mjs`, `docs/ADR/ADR-0003-source-of-truth-policy.md` | `npm run perf:verify-source-of-truth-policy` | conforme | 19 policies, `files/dual/db-only` cohérents ; les concepts résiduels sont documentés séparément | Aucune | P0 |
| 7. Metadata policy | Les champs obligatoires et cycles de vie doivent être cohérents avec le modèle | `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | `npm run perf:verify-metadata-policy` | conforme | 16 policies, cycles de vie et champs requis validés ; le modèle résiduel n’est pas promu comme metadata core | Aucune | P0 |
| 8. Statut informationnel de baseline et snapshot | Baseline et snapshot doivent être explicitement subsumés et non traités comme primitives partagées | `docs/ADR/ADR-0006-information-model.md`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs` | `node tools/perf/verify-governance-diagnostics-use-case-fixtures.mjs`, `npm run perf:verify-governance-completeness` | conforme | `baseline` et `snapshot` restent classés `subsumed` et local-first | Aucune | P1 |
| 9. Séparation lecture / projection locale / sync shared | La lecture simple, la projection locale et la synchronisation shared doivent rester séparées | `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/ADR/ADR-0008-shared-coordination-ports.md`, `src/core/cli/effect-policy.mjs` | `aidn runtime project-runtime-state --json`, `aidn runtime project-handoff-packet --json --sync-relay` via fixture | conforme | Les projections écrivent seulement avec intention explicite ; la sync shared reste opt-in | Aucune | P0 |
| 10. Governance diagnostics | Le diagnostic doit exposer les trous restants au lieu de les masquer | `src/application/runtime/governance-diagnostics-use-case.mjs`, `tools/runtime/governance-diagnostics.mjs`, `src/core/contracts/cli-output/runtime-governance-diagnostics.v1.schema.json` | `node tools/perf/verify-governance-diagnostics-use-case-fixtures.mjs`, `npm run perf:verify-governance-runtime-cli` | conforme | `coverage_exceptions` et `coverage_exception_summary` exposent 6 concepts résiduels ; le statut résiduel est `documented` | Aucune | P1 |
| 11. Gates CI | Les workflows doivent exécuter les gates alignés avec les scripts npm | `.github/workflows/*.yml`, `package.json` | `npm run perf:verify-cli-surface-parity`, `npm run perf:verify-cli-output-contracts`, `npm run perf:verify-governance-completeness`, `npm run perf:verify-release-flow` | conforme | Les workflows référencent les scripts présents et les gates passent après réalignement | Aucune | P0 |
| 12. Frontière local-first / shared runtime | Les artefacts checkout-bound ne doivent pas être déplacés implicitement | `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md` | `npm run perf:verify-shared-surface-boundary`, `npm run perf:verify-shared-runtime-locator` | conforme | Les surfaces partagées restent limitées aux métadonnées de coordination explicitement opt-in | Aucune | P0 |
| 13. Release / provenance | Version, zip, checksums et flow de release doivent être cohérents | `VERSION`, `package.json`, `tools/build-release.mjs`, `release/checksums.txt`, `.github/workflows/release.yml` | `npm run perf:verify-release-version`, `npm run perf:verify-release-artifacts`, `npm run perf:verify-release-flow` | conforme | Le zip a été régénéré, `release/checksums.txt` réaligné, puis le flow complet est repassé vert | Aucune | P1 |

## 3. Tests exécutables à lancer

Vérifications lancées pendant cette passe :

| Commande | Résultat | Observations |
|---|---|---|
| `npm run perf:verify-cli-surface-parity` | PASS | Surface CLI stable et cohérente |
| `npm run perf:verify-cli-no-implicit-write` | PASS | Aucune écriture implicite |
| `npm run perf:verify-cli-output-contracts` | PASS | Tous les contrats JSON critiques passent |
| `npm run perf:verify-cli-effect-policy` | PASS | 51 policies vérifiées |
| `npm run perf:verify-cli-surface-inventory` | PASS | La surface inventoriée reste alignée |
| `npm run perf:verify-shared-surface-boundary` | PASS | Frontière shared/local-first intacte |
| `npm run perf:verify-source-of-truth-policy` | PASS | 19 policies source-of-truth |
| `npm run perf:verify-metadata-policy` | PASS | 16 policies metadata |
| `npm run perf:verify-governance-completeness` | PASS | `20/20` concepts gouvernés complets |
| `node tools/perf/verify-governance-diagnostics-use-case-fixtures.mjs` | PASS | `coverage_exceptions` et statut résiduel validés |
| `npm run perf:verify-governance-runtime-cli` | PASS | Le CLI runtime expose le même diagnostic que le use case |
| `npm run perf:verify-markdown-contract` | PASS | Les contrats Markdown restent conformes |
| `npm run perf:verify-pack-topology` | PASS | Le pack topology reste valide |
| `npm run perf:verify-shared-coordination-backup` | PASS | Smoke test backup partagé |
| `npm run perf:verify-shared-coordination-restore` | PASS | Smoke test restore partagé |
| `npm run perf:verify-shared-coordination-doctor` | PASS | Smoke test doctor partagé |
| `npm run perf:verify-release-version` | PASS | VERSION et `package.json` alignés |
| `npm run perf:verify-release-artifacts` | PASS | Relancé après `build-release` |
| `npm run perf:verify-release-flow` | PASS | Flow complet vert après régénération du zip |

Note :

- `npm run perf:verify-release-artifacts` a d’abord échoué sur un checksum obsolète, puis a passé après `npm run build-release`.
- la vérification du release-flow a été conservée sur la version régénérée pour garantir que `release/checksums.txt` et le zip courant racontent la même histoire.

## 4. Validation des commandes CLI sensibles

| Commande | Classe d’effet attendue | Classe d’effet déclarée | Comportement observé | Fichiers modifiés ou non | Contrat JSON | Fixture golden | Gate CI | Statut | Correction requise |
|---|---|---|---|---|---|---|---|---|---|
| `aidn runtime project-runtime-state --json` | projector | projector | Lecture seule, aucune mutation checkout-bound | Aucun fichier modifié | `runtime-project-runtime-state.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |
| `aidn runtime project-runtime-state --json --write` | projector avec écriture explicite | projector | Écrit seulement quand `--write` est fourni | `docs/audit/RUNTIME-STATE.md` uniquement | `runtime-project-runtime-state.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |
| `aidn runtime project-handoff-packet --json` | projector | projector | Lecture seule, aucune mutation checkout-bound | Aucun fichier modifié | `runtime-project-handoff-packet.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |
| `aidn runtime project-handoff-packet --json --write` | projector avec écriture explicite | projector | Écrit seulement quand `--write` est fourni | `docs/audit/HANDOFF-PACKET.md` uniquement | `runtime-project-handoff-packet.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |
| `aidn runtime project-handoff-packet --json --sync-relay` | projector avec sync shared explicite | projector | Sur la fixture, la sync reste désactivée sans backend partagé et n’altère rien | Aucun fichier modifié sur la fixture | `runtime-project-handoff-packet.v1.schema.json` | `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write`, `perf:verify-governance-runtime-cli` | conforme | Aucune |
| `aidn runtime governance-diagnostics --json` | read-only | read-only | N’écrit rien ; expose `coverage_exceptions` et `coverage_exception_summary` | Aucun fichier modifié | `runtime-governance-diagnostics.v1.schema.json` | `verify-governance-diagnostics-use-case-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-output-contracts`, `perf:verify-governance-runtime-cli` | conforme | Aucune |
| `aidn runtime pre-write-admit --json` | read-only | read-only | Bloqué/rejeté sur la fixture sans mutation | Aucun fichier modifié | `runtime-pre-write-admit.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |
| `aidn runtime handoff-admit --json` | read-only | read-only | Rejeté sur la fixture sans mutation | Aucun fichier modifié | `runtime-handoff-admit.v1.schema.json` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` | conforme | Aucune |

## 5. Validation source-of-truth et métadonnées

| Concept | Source de vérité en mode files | Source de vérité en mode dual | Source de vérité en mode db-only | Métadonnées obligatoires | lifecycle_status | Contrat associé | Diagnostic associé | Statut |
|---|---|---|---|---|---|---|---|---|
| `project` | `.aidn/project/workflow.adapter.json` | idem | idem | `project_id`, `owner`, `source_of_truth`, `updated_at`, `lifecycle_status` | `draft -> active -> archived` | N/A | `governance-diagnostics` | complet |
| `workspace` | Git + workspace resolver | Git + resolver + contexte local | idem | `workspace_id`, `worktree_id`, `source_of_truth`, `updated_at`, `lifecycle_status` | `discovered -> active -> archived` | N/A | `governance-diagnostics` | complet |
| `session` | `docs/audit/sessions/S*.md` | DB/index canonical + projection Markdown | DB canonical + projection Markdown | `session_id`, `contract_version`, `owner`, `state`, `updated_at`, `source_of_truth`, `lifecycle_status` | `draft -> active -> closing -> closed -> archived` | `runtime-project-runtime-state` indirect | `governance-diagnostics` | complet |
| `cycle` | `docs/audit/cycles/*/status.md` | DB/index canonical + projection Markdown | DB canonical + projection Markdown | `cycle_id`, `contract_version`, `owner`, `state`, `branch_name`, `dor_state`, `updated_at`, `source_of_truth`, `lifecycle_status` | `open -> implementing -> verifying -> done -> promoted|archived` | N/A | `governance-diagnostics` | complet |
| `artifact` | checkout scan of `docs/audit/*` | runtime artifact store | runtime artifact store | `id`, `type`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status`, `sha256`, `scope` | `draft -> active -> verified -> promoted|archived -> superseded` | N/A | `governance-diagnostics` | complet |
| `decision` | coordination record family | coordination_records + Markdown projection | coordination_records + Markdown projection | `decision_id`, `type`, `owner`, `decided_at`, `source_of_truth`, `lifecycle_status` | `proposed -> accepted|rejected -> superseded` | N/A | `governance-diagnostics` | subsumed |
| `incident` | incident Markdown / repair findings | repair findings + projection | repair findings + projection | `incident_id`, `severity`, `owner`, `status`, `created_at`, `updated_at`, `source_of_truth`, `lifecycle_status` | `opened -> triaged -> mitigated -> closed -> archived` | N/A | `governance-diagnostics` | subsumed |
| `current_state` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `runtime_state_mode`, `active_session`, `active_cycle`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-runtime-state` related digest | `governance-diagnostics` | complet |
| `runtime_state` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `runtime_state_mode`, `repair_layer_status`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-runtime-state` | `governance-diagnostics` | complet |
| `handoff_packet` | runtime digest Markdown | runtime store + generated Markdown | runtime store + generated Markdown on demand | `contract_version`, `updated_at`, `handoff_status`, `active_session`, `active_cycle`, `source_of_truth`, `source_mode`, `lifecycle_status` | `draft -> ready -> consumed -> archived` | `runtime-project-handoff-packet` | `governance-diagnostics` | complet |
| `repair_finding` | local scan/report | repair-layer runtime tables | repair-layer runtime tables | `finding_id`, `finding_type`, `severity`, `status`, `source_of_truth`, `updated_at`, `lifecycle_status` | `open -> triaged -> resolved|waived -> archived` | N/A | `governance-diagnostics` | complet |
| `coordination_record` | `docs/audit/COORDINATION-*` / runtime context | runtime context or explicit shared backend | runtime context or explicit shared backend | `record_id`, `agent_id`, `action`, `status`, `created_at`, `source_of_truth`, `lifecycle_status` | `created -> processed -> archived` | N/A | `governance-diagnostics` | complet |
| `coordination_summary` | `docs/audit/COORDINATION-SUMMARY.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `history_status`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-project-coordination-summary` | `governance-diagnostics` | complet |
| `coordination_log` | `docs/audit/COORDINATION-LOG.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | N/A | `governance-diagnostics` | complet |
| `user_arbitration` | `docs/audit/USER-ARBITRATION.md` | coordination_records + projection | coordination_records + projection | `contract_version`, `updated_at`, `source_of_truth`, `source_mode`, `lifecycle_status` | `refreshed -> stale -> superseded` | `runtime-coordinator-record-arbitration` related | `governance-diagnostics` | complet |
| `baseline` | `docs/audit/baseline/current.md` + `history.md` | local snapshot store + projection | local snapshot store + projection | Subsumed local-first artifact family ; pas de policy metadata core dédiée | family lifecycle local | N/A | `governance-diagnostics` | subsumed |
| `snapshot` | `docs/audit/snapshots/context-snapshot.md` | local snapshot store + projection | local snapshot store + projection | Subsumed local-first artifact family ; pas de policy metadata core dédiée | point-in-time projection lifecycle | N/A | `governance-diagnostics` | subsumed |
| `worktree` | Git worktree + workspace identity | workspace/worktree registry metadata si explicitement configuré | idem | `workspace_id`, `worktree_id`, locator explicite si shared | `discovered -> active -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `handoff_relay` | shared coordination payloads explicitement configurés | shared coordination payloads explicitement configurés | idem | metadata de projection seulement | `draft -> ready -> consumed -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `repair_decision` | repair-layer / coordination records | repair-layer / coordination records | repair-layer / coordination records | metadata repair-layer uniquement | `open -> triaged -> resolved|waived -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | subsumed |
| `migration_run` | télémétrie de migration locale | télémétrie de migration locale | télémétrie de migration locale | non gouverné par la policy metadata core | `recorded -> superseded -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |
| `gate_result` | télémétrie CI/workflow | télémétrie CI/workflow | télémétrie CI/workflow | non gouverné par la policy metadata core | `recorded -> superseded -> archived` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |
| `reference_data` | fixture corpus / local-only pilot corpus | fixture corpus / local-only pilot corpus | fixture corpus / local-only pilot corpus | metadata de fixture seulement | `seeded -> refreshed -> superseded` | N/A | `governance-diagnostics` via `coverage_exceptions` | excluded |

## 6. Validation baseline et snapshot

Réponses explicites :

- baseline est un concept informationnel autonome ? Non.
- snapshot est un concept informationnel autonome ? Non.
- ont-ils une source de vérité propre ? Oui, mais en tant que famille d’artefacts local-first, pas comme primitive partagée.
- ont-ils un cycle de vie propre ? Oui, au niveau de la famille d’artefacts.
- sont-ils couverts par `metadata-policy` ? Pas comme concepts core séparés.
- sont-ils couverts par `source-of-truth-policy` ? Oui, comme artefacts local-first subsumés.
- sont-ils couverts par `governance-diagnostics` ? Oui, via `coverage_kind=subsumed`.

Correction simple et cohérente retenue :

- ne pas promouvoir baseline/snapshot au rang de primitives partagées ;
- les garder documentés comme familles local-first subsumées ;
- les exposer uniquement comme surfaces de projection et de diagnostic.

## 7. Validation des contrats JSON

| Contrat | Version | Commande associée | Champs obligatoires | Champs liés à la gouvernance / aux effets / aux écritures | Compatibilité v1/v2 | Fixture golden associée | Gate associé |
|---|---|---|---|---|---|---|---|
| `runtime-project-runtime-state` | `cli-output-v1` | `aidn runtime project-runtime-state --json` | `target_root`, `workspace`, `shared_state_backend`, `shared_runtime_validation`, `output_file`, `written`, `write`, `digest`, `consistency` | Gouvernance: `source_of_truth`, `source_mode`, `lifecycle_status` ; Écritures: `written`, `write` ; Effets: classé `projector` | v1 extensible via `additionalProperties` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-output-contracts`, `perf:verify-cli-no-implicit-write` |
| `runtime-project-handoff-packet` | `cli-output-v1` | `aidn runtime project-handoff-packet --json` | `target_root`, `workspace`, `shared_state_backend`, `shared_coordination_backend`, `shared_coordination_sync`, `shared_runtime_validation`, `output_file`, `written`, `write`, `sync_relay`, `packet`, `consistency` | Gouvernance: `source_of_truth`, `source_mode`, `lifecycle_status` ; Écritures: `written`, `write`, `sync_relay` ; Effets: classé `projector` | v1 extensible via `additionalProperties` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-output-contracts`, `perf:verify-cli-no-implicit-write` |
| `runtime-pre-write-admit` | `cli-output-v1` | `aidn runtime pre-write-admit --json` | `ok`, `admission_status`, `target_root`, `skill`, `policy`, `source_of_truth`, `context`, `checks`, `blocking_reasons`, `warnings`, `prioritized_artifacts` | Gouvernance: `source_of_truth` ; Effets: classé `read-only` ; Écritures: aucune | v1 extensible via `additionalProperties` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` |
| `runtime-handoff-admit` | `cli-output-v1` | `aidn runtime handoff-admit --json` | `target_root`, `packet_file`, `admission_status`, `admitted`, `recommended_action`, `recommended_next_agent_role`, `route`, `status`, `workspace`, `packet`, `issues`, `warnings`, `prioritized_artifacts` | Gouvernance: `status`, `packet`; Effets: classé `read-only` ; Écritures: aucune | v1 extensible via `additionalProperties` | `verify-cli-output-contracts-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-no-implicit-write` |
| `runtime-governance-diagnostics` | `cli-output-v1` | `aidn runtime governance-diagnostics --json` | `ts`, `target_root`, `ok`, `governed_concepts`, `summary`, `registry`, `concepts`, `runtime_surfaces`, `runtime_surface_summary`, `observed_artifacts`, `observed_artifact_summary`, `issues`, `operations` | Gouvernance: `summary`, `registry`, `operations` ; Effets: classé `read-only` ; Écritures: aucune ; Résiduels: `coverage_exceptions`, `coverage_exception_summary` | v1 extensible via `additionalProperties` | `verify-governance-diagnostics-use-case-fixtures.mjs`, `verify-governance-runtime-cli-fixtures.mjs` | `perf:verify-cli-output-contracts`, `perf:verify-governance-completeness`, `perf:verify-governance-runtime-cli` |

Notes :

- `contract_version` et `command` restent portés par les métadonnées du schéma (`x-aidn-contract-version`, `x-aidn-command`) plutôt que par les payloads JSON bruts ;
- `governance-diagnostics` ajoute les tableaux de couverture résiduelle sans reclasser ces concepts comme gouvernés ;
- aucune de ces extensions n’a nécessité de passer au contrat v2.

## 8. Validation CI / gates

| Gate attendu | Script npm associé | Outil associé | Workflow CI associé | Statut | Écart | Correction proposée |
|---|---|---|---|---|---|---|
| verify CLI surface inventory | `npm run perf:verify-cli-surface-inventory` | `tools/perf/verify-cli-surface-inventory.mjs` | `architecture-gates.yml`, `cli-contracts.yml` | conforme | Aucun | Aucune |
| verify CLI effect policy | `npm run perf:verify-cli-effect-policy` | `tools/perf/verify-cli-effect-policy.mjs` | `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify no implicit write | `npm run perf:verify-cli-no-implicit-write` | `tools/perf/verify-cli-no-implicit-write-fixtures.mjs` | `architecture-gates.yml`, `security-baseline.yml` | conforme | Aucun | Aucune |
| verify CLI output contracts | `npm run perf:verify-cli-output-contracts` | `tools/perf/verify-cli-output-contracts-fixtures.mjs` | `cli-contracts.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify golden fixtures | `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-governance-completeness`, `npm run perf:verify-markdown-contract` | `tools/perf/*fixtures.mjs` | `governance.yml`, `cli-contracts.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify metadata policy | `npm run perf:verify-metadata-policy` | `tools/perf/verify-metadata-policy.mjs` | `architecture-gates.yml`, `governance.yml` | conforme | Aucun | Aucune |
| verify source-of-truth policy | `npm run perf:verify-source-of-truth-policy` | `tools/perf/verify-source-of-truth-policy.mjs` | `architecture-gates.yml`, `governance.yml` | conforme | Aucun | Aucune |
| verify governance completeness | `npm run perf:verify-governance-completeness` | `tools/perf/verify-governance-completeness.mjs` | `governance.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify governance runtime CLI | `npm run perf:verify-governance-runtime-cli` | `tools/perf/verify-governance-runtime-cli-fixtures.mjs` | `governance.yml`, `runtime-ops.yml` | conforme | Aucun | Aucune |
| verify shared surface boundary | `npm run perf:verify-shared-surface-boundary` | `tools/perf/verify-shared-surface-boundary.mjs` | `shared-boundary.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify runtime modes files/dual/db-only | `npm run perf:verify-state-mode-parity`, `npm run perf:verify-db-only-readiness` | `tools/perf/verify-state-mode-parity-fixtures.mjs`, `tools/perf/verify-db-only-readiness-fixtures.mjs` | `runtime-mode.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |
| verify release version | `npm run perf:verify-release-version` | `tools/perf/verify-release-version.mjs` | `cli-contracts.yml`, `architecture-gates.yml`, `release.yml` | conforme | Aucun | Aucune |
| verify release provenance | `npm run perf:verify-release-artifacts`, `npm run perf:verify-release-flow` | `tools/perf/verify-release-artifacts.mjs`, `tools/build-release.mjs` | `release.yml`, `architecture-gates.yml` | conforme | Aucune après régénération | Garder `release/checksums.txt` régénéré avec le zip courant |
| verify checksums | `npm run perf:verify-release-artifacts` | `tools/perf/verify-release-artifacts.mjs` | `release.yml` | conforme | Aucun après régénération | Aucune |
| verify backup/restore smoke test | `npm run perf:verify-shared-coordination-backup`, `npm run perf:verify-shared-coordination-restore`, `npm run perf:verify-shared-coordination-doctor` | `tools/perf/verify-shared-coordination-*-fixtures.mjs` | `runtime-ops.yml`, `architecture-gates.yml` | conforme | Aucun | Aucune |

## 9. Écarts confirmés

| ID | Écart | Preuve | Risque architecture d’entreprise | Risque architecture de l’information | Priorité P0/P1/P2/P3 | Correction proposée | Fichiers concernés | Tests ou gates attendus |
|---|---|---|---|---|---|---|---|---|
| GAP-01 | La couverture résiduelle n’était pas exposée explicitement dans le diagnostic de gouvernance | Avant la correction, `governance-diagnostics` validait 20 concepts gouvernés mais ne distinguait pas les concepts subsumés/exclus | Les équipes pouvaient confondre scope gouverné et télémétrie opérationnelle | La frontière entre concepts core et concepts résiduels restait implicite | P1 | Ajouter un registre de couverture résiduelle et l’exposer dans `governance-diagnostics` | `src/core/governance/concept-coverage.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs`, `src/core/contracts/cli-output/runtime-governance-diagnostics.v1.schema.json`, `docs/ADR/ADR-0006-information-model.md`, `docs/ADR/ADR-0004-public-cli-json-contracts.md`, `src/core/contracts/cli-output/README.md` | `node tools/perf/verify-governance-diagnostics-use-case-fixtures.mjs`, `npm run perf:verify-governance-runtime-cli`, `npm run perf:verify-cli-output-contracts`, `npm run perf:verify-markdown-contract` |
| GAP-02 | La provenance de release ne passait pas tant que le zip courant n’était pas régénéré | `npm run perf:verify-release-artifacts` a d’abord échoué avec `release/checksums.txt does not match the current release zip` | Un artefact release peut sembler valide alors qu’il ne correspond plus au contenu actuel du dépôt | Les checksums peuvent diverger du zip réellement publié | P1 | Régénérer la release, réaligner `release/checksums.txt` puis revalider le flow complet | `release/checksums.txt`, `release/dist/aidn-workflow-0.5.1.zip`, `tools/build-release.mjs` | `npm run build-release`, `npm run perf:verify-release-artifacts`, `npm run perf:verify-release-flow` |

## 10. Backlog de correction

Le backlog confirmé a été traité dans ce lot. Il ne reste pas de backlog ouvert côté architecture validée.

Pour traçabilité, les deux corrections suivantes ont été appliquées :

- `GAP-01` - couverture résiduelle de gouvernance explicitée ;
- `GAP-02` - provenance de release réalignée.

Chaque correction a été accompagnée d’un test, d’une fixture, d’un gate et d’une mise à jour documentaire.
