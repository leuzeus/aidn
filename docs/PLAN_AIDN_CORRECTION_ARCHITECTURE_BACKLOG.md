# Plan de correction architectural AIDN

## 1. Resume executif

AIDN fonctionne deja comme une plateforme runtime locale credible. Le depot contient une CLI publique, des modes `files | dual | db-only`, une persistence SQLite/PostgreSQL, des projections Markdown, des contrats JSON initiaux, des policies `source-of-truth` et `metadata`, une couche `src/application` deja fournie, des adapters runtime/Codex/Git, des ADR et une CI riche autour des fixtures runtime. Cette base est significative: le sujet n'est pas de trouver une architecture absente, mais de rendre gouvernable une architecture qui existe deja.

La valeur principale d'AIDN vient de sa combinaison local-first: les artefacts audites restent visibles dans le checkout, le runtime local accelere la reprise et la verification, et PostgreSQL/shared runtime reste optionnel. Ce positionnement est sain pour une petite equipe open source, car il evite de transformer trop tot le produit en plateforme cloud ou en service centralise.

Le probleme principal est maintenant un probleme de gouvernance d'architecture. Les concepts metier, les sources de verite, les projections, les sorties CLI, les schemas JSON, les policies et les scripts d'exploitation existent, mais ils ne sont pas encore tous consommes de facon uniforme par chaque commande publique. Le risque n'est pas seulement technique: c'est la perte de predictibilite pour les agents, les mainteneurs et les utilisateurs qui automatisent AIDN.

Il ne faut pas reecrire AIDN. Une reecriture casserait les modes existants, ferait perdre la connaissance encodee dans les fixtures et retarderait les garanties les plus urgentes. Le bon mouvement est une stabilisation progressive: declarer les effets des commandes, verrouiller les contrats publics, appliquer les policies deja presentes, extraire les scripts trop epais par petites tranches, puis seulement etendre les surfaces partagees.

La trajectoire recommandee est de passer d'une accumulation d'outils intelligents a un produit gouverne par interfaces. Chaque concept public doit avoir une source de verite explicite, chaque commande publique une classe d'effet, chaque sortie JSON critique un schema, chaque projection un statut derive, et chaque extension shared runtime une decision ADR et un test de non-regression.

Les travaux recents ont deja livre une partie de cette trajectoire: schemas CLI v1, `--dry-run` sur les projecteurs runtime critiques, policies SoT/metadata dans `src/core`, ADR-0003 a ADR-0007, extraction de plusieurs builders/use cases runtime et observability. Ce plan doit donc servir de backlog de correction et de durcissement, pas de simple diagnostic initial.

La transformation cible reste incrementalement reviewable. Les P0 protegent les interfaces publiques et les effets read/write. Les P1 appliquent la gouvernance informationnelle et reduisent l'epaisseur des scripts runtime. Les P2 rendent l'exploitation locale plus robuste. Les P3 bornent la federation local-first avant toute extension.

## 2. Diagnostic court

| Probleme | Symptome observable | Risque | Impact | Priorite | Fichiers ou surfaces concernes |
|---|---|---|---|---|---|
| Source of truth distribuee | Un meme concept apparait dans Markdown, runtime heads, SQLite/PostgreSQL, JSON CLI et projections. | Drift silencieux entre canon, digest et cache. | Agents et scripts peuvent agir sur une vue derivee. | P0 | `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `tools/runtime/*`, `.aidn/runtime/*` |
| Read/write CLI ambigu | `--json` peut etre confondu avec une lecture, alors que certaines commandes sont des projecteurs. | Mutation inattendue du checkout ou du backend. | Pollution de fixtures, automation fragile. | P0 | `bin/aidn.mjs`, `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs`, `README.md` |
| Projecteurs runtime trop epais | Certains scripts combinent parsing CLI, resolution FS/DB, validation, logique metier, projection et ecriture. | Refactor risqué et duplications de comportement. | Cout de maintenance eleve. | P1 | `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs`, `tools/runtime/pre-write-admit.mjs`, `tools/runtime/handoff-admit.mjs`, `src/application/runtime/*` |
| Contrats JSON incomplets | Les schemas v1 existent pour plusieurs commandes critiques, mais toutes les sorties importantes ne sont pas couvertes et les schemas restent peu profonds. | Breaking changes invisibles. | Integrations locales et agents instables. | P0 | `src/core/contracts/cli-output/*`, `tools/perf/verify-cli-output-contracts-fixtures.mjs`, `tests/fixtures/*` |
| Policies SoT / metadata pas assez appliquees | Les policies existent dans `src/core`, mais leur consommation doit etre verifiee commande par commande. | Gouvernance documentee mais non enforcee. | Metadata incomplete et diagnostics partiels. | P1 | `src/core/source-of-truth/*`, `src/core/metadata/*`, `src/lib/workflow/markdown-contract-registry-lib.mjs`, `tools/runtime/pre-write-admit.mjs` |
| CI trop monolithique ou trop centree perf | `.github/workflows/perf-kpi.yml` concentre beaucoup de gates dans un job long oriente fixtures/perf. | Signal CI difficile a lire, gates architecturales noyees. | Regression de contrats ou d'effets non isolee. | P1 | `.github/workflows/perf-kpi.yml`, `package.json`, `tools/perf/verify-*` |
| Shared runtime a borner | Shared coordination est disponible et opt-in, mais son extension future peut tenter de deplacer des artefacts checkout-bound. | Rupture local-first et fuite de donnees locales. | Perte d'auditabilite. | P3 | `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `src/core/ports/shared-coordination-store-port.mjs`, `src/adapters/runtime/postgres-shared-coordination-store.mjs` |
| Versioning/release a clarifier | `VERSION`, `package.json`, README, `build-release` et artefacts `release/*` doivent rester synchrones. | Release incoherente ou provenance faible. | Installation et support utilisateurs fragiles. | P2 | `VERSION`, `package.json`, `README.md`, `tools/build-release.mjs`, `release/build.yml`, `release/checksums.txt` |

## 3. Principes de correction

| Nom du principe | Definition | Motivation | Implication concrete dans le code |
|---|---|---|---|
| Local-first par defaut | Le checkout et le runtime local restent suffisants pour comprendre et exploiter un projet AIDN. | Garder AIDN utilisable sans service central. | Ne jamais rendre PostgreSQL obligatoire; garder `.aidn/config.json`, `docs/audit/*`, `AGENTS.md` et `.codex/*` locaux par defaut. |
| Pas d'ecriture implicite | Une commande d'inspection ou de preview ne modifie pas le target. | Eviter les mutations surprises dans les fixtures et automatisations. | Les commandes read-only/preview passent un gate de non-ecriture; les projecteurs exposent `--dry-run` et documentent l'ecriture. |
| Une source de verite explicite par concept | Chaque concept public a une source canonique par mode `files`, `dual`, `db-only`. | Reduire les conflits entre fichiers, DB, projections et CLI. | Consommer `src/core/source-of-truth/source-of-truth-policy.mjs` depuis les admissions et diagnostics runtime. |
| Les projections ne sont pas le canon | Markdown genere, runtime digest, exports JSON/SQL et summaries sont des vues derivees sauf decision explicite. | Eviter que la surface la plus lisible devienne canonique par accident. | Nommer les champs `source_mode`, `source_of_truth`, `freshness`, `projection_status`; verifier les projections obsoletes. |
| Contrats publics avant refactoring profond | Stabiliser les schemas JSON et golden outputs avant de deplacer beaucoup de logique. | Securiser les refactors par des interfaces testees. | Ajouter ou etendre `src/core/contracts/cli-output/*.schema.json` avant extraction de use cases. |
| CLI mince, logique dans application/core | La CLI parse les arguments, appelle un use case, rend stdout/json et mappe les exit codes. | Reduire les scripts trop epais et les duplications. | Extraire validation, projection, payload builders et decisions dans `src/application` ou `src/core`. |
| Shared runtime seulement par opt-in | Les surfaces partagees exigent locator, identite workspace/worktree et ADR. | Preserver la frontiere local-first. | Bloquer toute nouvelle table/surface partagee sans mise a jour ADR, matrix et tests. |
| Tests de comportement avant extension fonctionnelle | Un comportement public doit etre verrouille avant d'etendre sa portee. | Maintenir des PR petites et reviewables. | Ajouter fixtures golden, tests read/write, mode parity et backup/restore avant nouvelles features. |

## 4. Architecture cible progressive

| Couche | Responsabilite | Ce qui semble deja present | Ce qui doit etre corrige | Exemples de fichiers a inspecter |
|---|---|---|---|---|
| `core` | Concepts, policies, invariants, source of truth, metadata, effect classes, regles de workflow. | Policies SoT/metadata, ports, contrats CLI, policies agents/workflow/state-mode. | Ajouter un registre des classes d'effet CLI; etendre la couverture metadata aux concepts publics restants; resserrer les schemas publics par versions. | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `src/core/contracts/cli-output/*`, `src/core/ports/*`, `src/core/workflow/*` |
| `application` | Use cases purs: projection runtime, handoff, admission, migration, backup/restore, coordination. | Nombreux use cases runtime, install, project, codex, observability; builders runtime deja extraits pour runtime-state/handoff. | Continuer l'extraction de `pre-write-admit`, `handoff-admit`, shared coordination operations et diagnostics backup/restore; isoler validation, projection et persistence. | `src/application/runtime/*`, `src/application/install/*`, `src/application/codex/*`, `src/application/observability/*` |
| `adapters` | FS, Git, SQLite, PostgreSQL, Codex, console, GitHub, shared coordination. | Adapters runtime SQLite/PostgreSQL, Git local, Codex, manifest, process/local shell. | Rendre les ports runtime/projection/shared coordination plus explicites dans les commandes restantes; eviter que des scripts accedent directement a FS/DB sans port quand un port existe. | `src/adapters/runtime/*`, `src/adapters/codex/*`, `src/adapters/local/*`, `src/adapters/manifest/*` |
| `cli` | Parsing args, mapping commandes, flags, rendu stdout/json, codes de sortie. | `bin/aidn.mjs` mappe les groupes et scripts; chaque script runtime parse ses flags. | Documenter/centraliser les classes d'effet; reduire les scripts CLI epais; ajouter des tests de non-ecriture par classe. | `bin/aidn.mjs`, `tools/runtime/*.mjs`, `tools/project/config.mjs`, `tools/codex/*.mjs` |
| `distribution` | Packs, scaffold, build-release, README, docs generees, manifests. | `packs/*`, `scaffold/*`, `tools/install.mjs`, `tools/build-release.mjs`, `package.json` whitelist npm, docs install/runtime. | Clarifier provenance release; aligner README/VERSION/package; produire manifest de release; garder les artefacts checkout-bound non deplacables. | `packs/*/manifest.yaml`, `package/manifests/*`, `scaffold/*`, `tools/install.mjs`, `tools/build-release.mjs`, `VERSION`, `package.json`, `README.md` |

## 5. Backlog priorise

### P0 - Stabilisation des interfaces publiques

#### ARCH-P0-01 - Declarer une classe d'effet pour chaque commande publique

- Probleme adresse: read/write CLI ambigu et commandes publiques sans contrat d'effet central.
- Description: creer un inventaire versionne des commandes `aidn install`, `project`, `runtime`, `codex`, `perf` exposees publiquement, avec classe `read-only`, `preview`, `projector`, `mutating` ou `executor`.
- Fichiers probables a modifier: `bin/aidn.mjs`, `src/core/contracts/cli-output/README.md`, nouveau `src/core/cli/effect-policy.mjs` ou equivalent, `docs/TESTING.md`.
- Criteres d'acceptation: chaque commande publique a une classe; les commandes historiques ambigues sont marquees; les commandes non couvertes sont `experimental` ou `internal`; la doc explique que `--json` n'est pas read-only.
- Tests a ajouter ou adapter: verifier d'inventaire CLI, `npm run perf:verify-cli-aliases`, nouveau `perf:verify-cli-effect-policy`.
- Risques: classification trop large pour les commandes `perf`; mitigation par statut `internal/fixture`.
- Dependances: aucune.
- Taille estimee: M.

#### ARCH-P0-02 - Durcir `project-runtime-state` contre les ecritures implicites

- Probleme adresse: projecteur runtime pouvant etre interprete comme lecture.
- Description: conserver la compatibilite historique, mais rendre la lecture non mutante evidente par `--dry-run --json`, documenter la transition vers `--write` explicite et exposer `effect_class`.
- Fichiers probables a modifier: `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`, `src/core/contracts/cli-output/runtime-project-runtime-state.v1.schema.json`, fixtures associees.
- Criteres d'acceptation: `--dry-run --json` ne modifie pas `docs/audit/RUNTIME-STATE.md`; le JSON expose `dry_run`, `written`, `output_file`; la doc de commande nomme l'effet projector.
- Tests a ajouter ou adapter: `npm run perf:verify-runtime-state-projector`, `npm run perf:verify-cli-output-contracts`, test no implicit write.
- Risques: workflows qui attendent l'ecriture par defaut; mitigation par deprecation progressive, pas de changement brutal.
- Dependances: ARCH-P0-01.
- Taille estimee: S.

#### ARCH-P0-03 - Durcir `project-handoff-packet` contre les ecritures implicites

- Probleme adresse: projection Markdown et relay shared coordination possibles depuis une commande d'apparence consultative.
- Description: verrouiller `--dry-run --json` comme chemin read/preview, sans ecriture locale ni append shared relay; documenter la mutation historique.
- Fichiers probables a modifier: `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/handoff-packet-projector-use-case.mjs`, `src/core/contracts/cli-output/runtime-project-handoff-packet.v1.schema.json`.
- Criteres d'acceptation: `--dry-run` ne modifie pas `HANDOFF-PACKET.md` et n'ajoute pas de relay; sortie JSON expose `shared_coordination_sync.status=dry-run`.
- Tests a ajouter ou adapter: `npm run perf:verify-handoff-packet`, `npm run perf:verify-cli-output-contracts`, test non-mutation relay.
- Risques: confusion entre handoff local et relay partage; mitigation par champs de provenance.
- Dependances: ARCH-P0-01.
- Taille estimee: S.

#### ARCH-P0-04 - Ajouter un gate no implicit write

- Probleme adresse: absence de controle automatique pour les commandes supposees read-only/preview.
- Description: executer un echantillon de commandes read-only/preview/projector dry-run sur une copie de fixture et comparer le snapshot fichiers avant/apres.
- Fichiers probables a modifier: nouveau `tools/perf/verify-cli-no-implicit-write-fixtures.mjs`, `package.json`, `tests/fixtures/repo-installed-core`.
- Criteres d'acceptation: les commandes read-only/preview ne changent aucun fichier; les projecteurs ne changent rien en `--dry-run`; les mutations attendues sont exclues explicitement.
- Tests a ajouter ou adapter: nouveau `npm run perf:verify-cli-no-implicit-write`.
- Risques: faux positifs sur fichiers temporaires; mitigation par allowlist stricte `.aidn/runtime/perf` si necessaire.
- Dependances: ARCH-P0-01 a ARCH-P0-03.
- Taille estimee: M.

#### ARCH-P0-05 - Etendre les schemas JSON publics aux commandes runtime critiques restantes

- Probleme adresse: couverture partielle des contrats JSON publics.
- Description: identifier les commandes runtime utilisees comme API mais sans schema, par exemple shared coordination status/projects/backup/restore/doctor/migrate, persistence adopt/status, list-agent-adapters, verify-agent-roster.
- Fichiers probables a modifier: `src/core/contracts/cli-output/*`, `tools/perf/verify-cli-output-contracts-fixtures.mjs`, `README.md`.
- Criteres d'acceptation: chaque commande runtime critique a un schema v1 ou un statut `experimental`; les schemas exposent `x-aidn-command` et `x-aidn-contract-version`.
- Tests a ajouter ou adapter: `npm run perf:verify-cli-output-contracts`, golden outputs par commande ajoutee.
- Risques: schemas trop stricts trop tot; mitigation par schemas top-level extensibles.
- Dependances: ARCH-P0-01.
- Taille estimee: M.

#### ARCH-P0-06 - Ajouter des fixtures golden pour sorties JSON publiques

- Probleme adresse: schemas seuls trop peu profonds.
- Description: stocker des golden outputs sanitises pour les commandes publiques critiques et verifier les champs stables, la provenance et les flags d'effet.
- Fichiers probables a modifier: `tests/fixtures/*`, `tools/perf/verify-cli-output-contracts-fixtures.mjs`, `docs/TESTING.md`.
- Criteres d'acceptation: les golden fixtures couvrent au moins `files`, puis un echantillon `dual` et `db-only`; chemins locaux et secrets sont normalises.
- Tests a ajouter ou adapter: `npm run perf:verify-cli-output-contracts`.
- Risques: fixtures bruyantes; mitigation par assertions structurelles + snapshots minimaux.
- Dependances: ARCH-P0-05.
- Taille estimee: M.

### P1 - Gouvernance de l'information appliquee

#### ARCH-P1-01 - Rendre `source-of-truth-policy` consommee par les commandes runtime cles

- Probleme adresse: policy documentee mais application inegale.
- Description: verifier et completer la consommation SoT dans admission, handoff, projecteurs, persistence status et shared coordination status.
- Fichiers probables a modifier: `src/core/source-of-truth/source-of-truth-policy.mjs`, `tools/runtime/pre-write-admit.mjs`, `tools/runtime/handoff-admit.mjs`, `tools/runtime/db-status.mjs`, `tools/runtime/shared-coordination-status.mjs`.
- Criteres d'acceptation: les sorties cles exposent source canonique, projection/cache, state mode et reason codes de divergence.
- Tests a ajouter ou adapter: `npm run perf:verify-source-of-truth-policy`, `npm run perf:verify-pre-write-admit`, `npm run perf:verify-db-runtime-cli`.
- Risques: surcharge des payloads JSON; mitigation par champ `source_of_truth` compact.
- Dependances: ARCH-P0-05.
- Taille estimee: M.

#### ARCH-P1-02 - Rendre `metadata-policy` consommee par les commandes runtime cles

- Probleme adresse: metadata obligatoire non visible partout.
- Description: faire remonter `metadata_status`, `metadata_findings`, `owner`, `steward`, `lifecycle_status`, `source_mode` lorsque pertinent dans les diagnostics publics.
- Fichiers probables a modifier: `src/core/metadata/metadata-policy.mjs`, `src/lib/workflow/markdown-contract-registry-lib.mjs`, projecteurs/runtime heads.
- Criteres d'acceptation: les concepts publics critiques indiquent metadata complete, legacy tolerated ou missing; les gaps sont lisibles.
- Tests a ajouter ou adapter: `npm run perf:verify-metadata-policy`, `npm run perf:verify-markdown-contract`, golden CLI.
- Risques: legacy noise; mitigation par severites `warn` vs `block`.
- Dependances: ARCH-P1-01.
- Taille estimee: M.

#### ARCH-P1-03 - Ajouter un rapport de completude des concepts gouvernes

- Probleme adresse: absence de vue produit sur la couverture SoT/metadata/contracts.
- Description: creer un rapport listant concepts, source of truth, metadata policy, schema JSON, projections et tests associes.
- Fichiers probables a modifier: nouveau `tools/runtime/governance-diagnostics.mjs` ou `tools/perf/verify-governance-completeness.mjs`, `package.json`, `docs/TESTING.md`.
- Criteres d'acceptation: chaque concept public a un statut `complete`, `partial`, `legacy-tolerated` ou `missing`.
- Tests a ajouter ou adapter: nouveau verifier de completude.
- Risques: rapport trop manuel; mitigation par lecture des registries existants.
- Dependances: ARCH-P1-01, ARCH-P1-02.
- Taille estimee: M.

#### ARCH-P1-04 - Verifier owner/steward/lifecycle/source par concept public

- Probleme adresse: responsabilite informationnelle incomplete.
- Description: ajouter un gate qui verifie `owner`, `steward`, `lifecycle_status`, `source_of_truth`, `source_mode` lorsque pertinent, avec tolerance legacy explicite.
- Fichiers probables a modifier: `src/core/metadata/metadata-policy.mjs`, `tools/perf/verify-metadata-policy.mjs`, `tools/perf/verify-markdown-contract-conformance-fixtures.mjs`.
- Criteres d'acceptation: les champs manquants sortent en findings codes; les exceptions legacy sont listees.
- Tests a ajouter ou adapter: `npm run perf:verify-metadata-policy`, `npm run perf:verify-markdown-contract`.
- Risques: blocage trop agressif sur fixtures historiques; mitigation par `legacy_tolerated_missing_fields`.
- Dependances: ARCH-P1-02.
- Taille estimee: S.

#### ARCH-P1-05 - Ajouter une commande diagnostic SoT / metadata lisible

- Probleme adresse: diagnostics actuellement disperses dans les gates.
- Description: fournir une commande lisible par humain et JSON pour expliquer les ecarts SoT/metadata d'un target.
- Fichiers probables a modifier: `tools/runtime/*diagnose*.mjs`, `src/application/runtime/*diagnostics-service.mjs`, `src/core/contracts/cli-output/*`.
- Criteres d'acceptation: la commande ne modifie rien, explique les ecarts, propose actions et tests.
- Tests a ajouter ou adapter: schema JSON, no implicit write, fixture `files` et `db-only`.
- Risques: chevauchement avec `pre-write-admit`; mitigation par positionnement diagnostic non bloquant.
- Dependances: ARCH-P1-03.
- Taille estimee: M.

### P1 - Refactoring runtime progressif

#### ARCH-P1-06 - Refactoriser `project-runtime-state` vers un use case application complet

- Probleme adresse: script encore responsable de resolution, derivation et rendu.
- Description: deplacer la construction complete du digest, la resolution de sources et les decisions de projection dans `src/application/runtime`, en laissant le CLI parser et rendre.
- Fichiers probables a modifier: `tools/runtime/project-runtime-state.mjs`, `src/application/runtime/runtime-state-projector-use-case.mjs`, services de resolution DB-first.
- Criteres d'acceptation: le script CLI ne contient plus de logique metier significative; le use case est testable hors CLI.
- Tests a ajouter ou adapter: `npm run perf:verify-runtime-payload-builders`, `npm run perf:verify-runtime-state-projector`.
- Risques: regression subtile en `db-only`; mitigation par fixtures `files|dual|db-only`.
- Dependances: ARCH-P0-02.
- Taille estimee: L.

#### ARCH-P1-07 - Identifier les autres scripts runtime trop epais

- Probleme adresse: dette structurelle non priorisee.
- Description: produire un inventaire taille/responsabilites des scripts `tools/runtime/*.mjs` et les classer en wrappers, mixed, monoliths.
- Fichiers probables a modifier: nouveau inventaire sous `src/application/runtime` ou doc `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`.
- Criteres d'acceptation: top 10 scripts a extraire; ownership et prochain increment proposes.
- Tests a ajouter ou adapter: verifier d'inventaire optionnel.
- Risques: analyse sans action; mitigation par creation immediate des tickets ARCH-P1-08/09/10.
- Dependances: ARCH-P0-01.
- Taille estimee: S.

#### ARCH-P1-08 - Extraire projection, validation, ecriture et rendu

- Probleme adresse: melange de responsabilites dans les scripts runtime.
- Description: appliquer un pattern uniforme: `parse args` -> `use case` -> `write adapter` -> `render output` -> `exit code`.
- Fichiers probables a modifier: `tools/runtime/pre-write-admit.mjs`, `tools/runtime/handoff-admit.mjs`, `tools/runtime/project-agent-*.mjs`, `src/application/runtime/*`.
- Criteres d'acceptation: chaque fonction de validation majeure vit hors CLI; les ecritures passent par un adapter ou helper explicite.
- Tests a ajouter ou adapter: tests existants par commande, no implicit write.
- Risques: refactor trop large; mitigation par une commande par PR.
- Dependances: ARCH-P1-07.
- Taille estimee: L.

#### ARCH-P1-09 - Introduire des ports explicites runtime store / projection store / shared coordination

- Probleme adresse: acces directs aux details FS/DB dans certains chemins.
- Description: completer les ports existants pour distinguer runtime canonical store, projection store Markdown et shared coordination store.
- Fichiers probables a modifier: `src/core/ports/*`, `src/adapters/runtime/*`, `src/application/runtime/*`.
- Criteres d'acceptation: les use cases consomment des ports; les adapters portent SQLite/PostgreSQL/FS.
- Tests a ajouter ou adapter: tests parity SQLite/PostgreSQL, unit fixtures adapters.
- Risques: abstraction inutile; mitigation par extraction uniquement depuis usages existants.
- Dependances: ARCH-P1-08.
- Taille estimee: L.

#### ARCH-P1-10 - S'assurer que la CLI ne contient plus de logique metier importante

- Probleme adresse: regression vers scripts monolithiques.
- Description: ajouter une regle d'architecture souple: nouveaux scripts publics doivent etre wrappers minces ou justifier une exception.
- Fichiers probables a modifier: `docs/TESTING.md`, `tools/perf/verify-observability-surface-inventory.mjs`, nouveau verifier CLI thinness.
- Criteres d'acceptation: inventaire des exceptions; gate non bloquant au debut puis strict pour nouvelles commandes.
- Tests a ajouter ou adapter: verifier d'inventaire.
- Risques: metrique lignes/fonctions approximative; mitigation par allowlist manuelle.
- Dependances: ARCH-P1-07.
- Taille estimee: M.

### P1 - CI et qualite architecturale

#### ARCH-P1-11 - Scinder ou structurer les gates CI

- Probleme adresse: `.github/workflows/perf-kpi.yml` trop monolithique.
- Description: organiser les checks en groupes lisibles: contrats, runtime, ops, perf, architecture.
- Fichiers probables a modifier: `.github/workflows/perf-kpi.yml`, eventuellement nouveaux workflows `.github/workflows/contracts.yml`, `runtime.yml`, `ops.yml`.
- Criteres d'acceptation: les checks architecturaux sont identifiables; le job perf reste focalise KPI.
- Tests a ajouter ou adapter: validation GitHub Actions syntaxique, run local des scripts.
- Risques: CI plus lente si duplique setup; mitigation par jobs simples et cache Node.
- Dependances: ARCH-P0-04, ARCH-P0-05.
- Taille estimee: M.

#### ARCH-P1-12 - Ajouter un job dedie aux contrats JSON

- Probleme adresse: derive des schemas JSON noyee dans perf.
- Description: job CI qui lance uniquement contrats CLI et golden JSON.
- Fichiers probables a modifier: `.github/workflows/*`, `package.json`.
- Criteres d'acceptation: failure claire sur schema/output; artefacts de diff si possible.
- Tests a ajouter ou adapter: `npm run perf:verify-cli-output-contracts`.
- Risques: besoin d'installer deps optionnelles; mitigation par fixtures locales sans PostgreSQL live.
- Dependances: ARCH-P0-06.
- Taille estimee: S.

#### ARCH-P1-13 - Ajouter un job dedie aux classes d'effet read/write

- Probleme adresse: mutations implicites non detectees.
- Description: job CI `cli-effects` qui lance l'inventaire effect policy et no implicit write.
- Fichiers probables a modifier: `.github/workflows/*`, `package.json`.
- Criteres d'acceptation: toute commande read-only/preview qui modifie la fixture echoue.
- Tests a ajouter ou adapter: `npm run perf:verify-cli-effect-policy`, `npm run perf:verify-cli-no-implicit-write`.
- Risques: flakiness sur timestamps; mitigation par copie temp et exclusion explicite.
- Dependances: ARCH-P0-04.
- Taille estimee: S.

#### ARCH-P1-14 - Ajouter un job dedie a la completude SoT / metadata

- Probleme adresse: gouvernance non enforcee en CI.
- Description: job qui lance SoT policy, metadata policy, markdown contract et governance completeness.
- Fichiers probables a modifier: `.github/workflows/*`, `package.json`.
- Criteres d'acceptation: sortie CI distingue missing, partial, legacy-tolerated.
- Tests a ajouter ou adapter: `npm run perf:verify-source-of-truth-policy`, `npm run perf:verify-metadata-policy`, `npm run perf:verify-markdown-contract`.
- Risques: legacy trop bruyant; mitigation par seuils de severite.
- Dependances: ARCH-P1-03, ARCH-P1-04.
- Taille estimee: S.

#### ARCH-P1-15 - Ajouter des smoke tests backup/restore

- Probleme adresse: operations locales critiques peu visibles comme gate architecture.
- Description: verifier backup/restore SQLite/local et shared coordination fixture en preview/write controle.
- Fichiers probables a modifier: `tools/perf/verify-shared-coordination-backup-fixtures.mjs`, `tools/perf/verify-shared-coordination-restore-fixtures.mjs`, nouveaux tests runtime persistence.
- Criteres d'acceptation: restore preview ne mute pas; restore write sur temp store restaure un snapshot valide; validation post-restore executee.
- Tests a ajouter ou adapter: `npm run perf:verify-shared-coordination-backup`, `npm run perf:verify-shared-coordination-restore`, `npm run perf:verify-db-schema-migrations`.
- Risques: scope shared vs local confondu; mitigation par assertions de boundaries.
- Dependances: ARCH-P1-11.
- Taille estimee: M.

### P2 - Exploitabilite et operations locales

#### ARCH-P2-01 - Productiser backup/restore/doctor avec runbook

- Probleme adresse: exploitation presente mais trop dispersee.
- Description: fournir une sequence utilisateur status -> backup -> preview -> write -> validate -> rollback.
- Fichiers probables a modifier: `docs/MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md`, `docs/MIGRATION_SHARED_RUNTIME_POSTGRESQL.md`, `docs/TROUBLESHOOTING.md`, `README.md`.
- Criteres d'acceptation: runbook local SQLite, runtime persistence et shared coordination; commandes copie-collables.
- Tests a ajouter ou adapter: smoke backup/restore.
- Risques: docs trop longues; mitigation par runbook synthetique + liens.
- Dependances: ARCH-P1-15.
- Taille estimee: M.

#### ARCH-P2-02 - Ajouter validation post-restore

- Probleme adresse: restore sans preuve de coherence fonctionnelle.
- Description: apres restore, executer schema status, source diagnostics, read contract et no relocation checks.
- Fichiers probables a modifier: `tools/runtime/shared-coordination-restore.mjs`, `src/application/runtime/shared-coordination-admin-service.mjs`, tests restore.
- Criteres d'acceptation: sortie restore expose `post_restore_validation`; echec visible sans masquer les erreurs.
- Tests a ajouter ou adapter: restore fixtures.
- Risques: validation trop couteuse; mitigation par mode `--validate` ou validation minimale par defaut.
- Dependances: ARCH-P2-01.
- Taille estimee: M.

#### ARCH-P2-03 - Clarifier les messages d'erreur utilisateur

- Probleme adresse: erreurs techniques difficiles a transformer en action.
- Description: standardiser `reason_code`, `recommended_actions`, `docs_ref` sur commandes critiques.
- Fichiers probables a modifier: `tools/runtime/*`, `src/application/runtime/*`, schemas JSON.
- Criteres d'acceptation: erreurs sur state mode, missing artifact, shared locator, schema migration ont action utilisateur.
- Tests a ajouter ou adapter: golden erreurs.
- Risques: messages divergents; mitigation par helpers communs.
- Dependances: ARCH-P0-05.
- Taille estimee: M.

#### ARCH-P2-04 - Ajouter diagnostic runtime state et freshness

- Probleme adresse: fraicheur runtime visible mais pas toujours exploitable.
- Description: rapporter freshness par source, derniere projection, canon DB, digest Markdown et action recommandee.
- Fichiers probables a modifier: `tools/runtime/project-runtime-state.mjs`, nouveau diagnostic, `src/application/runtime/runtime-snapshot-service.mjs`.
- Criteres d'acceptation: un utilisateur sait quel artefact regenerer ou quel store verifier.
- Tests a ajouter ou adapter: fixtures stale/current.
- Risques: complexite des modes; mitigation par table `files|dual|db-only`.
- Dependances: ARCH-P1-01.
- Taille estimee: M.

#### ARCH-P2-05 - Documenter scenarios `files / dual / db-only`

- Probleme adresse: modes supportes mais decision utilisateur pas assez guidee.
- Description: ajouter une doc courte: quand utiliser chaque mode, ce qui est canonique, quels risques, quelles commandes de verification.
- Fichiers probables a modifier: `README.md`, `docs/INSTALL.md`, `docs/UPGRADE.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`.
- Criteres d'acceptation: chaque mode a installation, verification, backup et recovery.
- Tests a ajouter ou adapter: revue docs, `git diff --check`.
- Risques: duplication; mitigation par lien vers matrix.
- Dependances: ARCH-P2-01.
- Taille estimee: S.

### P2 - Versioning, release et distribution

#### ARCH-P2-06 - Clarifier politique `dev`, `VERSION`, `package.json`, README et build-release

- Probleme adresse: version/provenance release implicites.
- Description: documenter l'autorite de version, la relation branche/tag, et quand mettre a jour README examples.
- Fichiers probables a modifier: `VERSION`, `package.json`, `README.md`, `docs/GIT_WORKFLOW.md`, `tools/build-release.mjs`.
- Criteres d'acceptation: une release a une source de version unique; divergence `VERSION`/`package.json` est detectee.
- Tests a ajouter ou adapter: nouveau `perf:verify-release-version`.
- Risques: policy trop rigide pour dev; mitigation par distinction dev snapshot vs tag.
- Dependances: aucune.
- Taille estimee: M.

#### ARCH-P2-07 - Ajouter un manifest de release

- Probleme adresse: checksums seuls insuffisants pour provenance.
- Description: generer `release/manifest.json` avec version, git commit, package name, files, checksum, generated_at.
- Fichiers probables a modifier: `tools/build-release.mjs`, `release/build.yml`, docs release.
- Criteres d'acceptation: manifest deterministe autant que possible; checksum zip et metadata coherents.
- Tests a ajouter ou adapter: `perf:verify-release-version`, test build-release en temp.
- Risques: timestamp nuit au determinisme; mitigation par champ optionnel ou normalise.
- Dependances: ARCH-P2-06.
- Taille estimee: M.

#### ARCH-P2-08 - Verifier coherence checksums et artefacts release

- Probleme adresse: artefacts release non controles en CI.
- Description: ajouter un verifier qui reconstruit ou inspecte `release/dist` et `release/checksums.txt`.
- Fichiers probables a modifier: `tools/build-release.mjs`, `tools/perf/verify-release-artifacts.mjs`, `package.json`.
- Criteres d'acceptation: checksum correspond au zip; version du nom de zip correspond a `VERSION`; manifest correspond au zip.
- Tests a ajouter ou adapter: nouveau script release artifact verification.
- Risques: gros zip en CI; mitigation par dry-run manifest ou temp mini fixture.
- Dependances: ARCH-P2-07.
- Taille estimee: M.

#### ARCH-P2-09 - Documenter stable, experimental, internal

- Probleme adresse: surfaces publiques et internes floues.
- Description: marquer commandes, schemas, docs et packs comme stable/experimental/internal.
- Fichiers probables a modifier: `README.md`, `src/core/contracts/cli-output/README.md`, `docs/TESTING.md`, `packs/*/manifest.yaml`.
- Criteres d'acceptation: chaque commande publique critique a un niveau de stabilite; les commandes perf internes sont separees.
- Tests a ajouter ou adapter: verifier d'inventaire CLI.
- Risques: sur-documentation; mitigation par table courte generee.
- Dependances: ARCH-P0-01.
- Taille estimee: S.

### P3 - Federation locale-first

#### ARCH-P3-01 - Stabiliser shared runtime locator

- Probleme adresse: federation future depend d'un locator strict.
- Description: durcir validation, messages, schemas et tests du locator.
- Fichiers probables a modifier: `src/lib/config/shared-runtime-locator-config-lib.mjs`, `src/application/runtime/shared-runtime-validation-service.mjs`, docs migration.
- Criteres d'acceptation: locator absent = local-only; locator invalide = reject clair; secrets par `env:*`.
- Tests a ajouter ou adapter: `npm run perf:verify-shared-runtime-locator`, `npm run perf:verify-shared-runtime-path`.
- Risques: casser setups locaux experimentaux; mitigation par mode diagnostic.
- Dependances: ARCH-P1-15.
- Taille estimee: M.

#### ARCH-P3-02 - Ajouter ou durcir le port `shared-coordination-store`

- Probleme adresse: extension shared coordination doit passer par interface explicite.
- Description: formaliser les methodes stables du port et aligner SQLite fake/PostgreSQL adapters.
- Fichiers probables a modifier: `src/core/ports/shared-coordination-store-port.mjs`, `src/adapters/runtime/postgres-shared-coordination-store.mjs`, fake pg tests.
- Criteres d'acceptation: aucune commande ne depend d'une methode non declaree; contrat documente.
- Tests a ajouter ou adapter: `npm run perf:verify-postgres-shared-coordination-contract`, `npm run perf:verify-postgres-shared-coordination-store`.
- Risques: port trop large; mitigation par surface stable minimale.
- Dependances: ARCH-P3-01.
- Taille estimee: M.

#### ARCH-P3-03 - Tester SQLite local vs PostgreSQL partage avec memes contrats

- Probleme adresse: risque de divergence backend.
- Description: executer les memes contrats de coordination/persistence sur fake/local SQLite et PostgreSQL fake/live optional.
- Fichiers probables a modifier: `tools/perf/verify-postgres-*`, `tools/perf/*fake-pg-lib.mjs`, contracts services.
- Criteres d'acceptation: tests fixtures passent sans serveur; live smoke reste opt-in.
- Tests a ajouter ou adapter: postgres contract/store fixtures, live smoke documente.
- Risques: live dependencies en CI; mitigation par opt-in env.
- Dependances: ARCH-P3-02.
- Taille estimee: L.

#### ARCH-P3-04 - Bloquer extension shared sans ADR acceptee

- Probleme adresse: shared runtime peut s'etendre par opportunisme.
- Description: gate qui compare surfaces partagees code/schema/docs a ADR-0007 et matrix.
- Fichiers probables a modifier: `docs/ADR/ADR-0007-local-first-federation-boundary.md`, `docs/RUNTIME_SURFACE_SCOPE_MATRIX.md`, nouveau verifier.
- Criteres d'acceptation: nouvelle table/surface shared non documentee = failure.
- Tests a ajouter ou adapter: nouveau `perf:verify-shared-surface-boundary`.
- Risques: verifier fragile; mitigation par registry explicite.
- Dependances: ARCH-P3-02.
- Taille estimee: M.

#### ARCH-P3-05 - Ajouter tests de non-deplacement des artefacts checkout-bound

- Probleme adresse: `docs/audit/*`, `AGENTS.md`, `.codex/*` ne doivent pas etre externalises.
- Description: verifier qu'aucun mode/shared operation ne deplace ou remplace implicitement ces surfaces.
- Fichiers probables a modifier: `tools/perf/verify-shared-sqlite-boundary-fixtures.mjs`, nouveau test boundary.
- Criteres d'acceptation: shared coordination ne modifie pas les artefacts checkout-bound sauf commande explicitement locale et documentee.
- Tests a ajouter ou adapter: `npm run perf:verify-shared-sqlite-boundary`, nouveau no relocation.
- Risques: faux positifs sur install/scaffold; mitigation par scope runtime commands.
- Dependances: ARCH-P3-04.
- Taille estimee: M.

## 6. Roadmap en trois horizons

### Court terme: 2 a 4 semaines

- Objectifs: stabiliser les interfaces publiques, inventorier les classes d'effet, eviter les ecritures implicites, completer les schemas JSON critiques.
- Livrables: effect policy CLI, gate no implicit write, schemas et golden JSON etendus, documentation read/write clarifiee.
- Risques: casser l'ergonomie historique des projecteurs; mitigation par compatibilite par defaut et `--dry-run` comme chemin sur.
- Criteres de succes: aucune commande read-only/preview testee ne modifie la fixture; les projecteurs critiques sont non-mutants en `--dry-run`; les sorties JSON critiques sont validees.
- Items backlog associes: ARCH-P0-01 a ARCH-P0-06, ARCH-P1-12, ARCH-P1-13.

### Moyen terme: 1 a 3 mois

- Objectifs: appliquer la gouvernance SoT/metadata et refactoriser les projecteurs/runtime commands trop epais.
- Livrables: diagnostics SoT/metadata, rapport de completude, extractions use case supplementaires, ports runtime/projection/shared explicites, CI structuree par gates.
- Risques: multiplication des policies non consommees; mitigation par tests de completude et adoption commande par commande.
- Criteres de succes: commandes runtime cles exposent source/provenance/metadata; scripts CLI restants sont inventoriés; les refactors passent les contrats publics.
- Items backlog associes: ARCH-P1-01 a ARCH-P1-15.

### Long terme: 3 a 6 mois

- Objectifs: durcir l'exploitation locale, clarifier release/versioning, puis seulement etendre la federation local-first.
- Livrables: runbooks backup/restore/doctor, validation post-restore, manifest release, verifier release, shared locator strict, shared boundary gate.
- Risques: extension prematuree de PostgreSQL/shared runtime; mitigation par ADR, matrix et tests de non-deplacement.
- Criteres de succes: backup/restore validable localement; release provenance coherente; toute surface shared nouvelle est explicitement acceptee et testee.
- Items backlog associes: ARCH-P2-01 a ARCH-P2-09, ARCH-P3-01 a ARCH-P3-05.

## 7. ADR a creer ou mettre a jour

| ADR existante ou nouvelle | Statut recommande | Raison | Conditions d'acceptation |
|---|---|---|---|
| ADR Runtime Platform Architecture (`ADR-0002`) | Mettre a jour puis `Accepted` apres verification | L'architecture runtime platform est deja largement implementee, mais l'ADR date du cadrage initial. | L'ADR reference les couches actuelles, les modes `files|dual|db-only`, les contrats CLI et les ports existants. |
| ADR Source of Truth Policy (`ADR-0003`) | Garder `Proposed` jusqu'au gate de completude, puis `Accepted` | La policy existe dans docs et code, mais doit etre prouvee sur les commandes cles. | `perf:verify-source-of-truth-policy` et diagnostics runtime consomment la policy. |
| ADR Public CLI JSON Contracts (`ADR-0004`) | Garder `Proposed`, accepter apres extension P0 | Les schemas v1 existent, mais la couverture doit s'etendre aux commandes runtime critiques restantes. | Schemas/golden tests couvrent les commandes stables ciblees et CI dediee. |
| ADR Read-Write CLI Semantics (`ADR-0005`) | Mettre a jour avec effect registry | Les classes d'effet sont definies, mais doivent devenir inventaire executable. | Chaque commande publique a une classe, no implicit write gate actif. |
| ADR Information Model (`ADR-0006`) | Garder `Proposed`, accepter apres rapport de completude | Le modele est present, mais la preuve de completude reste a industrialiser. | Rapport concepts gouvernes avec SoT, metadata, contracts et tests. |
| ADR Local-First Federation Boundary (`ADR-0007`) | Garder `Proposed`, accepter apres boundary gate | La frontiere est claire, mais doit bloquer les extensions non documentees. | Shared surface gate actif, no relocation tests, locator strict. |
| Nouvelle ADR Ports Shared Coordination | Nouvelle, `Proposed` | Le port shared coordination doit devenir le contrat d'extension stable. | Methodes du port documentees, adapters alignes, contrats SQLite/PostgreSQL equivalnts. |
| Nouvelle ADR Release / Versioning / Provenance | Nouvelle, `Proposed` | Version et provenance doivent etre gouvernees entre branche, package et artefacts release. | Source de version unique, manifest release, verifier checksum/version. |

## 8. Premiere sequence d'execution recommandee

1. Inventorier les commandes publiques et leur classe d'effet. C'est le socle pour savoir quelles commandes doivent etre testees comme read-only, preview, projector, mutating ou executor.
2. Identifier les commandes qui ecrivent sans flag explicite. Le focus initial doit etre sur les commandes d'apparence consultative et les projecteurs historiques.
3. Corriger `project-runtime-state` ou introduire une variante read-only. Le chemin minimal est de verrouiller `--dry-run --json` et de documenter le comportement historique.
4. Ajouter un gate de non-ecriture implicite. Ce gate transforme la convention read/write en comportement testable.
5. Etendre les contrats JSON sur les commandes ciblees. Les refactors suivants doivent etre proteges par schemas et golden fixtures.
6. Ajouter les golden outputs pour les commandes P0. Les schemas top-level ne suffisent pas pour detecter les regressions de payload utile.
7. Brancher SoT policy sur les diagnostics runtime manquants. Les commandes doivent expliquer quelle source est canonique et quelle surface est projection.
8. Brancher metadata policy sur les artefacts/digests critiques. Les gaps doivent etre visibles comme findings, pas caches par les projections.
9. Extraire le prochain script runtime trop epais en use case application. Faire une commande par PR, en commencant par celle dont les contrats sont deja stabilises.
10. Scinder les gates CI pour rendre lisibles contrats, effets, gouvernance et perf. Une petite equipe doit pouvoir comprendre vite quel contrat a casse.

## 9. Definition de Done globale

Le plan de correction est bien engage quand:

- aucune commande declaree read-only ou preview ne modifie le checkout ou le runtime local dans les fixtures;
- toutes les commandes critiques ont une classe d'effet documentee et verifiee;
- les sorties JSON critiques ont un schema public sous `src/core/contracts/cli-output/`;
- les sorties JSON critiques ont des golden fixtures sanitisees;
- les policies SoT et metadata sont consommees par les commandes runtime cles;
- chaque concept public critique expose owner, steward, lifecycle_status, source_of_truth et source_mode lorsque pertinent, ou une tolerance legacy explicite;
- les projecteurs runtime critiques passent par un use case application testable hors CLI;
- les tests couvrent les modes `files`, `dual` et `db-only` pour les comportements publics affectes;
- backup/restore/doctor ont au moins un smoke test local et une validation post-restore;
- la frontiere shared runtime/local-first est verifiee par un test de non-deplacement des artefacts checkout-bound;
- `README.md`, ADR, docs runtime et backlog sont alignes;
- `VERSION`, `package.json`, release manifest et checksums suivent une politique de provenance documentee.

## Hypotheses a valider

- Les schemas CLI v1 actuels couvrent les commandes les plus critiques, mais pas necessairement toutes les commandes runtime deja consommees comme API par les utilisateurs.
- `project-runtime-state` et `project-handoff-packet` supportent deja `--dry-run`; il reste a decider si le comportement historique d'ecriture par defaut doit etre deprecie ou simplement documente comme `projector`.
- Les policies SoT/metadata existent et sont partiellement consommees; la couverture exacte doit etre mesuree par un rapport de completude executable.
- `.github/workflows/perf-kpi.yml` contient deja beaucoup de checks utiles; la priorite n'est pas d'en supprimer, mais de rendre les signaux architecturaux plus lisibles.
- Le shared runtime actuel est suffisamment borne pour continuer, mais toute nouvelle surface partagee doit passer par ADR, matrix et tests avant implementation.
