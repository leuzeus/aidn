# Plan AIDN Enterprise And Information Architecture - 2026-05-18

Backlog: `docs/BACKLOG_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`

## 1. Résumé Exécutif

AIDN n'est plus seulement un système de templates. Le dépôt contient déjà une plateforme locale de workflow auditable: couches `src/core`, `src/application`, `src/adapters`, runtime SQLite/PostgreSQL, hooks Codex, repair layer, contrats Markdown critiques, coordination multi-agent, packs d'installation et vérifications `perf`.

Le problème principal n'est donc pas l'absence de plateforme, mais la dispersion des sources de vérité et des contrats. Le modèle d'information est aujourd'hui reconstruit depuis plusieurs surfaces: `scaffold/docs_audit/*`, parsers Markdown, schémas SQL, sorties CLI, docs de workflow et fixtures.

Vision cible:

- une plateforme locale-first de gouvernance du travail assisté par IA
- un modèle d'information explicite et maintenu comme actif produit
- des sources de vérité déclarées par concept et par mode `files|dual|db-only`
- des contrats CLI/JSON versionnés pour les intégrations
- une fédération multi-worktree/multi-repo strictement opt-in, après stabilisation du modèle local

Les 5 problèmes les plus importants à résoudre:

1. Source de vérité trop dispersée entre `docs/audit`, `.aidn/runtime`, SQLite/PostgreSQL et projections Markdown.
2. Contrats CLI/JSON publics non centralisés, avec des commandes qui peuvent écrire des digests malgré une apparence de lecture.
3. Modèle d'information implicite, reconstruit depuis templates, parsers, schémas SQL et sorties runtime.
4. Couplage résiduel entre orchestration, admission, projection, observabilité et scripts CLI.
5. Gouvernance documentaire forte mais pas encore formalisée en rôles, métadonnées obligatoires et règles qualité globales.

## 2. Carte Des Capacités D'AIDN

Maturité: `1` initial, `2` répétable, `3` défini, `4` géré, `5` optimisé.

| Domaine L1 | Capacités L2 | Description | Valeur | Actuel | Cible |
|---|---|---|---|---:|---:|
| Installation et distribution | packs, scaffold, install, project config | Installer les surfaces workflow/runtime dans un projet cible depuis le dépôt package. | Onboarding fiable et reproductible. | 3 | 4 |
| Gouvernance workflow | session, cycle, DoR, drift, gates | Encadrer le travail IA par des états, gates et artefacts auditables. | Réduit la dérive et stabilise les agents. | 4 | 5 |
| Gestion d'état runtime | `files`, `dual`, `db-only`, SQLite, PostgreSQL, projections | Maintenir et projeter l'état opérationnel local. | Continuité locale et reprise rapide. | 3 | 5 |
| Architecture informationnelle | artifacts, metadata, contracts, manifests | Décrire les concepts, relations, sources et contrats de données. | Traçabilité exploitable et dette réduite. | 2 | 5 |
| Coordination agents | handoff, roster, adapters, orchestration | Router le travail entre agents et produire des handoffs déterministes. | Collaboration multi-agent contrôlée. | 3 | 4 |
| Qualité et conformité | repair layer, checks, tests, leak guards | Détecter incohérences, leaks, drift et non-conformité de contrats. | Confiance avant mutation. | 3 | 5 |
| Exploitation locale | backup, restore, migration, doctor, observabilité | Supporter opérations runtime et incidents sans plateforme cloud. | Maintenabilité par petite équipe. | 3 | 4 |

## 3. Chaînes De Valeur Principales

| Chaîne | Étapes | Informations utilisées | Informations produites | Capacités impliquées | Problèmes actuels |
|---|---|---|---|---|---|
| Installer AIDN dans un projet | pack -> scaffold -> config -> verify -> import runtime | manifests, compat matrix, workflow adapter | `docs/audit/*`, `.aidn/config.json`, `.aidn/project/workflow.adapter.json`, runtime index | Installation, runtime, conformité | Certains libellés historiques restent template-first. |
| Démarrer une session | context reload -> admission -> session state -> hydration | `CURRENT-STATE.md`, session, Git, runtime digest | décision d'admission, contexte hydraté | Workflow, gates, runtime | Source de contexte multi-fichiers difficile à expliquer. |
| Exécuter un cycle assisté IA | DoR -> plan -> changes -> traceability -> close | cycle status, plan, traceability, Git state | décisions, gaps, CR, baseline candidate | Workflow, qualité, information | Métadonnées cycle dispersées entre fichiers et runtime. |
| Produire un handoff | runtime digest -> handoff packet -> optional relay | `RUNTIME-STATE.md`, agent roster, current state | `HANDOFF-PACKET.md`, relay shared | Coordination agents, runtime | Certaines commandes de projection écrivent par défaut. |
| Synchroniser runtime et documentation | import -> canonical DB -> projection -> freshness check | artifacts, SQLite/Postgres, contracts | heads, Markdown, index, repair findings | Runtime, information, conformité | Canonicalité pas visible partout. |
| Vérifier la conformité workflow | pre-write -> repair -> gates -> targeted tests | state mode, Git, contracts, workflow rules | `block|warn|ok`, findings, test evidence | Qualité, gouvernance | Contrats de sortie JSON non versionnés centralement. |
| Capitaliser décisions et incidents | record -> link -> resolve -> promote | decisions, incidents, hypotheses, CR | baseline, history, traceability links | Information, gouvernance | Owner/steward et lifecycle non systématiques. |

## 4. Modèle D'Information Cible

### Concepts

| Concept | Définition | Source de vérité recommandée | Métadonnées obligatoires | Cycle de vie |
|---|---|---|---|---|
| Project | Produit ou dépôt cible gouverné par AIDN. | `.aidn/project/workflow.adapter.json` pour politique, Git pour identité. | `id`, `name`, `source_branch`, `owner`, `updated_at` | draft -> active -> archived |
| Workspace | Contexte d'exécution local associé à un projet. | `.aidn/config.json` et résolution workspace runtime. | `workspace_id`, `project_id`, `root`, `source`, `updated_at` | active -> reanchored -> archived |
| Worktree | Checkout Git concret où l'agent agit. | Git + runtime workspace resolution. | `worktree_id`, `branch`, `git_dir`, `head_commit` | active -> stale -> archived |
| Session | Fenêtre de travail d'un ou plusieurs agents. | `docs/audit/sessions/S*.md`, puis projection DB en `dual/db-only`. | `session_id`, `mode`, `branch_kind`, `owner`, `state`, `updated_at` | draft -> active -> closing -> closed |
| Cycle | Unité gouvernée de changement, spike, bugfix ou refactor. | `docs/audit/cycles/*/status.md`, puis projection DB. | `cycle_id`, `state`, `branch_name`, `dor_state`, `owner`, `updated_at` | open -> implementing -> verifying -> done |
| Artifact | Fichier, digest ou payload indexé par AIDN. | SQLite/PostgreSQL `artifacts` pour runtime; checkout pour docs audités. | `path`, `kind`, `family`, `subtype`, `sha256`, `source_mode` | discovered -> indexed -> verified -> archived |
| ArtifactContract | Règle de forme d'un artefact critique. | `src/lib/workflow/markdown-contract-registry-lib.mjs`, puis registre JSON public. | `artifact_type`, `contract_version`, `required_fields`, `status` | proposed -> active -> deprecated |
| CurrentState | Résumé opérationnel courant. | `docs/audit/CURRENT-STATE.md` en files; DB/projection en `dual/db-only`. | `contract_version`, `updated_at`, `active_session`, `active_cycle`, `mode` | refreshed -> stale -> superseded |
| RuntimeState | Digest des signaux runtime. | Runtime store + projection `docs/audit/RUNTIME-STATE.md`. | `runtime_state_mode`, `repair_layer_status`, `freshness`, `updated_at` | refreshed -> stale -> superseded |
| Snapshot | Point de recharge rapide du contexte. | `docs/audit/snapshots/context-snapshot.md` et index runtime. | `snapshot_id`, `active_context`, `sha256`, `updated_at` | captured -> used -> superseded |
| Baseline | État promu comme référence stable. | `docs/audit/baseline/current.md` et `history.md`. | `baseline_id`, `source_cycle`, `promoted_by`, `updated_at` | candidate -> current -> historical |
| HandoffPacket | Digest de transfert entre agents. | `docs/audit/HANDOFF-PACKET.md`, relay partagé optionnel. | `handoff_status`, `from_role`, `next_role`, `scope`, `updated_at` | draft -> ready -> consumed -> superseded |
| HandoffRelay | Métadonnée partagée de handoff. | Shared coordination store opt-in. | `relay_id`, `workspace_id`, `session_id`, `status`, `payload` | appended -> read -> archived |
| AgentAdapter | Intégration exécutable d'un agent. | `src/core/ports/agent-adapter-port.mjs` + roster installé. | `id`, `roles`, `capabilities`, `enabled`, `priority` | registered -> healthy -> disabled |
| AgentRoster | Configuration des adapters disponibles. | `docs/audit/AGENT-ROSTER.md`. | `adapter_id`, `enabled`, `roles`, `priority` | template -> configured -> verified |
| Decision | Choix architectural ou workflow. | `decisions.md`, ADR ou coordination record selon portée. | `decision_id`, `context`, `decision`, `options`, `impacts` | proposed -> accepted -> superseded |
| Incident | Écart workflow ou runtime à suivre. | `docs/audit/incidents/*`. | `incident_id`, `severity`, `owner`, `status`, `resolution` | opened -> mitigated -> closed |
| ChangeRequest | Changement de scope ou exigence. | `change-requests.md`. | `cr_id`, `impact`, `decision`, `target_cycle` | proposed -> accepted|split|rejected |
| Gap | Manque de couverture ou de connaissance. | `gap-report.md` et repair findings. | `gap_id`, `severity`, `owner`, `status` | open -> investigated -> closed |
| Hypothesis | Hypothèse vérifiable. | `hypotheses.md`. | `hypothesis_id`, `claim`, `validation`, `status` | proposed -> tested -> confirmed|rejected |
| TraceabilityLink | Relation entre exigences, tests et artefacts. | `traceability.md` + runtime links. | `source_ref`, `target_ref`, `relation_type`, `confidence` | inferred -> verified -> promoted |
| GateResult | Résultat d'un contrôle d'admission ou conformité. | CLI JSON + runtime context. | `gate_id`, `status`, `reason_code`, `checked_at` | evaluated -> acted_on -> archived |
| RepairFinding | Incohérence détectée par repair layer. | SQLite/PostgreSQL repair tables. | `finding_id`, `severity`, `entity`, `confidence`, `suggested_action` | open -> accepted|rejected -> resolved |
| RepairDecision | Décision humaine/agent sur un repair finding. | `repair_decisions` runtime. | `decision`, `decided_by`, `decided_at`, `notes` | recorded -> applied -> audited |
| MigrationRun | Exécution de migration runtime/schema. | runtime migration tables + CLI output. | `run_id`, `schema_version`, `status`, `started_at`, `ended_at` | planned -> executed -> verified |
| CoordinationRecord | Historique de coordination agent/runtime. | `.aidn/runtime/context/*` ou shared coordination opt-in. | `record_id`, `actor`, `action`, `scope`, `status` | appended -> summarized -> archived |
| ReferenceData | Vocabulaires stables: states, roles, modes, severities. | `src/core/*` et docs de contrats. | `code`, `label`, `version`, `status` | active -> deprecated |

### Policy Metadata Canonique

Les métadonnées obligatoires sont maintenant matérialisées dans `src/core/metadata/metadata-policy.mjs`.
Cette policy est la référence produit pour les champs d'ownership, source, lifecycle et classification; les contrats Markdown critiques l'exposent via `src/lib/workflow/markdown-contract-registry-lib.mjs`.

| Famille | Exemples | Champs gouvernés minimum | Tolérance legacy |
|---|---|---|---|
| Identité projet/workspace | `Project`, `Workspace` | `project_id`/`workspace_id`, `source_of_truth`, `updated_at`, `lifecycle_status` | faible |
| Travail gouverné | `Session`, `Cycle` | id métier, `contract_version`, `owner`, `state`, `updated_at`, `source_of_truth`, `lifecycle_status` | owner/source/lifecycle tolérés en legacy |
| Digests runtime | `CurrentState`, `RuntimeState`, `HandoffPacket` | `contract_version`, `updated_at`, mode/status, `source_of_truth`, `source_mode`, `lifecycle_status` | source/lifecycle/classification tolérés en legacy |
| Contrats | `ArtifactContract`, CLI schemas | `artifact_type`, `contract_version`, `required_fields`, `owner`, `source_of_truth`, `lifecycle_status` | faible |
| Gouvernance opérationnelle | `Decision`, `Incident`, `RepairFinding`, `CoordinationRecord` | id, type/status/severity, acteur responsable, dates, `source_of_truth`, `lifecycle_status` | legacy documenté si non bloquant |

### Relations Clés

- `Project` possède un ou plusieurs `Workspace`; un `Workspace` possède un ou plusieurs `Worktree`.
- `Session` attache un ou plusieurs `Cycle`.
- `Cycle` produit `Artifact`, `Decision`, `Gap`, `ChangeRequest`, `Hypothesis` et `TraceabilityLink`.
- `Artifact` respecte un `ArtifactContract` et peut être relié à session, cycle ou baseline.
- `CurrentState`, `RuntimeState`, `Snapshot` et `HandoffPacket` sont des vues/digests, pas des règles métier.
- `RepairFinding` peut être résolu par `RepairDecision`.
- `CoordinationRecord` relie agent, action, session/cycle et résultat.

### Classes De Données

| Classe | Exemples | Gestion recommandée |
|---|---|---|
| Données maîtresses | `Project`, `Workspace`, `Worktree`, `AgentAdapter` | identifiants stables, ownership explicite |
| Données de référence | modes, roles, states, severities, relation types | registry versionné dans `src/core` |
| Données opérationnelles | sessions, cycles, gates, repair findings, coordination records | runtime local, projections auditées |
| Contenus | Markdown audit, specs, plans, snapshots, handoffs | checksum, contract version, lifecycle |
| Données analytiques | KPI, perf reports, constraint trends | `.aidn/runtime/perf/*`, non canonique |

### Matrice Source De Vérité Par Concept

Cette matrice complète `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`: elle décrit le propriétaire logique de l'information, tandis que la matrice runtime décrit le scope des chemins physiques.

| Concept | `files` | `dual` | `db-only` | Projection/digest | Shared runtime |
|---|---|---|---|---|---|
| Workflow rules | `docs/audit/SPEC.md` projeté depuis `docs/SPEC.md` | identique | identique | `WORKFLOW_SUMMARY.md`, `WORKFLOW-KERNEL.md` | jamais partagé par défaut |
| Project policy | `.aidn/project/workflow.adapter.json` | identique | identique | `WORKFLOW.md`, generated docs | jamais partagé par défaut |
| Local runtime defaults | `.aidn/config.json` | identique | identique | CLI status | jamais partagé par défaut |
| Workspace identity | Git + workspace resolver | Git + workspace resolver + local runtime | Git + workspace resolver + local runtime | runtime JSON | peut être enregistré dans shared coordination opt-in |
| Session | `docs/audit/sessions/S*.md` | DB/index canonique avec projection Markdown requise | DB canonique, Markdown matérialisé à la demande | current state, runtime heads | metadata seulement si coordination partagée |
| Cycle | `docs/audit/cycles/*/status.md` | DB/index canonique avec projection Markdown requise | DB canonique, Markdown matérialisé à la demande | current state, runtime heads | metadata seulement si coordination partagée |
| Artifact inventory | checkout `docs/audit/*` et file scan | SQLite/PostgreSQL artifact store canonique pour runtime | SQLite/PostgreSQL artifact store canonique | `artifact_manifest`, index exports | non partagé hors locator explicite |
| CurrentState | `docs/audit/CURRENT-STATE.md` | digest projeté depuis état canonique + fichiers | digest matérialisable depuis DB | `CURRENT-STATE.md` | non partagé |
| RuntimeState | runtime read + `docs/audit/RUNTIME-STATE.md` | runtime store + projection | runtime store + projection à la demande | `RUNTIME-STATE.md` | non partagé |
| HandoffPacket | `docs/audit/HANDOFF-PACKET.md` | packet projeté depuis runtime/current state | packet matérialisable depuis DB/runtime | Markdown packet | relay metadata opt-in seulement |
| HandoffRelay | absent ou local context | local context ou shared store opt-in | local context ou shared store opt-in | coordination summary | `handoff_relays` si opt-in |
| RepairFinding | repair scan local | repair tables + reports | repair tables | triage reports | non partagé par défaut |
| RepairDecision | `repair_decisions` si DB disponible, sinon docs de cycle | DB canonique | DB canonique | repair summaries | non partagé par défaut |
| CoordinationRecord | `.aidn/runtime/context/*` | `.aidn/runtime/context/*` | `.aidn/runtime/context/*` | `COORDINATION-LOG.md`, `COORDINATION-SUMMARY.md` | `coordination_records` si opt-in |
| AgentRoster | `docs/audit/AGENT-ROSTER.md` | identique | identique | health/selection summaries | non partagé |
| CLI output contract | `src/core/contracts/cli-output/*.schema.json` dans le package | identique | identique | generated docs futures | non partagé |

Règles:

- les fichiers `docs/audit/*` restent checkout-bound même en `dual` et `db-only`
- SQLite local est une source runtime locale ou une projection de compatibilité, pas un backend partagé implicite
- PostgreSQL shared coordination ne remplace pas les artefacts auditables checkout-bound
- tout contenu inféré doit conserver `source_mode`, `confidence` ou un équivalent de provenance

### Inventaire Des Champs Runtime Actuels

| Surface | Champs critiques | Champs de provenance / legacy | Gaps à traiter |
|---|---|---|---|
| `artifacts` SQLite/PostgreSQL | `artifact_id`, `path`, `kind`, `family`, `subtype`, `sha256`, `size_bytes`, `mtime_ns`, `session_id`, `cycle_id`, `updated_at` | `source_mode`, `entity_confidence`, `legacy_origin`, `canonical_json.contract_status`, `legacy_shape_id` | owner/steward/lifecycle/classification non normalisés |
| `sessions` | `session_id`, `branch_name`, `state`, `owner`, `started_at`, `ended_at`, `updated_at` | `source_artifact_path`, `source_confidence`, `source_mode`, legacy scalar integration target | metadata qualité encore principalement Markdown |
| `cycles` | `cycle_id`, `session_id`, `state`, `outcome`, `branch_name`, `dor_state`, `updated_at` | continuity fields, `continuity_decision_by` | lifecycle et source of truth pas centralisés en policy |
| `runtime_heads` | `head_key`, `artifact_path`, `artifact_sha256`, `session_id`, `cycle_id`, `payload_json`, `updated_at` | `contract_status`, `legacy_shape_id`, derived contexts | contrat JSON du payload non encore exporté en schema |
| `artifact_links` / `cycle_links` / `session_*_links` | source, target, `relation_type`, `updated_at` | `confidence`, `inference_source`, `source_mode`, `relation_status`, `ambiguity_status` | seuils et promotion policy documentés côté code plus que côté modèle |
| `repair_decisions` | `relation_scope`, `source_ref`, `target_ref`, `relation_type`, `decision`, `decided_at` | `decided_by`, `notes` | RACI owner/steward à renforcer |
| `migration_runs` / `migration_findings` | run id, engine version, status, target root, finding severity/type/entity | confidence, suggested action | classification sécurité et rétention à formaliser |
| Markdown contracts | `contract_version`, required sections, required fields | tolerated legacy variants | registry public JSON à ajouter pour sorties CLI |
| CLI JSON outputs | `ok/status`, target/workspace, context, checks, warnings, findings | legacy fields selon commande | schemas v1 et tests golden manquants |

## 5. Gouvernance Et Qualité Des Données

### Rôles

| Rôle | Responsabilité |
|---|---|
| Owner | Décide la finalité et la priorité d'un concept ou artefact. |
| Steward | Maintient qualité, complétude, fraîcheur et définitions. |
| Maintainer | Implémente contrats, scripts, migrations et tests. |
| Agent | Lit et produit des artefacts sous gates. |
| Reviewer | Vérifie conformité, risques, tests et traçabilité. |
| Architect | Maintient principes, ADR, modèle d'information et boundaries. |

### RACI Opérationnel

| Surface | Accountable | Responsible | Consulted | Informed |
|---|---|---|---|---|
| Source de vérité et modèle d'information | Architect | Maintainer | Steward, Reviewer | Agent |
| Métadonnées obligatoires | Steward | Maintainer | Owner, Architect | Agent, Reviewer |
| Artefacts de session/cycle | Owner | Agent | Steward, Reviewer | Architect |
| Contrats CLI/JSON et Markdown | Maintainer | Maintainer | Architect, Reviewer | Agent |
| Gates admission/repair | Maintainer | Agent | Reviewer, Steward | Owner |
| ADR et principes | Architect | Architect | Owner, Maintainer, Reviewer | Agent |

Règles d'exécution pour agents:

- avant mutation, lire les sources opérationnelles minimales: `CURRENT-STATE.md`, `WORKFLOW-KERNEL.md`, `WORKFLOW_SUMMARY.md`, `RUNTIME-STATE.md` si disponible, puis l'artefact session/cycle actif quand pertinent
- respecter la distinction package source vs dépôt installé: dans ce dépôt, `scaffold/*` reste un template et `tests/fixtures/*` reste un corpus de test
- ne promouvoir une donnée inférée en donnée gouvernée que si `source_of_truth`, `source_mode`, lifecycle et ownership sont explicites ou tolérés legacy
- signaler les manques metadata via gates; ne les masquer ni par projection Markdown ni par import DB

### Règles Qualité

| Dimension | Règle |
|---|---|
| Complétude | Les artefacts critiques déclarent `contract_version`, état, scope, owner ou owner implicite documenté. |
| Cohérence | Session/cycle/current-state/runtime-state doivent converger ou exposer un finding. |
| Fraîcheur | Les digests doivent exposer `updated_at` et une base de fraîcheur. |
| Traçabilité | Tout changement durable doit se rattacher à session/cycle/decision/test. |
| Fiabilité | Toute donnée inférée doit exposer `source_mode` et `confidence`. |
| Sécurité | Secrets et chemins locaux sensibles ne doivent pas entrer dans les artefacts publiés. |

Risques à contrôler:

- dérive entre docs et runtime DB
- duplication des règles métier dans les templates
- ambiguïté entre état canonique et projection
- fixtures locales contenant du contexte pilote sensible
- sorties CLI utilisées comme API sans version

## 6. Architecture Applicative Et Technique

L'état actuel est partiellement aligné avec l'ADR runtime-platform:

- `src/core`: policies, ports, rôles agents, state mode
- `src/application`: install, project, runtime, codex use cases
- `src/adapters`: runtime, codex, manifest, local git/process
- `tools/*`: distribution CLI et nombreux wrappers historiques

Responsabilités encore trop couplées:

- certains scripts `tools/runtime/*.mjs` contiennent encore parsing CLI, orchestration, projection et rendu
- les contrats JSON publics sont implicites dans les objets retournés
- les projections Markdown peuvent être mutantes sans option d'écriture explicite sur certaines commandes
- la documentation de compatibilité garde des termes template-first

Cible en couches:

| Couche | Responsabilité | À renforcer |
|---|---|---|
| `src/core` | invariants, vocabulaires, contrats, ports | registry SoT, reference data, CLI schemas |
| `src/application` | use cases et orchestration métier | use cases pour projections et parité |
| `src/adapters` | FS, Git, SQLite, PostgreSQL, Codex, process | stores explicites par source |
| `tools` / `bin` | CLI thin wrappers | parse args, call use case, format output |
| `scaffold` / `packs` | distribution installée | templates alignés sur contrats |

Contrats à stabiliser en priorité:

- `runtime project-runtime-state --json`
- `runtime project-handoff-packet --json`
- `runtime pre-write-admit --json`
- `runtime db-status --json`
- `runtime coordinator-next-action --json`
- `runtime coordinator-dispatch-plan --json`
- `runtime coordinator-orchestrate --json`
- `runtime handoff-admit --json`
- `project config --list --json`
- `codex hydrate-context --json`

### Inventaire Des Effets CLI

Classes d'effet:

- `read-only`: lit et imprime, ne modifie pas le target
- `preview`: calcule un plan ou diagnostic sans appliquer
- `projector`: écrit ou rafraîchit un artefact dérivé
- `mutating`: modifie l'état canonique, le runtime store, des docs ou un backend partagé
- `executor`: lance une séquence de commandes ou d'agents

| Commande | Classe actuelle | Problème / règle cible |
|---|---|---|
| `aidn project config --list --json` | read-only | contrat JSON v1 ajouté; doit rester non mutant |
| `aidn runtime db-status --json` | read-only | contrat JSON v1 ajouté; diagnostics sans migration |
| `aidn runtime pre-write-admit --json` | read-only | peut bloquer/warn, mais ne doit pas réparer automatiquement |
| `aidn runtime handoff-admit --json` | read-only | admission uniquement; relay partagé séparé |
| `aidn runtime coordinator-next-action --json` | read-only | recommandation uniquement |
| `aidn runtime coordinator-dispatch-plan --json` | preview | plan de dispatch sans exécution |
| `aidn runtime coordinator-orchestrate --json` | preview/executor | `--execute` doit rester le séparateur d'effet |
| `aidn runtime project-runtime-state --json` | projector | écrit actuellement `RUNTIME-STATE.md`; EIA-3.2 doit ajouter une lecture non mutante ou `--write` explicite |
| `aidn runtime project-handoff-packet --json` | projector | écrit actuellement `HANDOFF-PACKET.md`; EIA-3.2 doit ajouter une lecture non mutante ou `--write` explicite |
| `aidn codex hydrate-context --json` | projector | peut écrire contexte/runtime/handoff selon options; le contrat doit distinguer forced/auto projections |
| `aidn runtime db-migrate --json` | mutating | doit rester explicitement migration/admin |
| `aidn runtime db-backup --json` | mutating local output | écrit un backup; sortie et chemin doivent rester explicites |
| `aidn runtime shared-coordination-restore --write --json` | mutating | `--write` doit rester obligatoire pour restore |
| `aidn runtime shared-coordination-migrate --json` | preview/mutating selon options | dry-run/plan avant mutation |
| `aidn runtime coordinator-dispatch-execute --execute --json` | executor | exécution explicite obligatoire |

## 7. Sécurité, Conformité Et Exploitation

Besoins de sécurité:

- classification des artefacts: public, project-local, local-only, secret-ref
- secrets uniquement par référence (`env:NAME`, locator, config locale), jamais en contenu publié
- leak guard maintenu pour package tarball et fixtures sensibles
- chemins locaux réels interdits dans docs publiées sauf nécessité explicite

Besoins d'exploitation:

- backup/restore pour SQLite/PostgreSQL runtime
- doctor/migrate/status non destructifs par défaut
- restore avec compatibilité de schema vérifiée avant écriture
- observabilité locale sous `.aidn/runtime/perf/*`
- runbooks pour migration de mode et repair-layer triage

Risques:

- Git empty repo ou worktree lié mal interprété
- SQLite local pris pour source partagée
- PostgreSQL partagé perçu comme cloud obligatoire
- agents IA modifiant des projections sans gate
- artefacts générés devenant source de vérité par accident

## 8. Analyse Des Problèmes Actuels

| Problème | Description | Symptôme observé | Cause probable | Impact | Risque si rien n'est fait | Priorité | Effort | Recommandation |
|---|---|---|---|---|---|---|---:|---|
| Source de vérité implicite | Source canonique variable selon mode et surface. | Règles/états répartis entre docs, DB, runtime context. | Évolution historique `files -> dual -> db-only`. | Ambiguïté d'exécution. | Drift silencieux. | Critique | M | Créer matrice SoT par concept et mode. |
| Contrats JSON instables | Sorties CLI non versionnées. | Intégrations consomment des shapes implicites. | Absence de schema registry. | Ruptures intégration. | API locale fragile. | Critique | L | Ajouter `src/core/contracts/cli-output/*.schema.json`. |
| Commandes lecture qui écrivent | Projection runtime mutante par défaut. | `project-runtime-state --json` et `project-handoff-packet --json` écrivent un digest. | Convention CLI incomplète. | Mutations inattendues. | Fixtures/projets pollués. | Élevée | M | Introduire preview par défaut ou `--write` explicite. |
| Modèle d'information implicite | Concepts dispersés dans code/docs/SQL. | Difficile de nommer le propriétaire d'un champ. | Pas de catalogue conceptuel. | Dette cognitive. | Incohérence metadata. | Élevée | M | Maintenir ce plan comme modèle cible et créer registry. |
| Couplage CLI/orchestration | Scripts runtime encore larges. | Plusieurs fichiers `tools/runtime` > 20k lignes. | Wrappers historiques. | Maintenance coûteuse. | Régressions lors de refactor. | Élevée | L | Continuer extraction vers `src/application`. |
| Documentation produit divergente | Certains textes restent template-first. | `compat.matrix.yaml` mentionne template-only. | Ancien positionnement. | Adoption confuse. | Mauvais usage. | Moyenne | S | Aligner manifests/docs sur runtime-platform. |
| Gouvernance rôles faible | Owner/steward pas systématiques. | Métadonnées d'ownership absentes ou implicites. | Focus initial sur workflow. | Responsabilité floue. | Audit incomplet. | Moyenne | M | Définir RACI et metadata obligatoire. |

## 9. Feuille De Route

### Court Terme - Stabilisation Et Clarification

Objectifs:

- publier ce plan et le backlog
- inventorier concepts, artefacts, commandes JSON et sources de vérité
- formaliser les ADR de source de vérité et contrats CLI
- corriger les libellés template-first

Livrables:

- plan/backlog architecture informationnelle
- matrice SoT par concept
- inventaire CLI JSON public
- ADR-0003 à ADR-0007 acceptés; ADR-0008 et ADR-0009 draftés

Indicateurs:

- aucun contrat critique sans propriétaire
- commandes mutantes identifiées
- backlog P0 prêt à exécution

### Moyen Terme - Refactoring Architectural Et Contrats

Objectifs:

- versionner les contrats JSON/CLI
- rendre les projections explicitement mutantes
- déplacer les orchestrations restantes vers `src/application`
- ajouter gates qualité metadata/SoT

Livrables:

- schemas JSON v1
- tests golden CLI
- use cases de projection/runtime
- metadata quality checks

Indicateurs:

- sorties critiques validées par schema
- wrappers CLI minces
- tests ciblés documentés dans `docs/TESTING.md`

### Long Terme - Gouvernance Avancée Et Fédération

Objectifs:

- stabiliser fédération multi-repo opt-in
- renforcer exploitation backup/restore/migration
- ajouter vues analytiques locales
- documenter rétention, classification et support

Livrables:

- runbooks opérations locales
- federation boundary ADR
- tests multi-worktree/multi-repo
- dashboards ou rapports locaux

Indicateurs:

- shared runtime jamais implicite
- restore validé avant écriture
- local-first conservé sans dépendance cloud

## 10. Décisions D'Architecture À Documenter

| ADR | Titre | Contexte | Décision | Options comparées | Critères | Impacts | Risques | Statut recommandé |
|---|---|---|---|---|---|---|---|---|
| ADR-0003 | Source Of Truth Policy | Modes multiples et projections. | Définir SoT par concept/mode. | files-first, db-first, hybrid explicite. | auditabilité, simplicité, compat. | Moins d'ambiguïté. | migration progressive. | Accepted |
| ADR-0004 | Public CLI JSON Contracts | Sorties JSON consommables mais implicites. | Schemas versionnés sous `src/core/contracts`. | ad hoc, docs-only, registry central. | stabilité, tests, coût. | API locale plus fiable. | rigidité initiale. | Accepted |
| ADR-0005 | Read/Write CLI Semantics | Certaines commandes lecture écrivent. | Écriture explicite ou nom de commande clairement projecteur. | write-by-default, preview-by-default, dual mode. | sécurité locale, compat. | Moins de mutations surprise. | breaking change à gérer. | Accepted |
| ADR-0006 | Information Model | Concepts dispersés. | Modèle informationnel maintenu comme actif produit. | docs-only, code registry, schemas. | maintenabilité. | Gouvernance plus claire. | dette de synchronisation. | Accepted |
| ADR-0007 | Local-First Federation Boundary | Shared runtime mature mais optionnel. | Fédération opt-in, pas cloud-first. | local only, cloud, opt-in shared. | OSS petite équipe, sécurité. | Extension future contrôlée. | limites multi-org. | Accepted |
| ADR-0002 | Runtime Platform Architecture | ADR cible encore Proposed. | Revoir statut et écarts actuels. | keep proposed, accept, supersede. | alignement réel. | Direction clarifiée. | acceptation prématurée. | Accepted |

## 11. Principes D'Architecture

| Principe | Description | Motivation | Implication |
|---|---|---|---|
| Source de vérité explicite | Chaque concept a un propriétaire canonique par mode. | Éviter dérive et conflits. | Matrice SoT obligatoire. |
| Traçabilité par défaut | Toute action durable relie session, cycle, artefact, décision et test. | Audit du travail IA. | IDs, hashes et liens structurés. |
| Règles métier séparées | Le core porte invariants et vocabulaires; adapters portent la volatilité technique. | Réduire couplage. | Pas de FS/Codex dans core. |
| Contrats stables | CLI, runtime et artefacts critiques exposent versions et schemas. | Intégrations fiables. | Tests golden et politique de compat. |
| Données comme actif de gouvernance | Metadata, qualité et ownership sont des fonctions produit. | Exploitation future. | Owner/steward/freshness obligatoires. |
| Local-first fédérable | Le local doit être stable avant tout partage. | OSS maintenable par petite équipe. | Shared runtime opt-in uniquement. |

## 12. Plan D'Exécution Concret

### Phase 1 - Audit Du Dépôt Et Inventaire

Inspecter:

- `README.md`
- `docs/SPEC.md`
- `docs/ADR/*`
- `packs/*/manifest.yaml`
- `package/manifests/*`
- `package.json`
- `bin/aidn.mjs`
- `tools/runtime/*`
- `tools/perf/*`
- `scaffold/docs_audit/*`

Livrables:

- inventaire concepts, commandes, artefacts et contrats
- table source de vérité par concept

### Phase 2 - Clarification Du Modèle D'Information

Modifier ou créer:

- ce plan
- `docs/BACKLOG_AIDN_ENTERPRISE_INFORMATION_ARCHITECTURE_2026-05-18.md`
- futurs ADR `ADR-0008` et `ADR-0009`

Livrables:

- modèle conceptuel
- relations
- lifecycle
- metadata obligatoire

### Phase 3 - Stabilisation Des Contrats JSON/CLI

Inspecter ou modifier:

- `bin/aidn.mjs`
- `tools/runtime/project-runtime-state.mjs`
- `tools/runtime/project-handoff-packet.mjs`
- `tools/runtime/pre-write-admit.mjs`
- `tools/runtime/db-status.mjs`
- `tools/runtime/coordinator-*.mjs`
- `tools/project/config.mjs`
- `src/core/contracts/cli-output/`

Livrables:

- schemas JSON v1
- tests golden pour sorties critiques
- convention `--json`, `--dry-run`, `--write`

### Phase 4 - Refactoring Core/Application/Adapters/CLI

Inspecter ou modifier:

- `src/application/runtime/*`
- `src/adapters/runtime/*`
- `src/core/ports/*`
- `tools/runtime/*`
- `tools/perf/*`

Livrables:

- wrappers CLI minces
- use cases de projection et parité
- stores explicites par mode

### Phase 5 - Gates De Qualité Et Conformité

Inspecter ou modifier:

- `src/lib/workflow/markdown-contract-registry-lib.mjs`
- `tools/perf/verify-markdown-contract-conformance-fixtures.mjs`
- `tools/perf/verify-state-mode-parity-fixtures.mjs`
- `tools/perf/verify-perf-cli-aliases-fixtures.mjs`
- `tools/perf/verify-runtime-persistence-parity-fixtures.mjs`

Livrables:

- checks metadata completeness
- checks SoT consistency
- checks read/write semantics

### Phase 6 - Documentation, Exemples Et Validation

Inspecter ou modifier:

- `README.md`
- `docs/INSTALL.md`
- `docs/TESTING.md`
- `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`
- `docs/ADR/README.md`
- `tests/fixtures/*`
- `tests/workspaces/selfhost-product/*`

Livrables:

- docs alignées
- validation fixtures suivies
- pilot local-only seulement comme complément, avec `SKIP` séparé de `PASS`

## 13. Hypothèses Et Limites

- Le dépôt courant est le package source, pas un projet installé.
- `scaffold/*` reste une source de templates, pas un état live.
- `tests/fixtures/*` reste un corpus de validation, pas l'état runtime du dépôt.
- Les changements restent local-first et compatibles avec une petite équipe open source.
- La fédération PostgreSQL/shared runtime reste opt-in.
- Les modes `files`, `dual` et `db-only` restent supportés pendant la transition.
