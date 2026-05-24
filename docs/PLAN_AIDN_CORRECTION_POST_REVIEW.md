# Plan de correction post-revue EA/IA

Ce document transforme la dernière revue d'architecture en plan de correction exécutable.

Contexte de lecture:
- le socle architectural est réel et déjà largement cohérent;
- le problème restant est la parité entre la doctrine publique et le comportement exécutable;
- l'objectif est de corriger les écarts confirmés avant d'étendre la surface.

Statut d'exécution actuel:
- `P0-01` alignement de `project-runtime-state` livré sur `dev`
- `P0-02` alignement de `project-handoff-packet` livré sur `dev`
- `P0-03` gate `perf:verify-cli-surface-parity` livré et branché en CI
- `P0-04` complétion de `source-of-truth-policy` livrée sur `dev`, avec couverture explicite et statuts `covered / subsumed`
- `P1-01` `baseline` et `snapshot` sont désormais classés comme artefacts locaux gouvernés, hors partage implicite
- `P1-04` la surface CLI est maintenant classée en `stable`, `advanced`, `experimental` et `internal`
- `P2-01` la provenance release est maintenant vérifiée contre les fingerprints source et le commit HEAD
- `P2-02` un baseline sécurité CI minimal est maintenant branché via un workflow dédié
- les lots suivants du backlog restent à dérouler à partir de cette base stabilisée

## 1. Résumé du diagnostic

AIDN n'est plus un simple pack de templates. La branche `dev` expose déjà une plateforme locale de gouvernance de workflow assisté par IA avec:
- un CLI public;
- des modes runtime `files`, `dual` et `db-only`;
- des contrats JSON publics;
- des politiques de source de vérité et de métadonnées;
- des surfaces de coordination partagée opt-in;
- des ADR structurantes;
- des gates CI dédiés;
- une documentation de surface et d'exploitation.

Le socle est donc solide. Les écarts restants ne portent pas sur l'absence d'architecture, mais sur l'alignement entre:
- la documentation publique;
- les ADR;
- l'inventaire CLI;
- les politiques d'effet;
- les scripts runtime;
- les contrats JSON;
- les gates CI.

Le problème principal est maintenant la parité d'exécution:
- certaines surfaces publiques sont encore décrites plus largement que ce que le runtime garantit réellement;
- certaines intentions sont codées, mais pas encore séparées de manière assez explicite;
- certaines politiques existent, mais ne couvrent pas encore tous les concepts gouvernés;
- certaines sorties JSON sont déjà utiles, mais pas encore suffisamment rigides pour servir de contrat durable.

La priorité est donc de corriger avant d'étendre:
- stabiliser la sémantique publique;
- rendre les mutations explicites;
- rendre la synchronisation partagée explicite;
- aligner docs, policies, scripts et gates;
- ne pas ajouter de fonctionnalités tant que la surface critique n'est pas vérifiable de bout en bout.

## 2. Écarts confirmés

| ID | Écart | Preuve dans le code ou la documentation | Risque | Priorité | Fichiers concernés | Décision proposée |
|---|---|---|---|---|---|---|
| E-01 | Parité CLI incomplète sur les commandes runtime sensibles | `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs`, `bin/aidn.mjs`, `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs` | Divergence entre doctrine publique et comportement exécutable | P0 | `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs`, `bin/aidn.mjs`, `tools/runtime/project-runtime-state.mjs`, `tools/runtime/project-handoff-packet.mjs` | Aligner la surface publique et la politique d'effet, puis verrouiller par gate |
| E-02 | `project-handoff-packet` mélange encore projection locale et sync partagée sous une même intention | Le wrapper supporte `--write`, mais pas encore un séparateur public explicite pour la sync relay | Mutations involontaires, confusion sur la frontière local/shared | P0 | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/*`, `src/core/ports/*` | Séparer lecture, projection locale et synchronisation relay avec intention explicite |
| E-03 | La policy de source of truth ne couvre pas tous les concepts gouvernés attendus | `src/core/source-of-truth/source-of-truth-policy.mjs` ne couvre pas `decision`, `incident`, `baseline`, `snapshot`, etc. | Trous de gouvernance et diagnostics incomplets | P0 | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs`, `docs/ADR/ADR-0003-source-of-truth-policy.md` | Compléter ou exclure formellement les concepts manquants |
| E-04 | `baseline` et `snapshot` n'ont pas encore de statut informationnel clarifié | `src/core/metadata/metadata-policy.mjs` et `src/core/source-of-truth/source-of-truth-policy.mjs` ne donnent pas de décision explicite | Ambiguïté sémantique sur le cycle de vie et la source de vérité | P1 | `src/core/metadata/metadata-policy.mjs`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | Les subsumer comme artefacts gouvernés ou leur donner un statut explicite, avec justification |
| E-05 | Les contrats JSON critiques restent partiellement extensibles sur des objets imbriqués | `src/core/contracts/cli-output/*` et fixtures associées | Contrats trop souples pour les intégrations externes | P0 | `src/core/contracts/cli-output/*`, `tools/perf/*` | Durcir progressivement ou préparer des v2 compatibles |
| E-06 | Il manque un gate de parité de surface publique | Pas de gate unique comparant docs, policy, scripts et contrats | Les écarts peuvent réapparaître silencieusement | P0 | `package.json`, `tools/perf/*`, `.github/workflows/*.yml` | Ajouter `perf:verify-cli-surface-parity` et l'exécuter en CI |
| E-07 | `governance-diagnostics` n'expose pas encore un cockpit complet de couverture informationnelle | Le use case couvre déjà une partie de la gouvernance, mais pas un statut complet `covered / partial / missing / excluded` pour tous les concepts visés | Diagnostics moins actionnables qu'ils ne pourraient l'être | P1 | `tools/runtime/governance-diagnostics.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs` | Ajouter une cartographie de couverture par concept et par policy |
| E-08 | La classification de la surface CLI reste trop binaire | `docs/CLI_SURFACE_INVENTORY.md` distingue surtout stable et internal | Sur-présentation de certaines commandes comme stables | P1 | `docs/CLI_SURFACE_INVENTORY.md`, `README.md` | Classer `stable / advanced / experimental / internal` |
| E-09 | La release/provenance peut encore être renforcée par une base sécurité minimale | `tools/build-release.mjs`, `package.json`, `docs/ADR/ADR-0009-release-versioning-provenance.md`, `.github/workflows/release.yml` | Chaîne de release correcte mais pas encore assez défensive | P2 | `tools/build-release.mjs`, `package.json`, `.github/workflows/release.yml`, `docs/ADR/ADR-0009-release-versioning-provenance.md` | Ajouter un minimum de contrôle sécurité et de preuve de provenance |

## 3. Backlog priorisé

### P0

| ID | Titre | Description | Fichiers probables | Critères d'acceptation | Tests/gates à ajouter | Risques | Taille | Dépendances |
|---|---|---|---|---|---|---|---|---|
| P0-01 | Aligner `project-runtime-state` avec la sémantique publique | Vérifier que `--json` est bien read-only, que l'écriture locale passe uniquement par `--write`, et que la politique d'effet, le CLI et la doc disent la même chose | `tools/runtime/project-runtime-state.mjs`, `bin/aidn.mjs`, `src/core/cli/effect-policy.mjs`, `README.md`, `docs/CLI_SURFACE_INVENTORY.md` | Aucune mutation implicite; `--json` ne déclenche pas d'écriture; `--write` est explicite | `perf:verify-cli-surface-parity`, `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts` | Casser des usages anciens qui supposaient une écriture implicite | S | E-01, E-06 |
| P0-02 | Aligner `project-handoff-packet` avec la sémantique publique | Séparer lecture, projection locale et sync relay; clarifier si `--write` couvre encore la projection locale seule ou s'il faut introduire `--sync-relay` | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/*`, `src/core/ports/*`, `README.md`, `docs/CLI_SURFACE_INVENTORY.md` | Lecture seule sans mutation; projection locale explicite; sync partagée explicite et opt-in | `perf:verify-cli-surface-parity`, `perf:verify-handoff-packet`, `perf:verify-cli-no-implicit-write` | Toucher la frontière local/shared runtime | M | E-01, E-02, E-06 |
| P0-03 | Créer le gate `public-surface-parity` | Ajouter un gate qui compare README, inventaire CLI, effect-policy, wrappers runtime, contrats et fixtures | `package.json`, `tools/perf/verify-cli-surface-parity.mjs`, `.github/workflows/cli-contracts.yml`, `.github/workflows/governance.yml` | Le gate échoue dès qu'une doc, une policy ou un script diverge | `perf:verify-cli-surface-parity` | Faux positifs si la surface publique n'est pas classée clairement | M | E-01, E-06 |
| P0-04 | Compléter la `source-of-truth-policy` | Ajouter ou exclure formellement `decision`, `incident`, `coordination_summary`, `coordination_log`, `user_arbitration`, `baseline`, `snapshot` | `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs`, `docs/ADR/ADR-0003-source-of-truth-policy.md` | Chaque concept est soit gouverné explicitement, soit subsumé, soit exclu avec raison | `perf:verify-source-of-truth-policy`, `perf:verify-governance-completeness`, `perf:verify-governance-diagnostics-use-case` | Surétendre trop vite le modèle | M | E-03 |
| P0-05 | Durcir les contrats JSON critiques | Cibler `project-runtime-state`, `project-handoff-packet`, `pre-write-admit`, `handoff-admit`, `governance-diagnostics` | `src/core/contracts/cli-output/*`, `tools/perf/*` | Les sorties JSON permettent d'identifier clairement lecture, écriture, source-of-truth, mode runtime, lifecycle et sync | `perf:verify-cli-output-contracts`, fixtures golden dédiées | Casser une intégration externe si le durcissement est trop brutal | M | E-05 |
| P0-06 | Ajouter les golden fixtures de non-mutation | Prouver qu'une commande read-only ou preview ne modifie jamais le checkout | `tools/perf/*`, `tests/fixtures/*` | Fixtures couvrant lecture seule, écriture explicite, erreurs SoT, erreurs metadata, et absence de mutation | `perf:verify-cli-no-implicit-write`, `perf:verify-state-mode-parity` | Flakiness si les fixtures capturent trop d'état local | S | P0-01, P0-02 |

### P1

| ID | Titre | Description | Fichiers probables | Critères d'acceptation | Tests/gates à ajouter | Risques | Taille | Dépendances |
|---|---|---|---|---|---|---|---|---|
| P1-01 | Clarifier `baseline` et `snapshot` | Décider si ce sont des artefacts gouvernés, des états de gouvernance, ou des concepts subsumés | `src/core/metadata/metadata-policy.mjs`, `src/core/source-of-truth/source-of-truth-policy.mjs`, `docs/ADR/ADR-0006-information-model.md` | Une décision documentée et alignée dans les policies | `perf:verify-governance-completeness`, `perf:verify-metadata-policy` | Réouvrir trop tôt le modèle informationnel | S | P0-04 |
| P1-02 | Découpler projection locale et sync partagée dans le handoff | Extraire clairement la projection locale du handoff et la synchronisation shared runtime | `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/*`, `src/core/ports/*` | La sync shared passe par un port explicite et une intention explicite | `perf:verify-handoff-packet`, `perf:verify-shared-coordination-sync`, `perf:verify-cli-surface-parity` | Régression sur les modes `files / dual / db-only` | M | P0-02 |
| P1-03 | Renforcer `governance-diagnostics` | Produire un statut de couverture par concept: `complete / partial / missing / explicitly-excluded` | `tools/runtime/governance-diagnostics.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs` | Les trous de gouvernance sont immédiatement visibles | `perf:verify-governance-diagnostics-use-case`, `perf:verify-governance-completeness` | Ajouter trop de logique dans le CLI wrapper | M | P0-04 |
| P1-04 | Classer la surface CLI | Introduire `stable / advanced / experimental / internal` | `docs/CLI_SURFACE_INVENTORY.md`, `README.md` | Les commandes non consolidées ne sont plus présentées comme stables | `perf:verify-cli-surface-parity`, `perf:verify-cli-surface-inventory` | Confusion documentaire temporaire | S | P0-03 |

### P2

| ID | Titre | Description | Fichiers probables | Critères d'acceptation | Tests/gates à ajouter | Risques | Taille | Dépendances |
|---|---|---|---|---|---|---|---|---|
| P2-01 | Renforcer release/provenance | Ajouter une base sécurité minimale et vérifier plus explicitement le flux release | `tools/build-release.mjs`, `package.json`, `.github/workflows/release.yml`, `docs/ADR/ADR-0009-release-versioning-provenance.md` | Release vérifiable, manifest cohérent, contrôle sécurité minimal | `perf:verify-release-flow`, `perf:verify-release-version`, `perf:verify-release-artifacts` | Alourdir le flux de publication | S | aucun |
| P2-02 | Ajouter un baseline sécurité CI | Ajouter un minimum de garde-fous de sécurité sans rendre PostgreSQL obligatoire | `.github/workflows/*.yml`, `package.json` | Un échec CI signale une dérive de base sans bloquer le local-first | gates sécurité ciblés | Faux positifs si les règles sont trop larges | M | P2-01 |

### P3

| ID | Titre | Description | Fichiers probables | Critères d'acceptation | Tests/gates à ajouter | Risques | Taille | Dépendances |
|---|---|---|---|---|---|---|---|---|
| P3-01 | Réduire encore la dispersion documentaire | Fusionner ou archiver ce qui redonde sans perdre l'historique utile | `docs/README.md`, `docs/ARCHITECTURE_COCKPIT.md`, `README.md` | Navigation plus simple, historique conservé | `perf:verify-markdown-contract` | Risque de sur-compression documentaire | S | aucun |

## 4. Plan de PR recommandé

### PR 1
- But: reproduire et figer les écarts sans correction lourde.
- Fichiers: `tools/perf/*`, `tests/fixtures/*`, `docs/CLI_SURFACE_INVENTORY.md`, `README.md`.
- Changements attendus: fixtures de reproduction, capture des écarts actuels, aucune mutation métier.
- Tests: `perf:verify-cli-no-implicit-write`, `perf:verify-handoff-packet`, `perf:verify-cli-output-contracts`.
- DoD: les écarts sont démontrés et documentés.
- Risques: aucune correction effective si les fixtures sont trop permissives.

### PR 2
- But: corriger `project-runtime-state`.
- Fichiers: `tools/runtime/project-runtime-state.mjs`, `src/core/cli/effect-policy.mjs`, `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, fixtures associées.
- Changements attendus: `--json` read-only garanti, `--write` explicite, docs alignées.
- Tests: `perf:verify-cli-surface-parity`, `perf:verify-cli-no-implicit-write`, `perf:verify-cli-output-contracts`.
- DoD: aucune écriture implicite n'est possible sur cette surface.
- Risques: casser un usage local qui dépendait de l'ancien comportement.

### PR 3
- But: corriger `project-handoff-packet`.
- Fichiers: `tools/runtime/project-handoff-packet.mjs`, `src/application/runtime/*`, `src/core/ports/*`, `src/core/cli/effect-policy.mjs`.
- Changements attendus: séparation lecture / projection / sync, intention explicite pour la sync shared.
- Tests: `perf:verify-handoff-packet`, `perf:verify-cli-surface-parity`, `perf:verify-shared-coordination-sync`.
- DoD: projection locale et sync relay ne sont plus confondues.
- Risques: complexité d'implémentation si la sync est encore trop mêlée au flux principal.

### PR 4
- But: créer le gate `perf:verify-cli-surface-parity`.
- Fichiers: `package.json`, `tools/perf/verify-cli-surface-parity.mjs`, workflow CI.
- Changements attendus: un gate unique pour docs, policy, bin et scripts runtime.
- Tests: le nouveau gate lui-même, plus les suites ciblées.
- DoD: une divergence de surface publique casse la CI.
- Risques: faux positifs initiaux si les sources de vérité ne sont pas bien définies.

### PR 5
- But: compléter `source-of-truth-policy` et `metadata-policy`.
- Fichiers: `src/core/source-of-truth/source-of-truth-policy.mjs`, `src/core/metadata/metadata-policy.mjs`, `docs/ADR/ADR-0003-source-of-truth-policy.md`, `docs/ADR/ADR-0006-information-model.md`.
- Changements attendus: couverture des concepts manquants, décision explicite pour `baseline` et `snapshot`.
- Tests: `perf:verify-source-of-truth-policy`, `perf:verify-metadata-policy`, `perf:verify-governance-completeness`.
- DoD: aucun concept gouverné important ne reste implicitement hors politique.
- Risques: sur-modélisation.

### PR 6
- But: durcir les contrats JSON critiques et les fixtures golden.
- Fichiers: `src/core/contracts/cli-output/*`, `tools/perf/*`, fixtures.
- Changements attendus: champs explicites sur lecture, écriture, source-of-truth, lifecycle, mode runtime et sync.
- Tests: `perf:verify-cli-output-contracts`, `perf:verify-cli-no-implicit-write`.
- DoD: les sorties critiques deviennent prédictibles et vérifiables.
- Risques: casse de compatibilité externe si le durcissement n'est pas progressif.

### PR 7
- But: enrichir `governance-diagnostics`.
- Fichiers: `tools/runtime/governance-diagnostics.mjs`, `src/application/runtime/governance-diagnostics-use-case.mjs`.
- Changements attendus: cockpit de couverture informationnelle avec statut par concept.
- Tests: `perf:verify-governance-diagnostics-use-case`, `perf:verify-governance-completeness`.
- DoD: on peut identifier rapidement les trous de gouvernance.
- Risques: complexité de lecture si le diagnostic devient trop verbeux.

### PR 8
- But: renforcer release/provenance et poser un baseline sécurité minimal.
- Fichiers: `tools/build-release.mjs`, `package.json`, `.github/workflows/release.yml`, docs ADR 0009.
- Changements attendus: preuve de provenance plus claire, contrôle sécurité de base, flux release aligné.
- Tests: `perf:verify-release-flow`, `perf:verify-release-version`, `perf:verify-release-artifacts`.
- DoD: la release est vérifiable sans alourdir le local-first.
- Risques: surcharge du pipeline si le contrôle sécurité est trop ambitieux.

## 5. ADR à mettre à jour ou créer

### ADR-0004 - Public CLI JSON Contracts
- Décision à prendre: durcir progressivement les objets imbriqués critiques sans casser le v1.
- Raison: les contrats publics doivent pouvoir servir d'engagement durable.
- Alternatives: garder les schémas souples ou passer tout de suite à un v2.
- Conséquences: compatibilité mieux maîtrisée, mais besoin de fixtures golden.
- Critères d'acceptation: les champs critiques sont explicitement cadrés et testés.

### ADR-0005 - Read/Write CLI Semantics
- Décision à prendre: formaliser qu'un effet sensible exige une intention explicite.
- Raison: `--json` ne doit jamais signifier mutation.
- Alternatives: laisser la mutation implicite sur certaines commandes; ce n'est plus souhaitable.
- Conséquences: plus de clarté, moins d'ambiguïté publique.
- Critères d'acceptation: `--write` ou équivalent explicite est nécessaire pour toute écriture locale.

### ADR-0006 - Information Model
- Décision à prendre: compléter le modèle pour les concepts encore ambigus.
- Raison: la gouvernance ne peut pas rester partiellement implicite.
- Alternatives: subsumer certains concepts sous `artifact`; le document doit trancher explicitement.
- Conséquences: meilleure cohérence entre metadata, SoT et diagnostics.
- Critères d'acceptation: chaque concept gouverné a un statut clair.

### ADR-0008 - Shared Coordination Ports
- Décision à prendre: toute sync shared doit passer par un port explicite.
- Raison: la frontière local-first/shared runtime doit rester nette.
- Alternatives: écriture dispersée directe; à éviter.
- Conséquences: meilleure testabilité et moindre dérive de frontière.
- Critères d'acceptation: la synchronisation partagée n'est plus implicite.

### ADR-0009 - Release Versioning Provenance
- Décision à prendre: maintenir un flux release atomique et vérifiable.
- Raison: le produit doit prouver sa provenance de façon simple.
- Alternatives: publication manuelle ou flux morcelé; à éviter.
- Conséquences: release plus robuste, légère hausse de complexité.
- Critères d'acceptation: version, manifeste, checksums et artefacts concordent.

### Nouvelle ADR - Public Surface Parity
- Décision à prendre: la doc publique, la policy d'effet et le runtime doivent rester alignés.
- Raison: la divergence de surface est un risque architectural récurrent.
- Alternatives: gate partiel; insuffisant.
- Conséquences: une divergence devient bloquante tôt.
- Critères d'acceptation: un gate unique protège la surface publique.

### Nouvelle ADR - Runtime Projectors and Shared Sync Separation
- Décision à prendre: distinguer explicitement lecture, projection locale et sync partagée.
- Raison: le handoff mélange encore deux intentions publiques.
- Alternatives: garder `--write` comme conteneur de tout; trop ambigu.
- Conséquences: meilleure lisibilité des effets, meilleure protection local-first.
- Critères d'acceptation: la séparation est visible dans le CLI, les scripts et les fixtures.

## 6. Definition of Done globale

Le redressement est considéré terminé seulement si:
- `README.md`, `docs/CLI_SURFACE_INVENTORY.md`, `src/core/cli/effect-policy.mjs` et les scripts runtime disent la même chose;
- aucune commande read-only ou preview ne modifie le checkout;
- `--json` ne provoque aucune écriture implicite;
- toute écriture locale est explicite;
- toute synchronisation shared runtime est explicite;
- les concepts gouvernés ont des politiques de source-of-truth et de métadonnées alignées;
- les contrats JSON critiques sont versionnés et testés;
- les golden fixtures prouvent les comportements principaux;
- `governance-diagnostics` expose les trous de gouvernance;
- la frontière local-first/shared runtime est protégée par tests;
- les gates CI échouent en cas de divergence de surface publique;
- les ADR reflètent le comportement réel du produit.

## Hypothèses à valider pendant l'exécution

- `project-runtime-state` est déjà read-only par défaut, mais il faut vérifier que cette sémantique est verrouillée partout.
- `project-handoff-packet` a encore besoin d'une séparation explicite entre projection locale et sync shared.
- `decision`, `incident`, `coordination_summary`, `coordination_log` et `user_arbitration` doivent être gouvernés explicitement.
- `baseline` et `snapshot` doivent probablement être subsumés comme artefacts gouvernés, sauf preuve contraire.
- les contrats JSON peuvent être durcis de manière progressive sans casser les intégrations.
- le gate `public-surface-parity` est le meilleur mécanisme pour empêcher une nouvelle dérive documentaire.

## Première séquence d'exécution

1. Reproduire l'état réel de `project-runtime-state` et `project-handoff-packet` avec fixtures minimales.
2. Confirmer la parité entre README, inventaire CLI, effect-policy et bin loader.
3. Ajouter le gate `perf:verify-cli-surface-parity`.
4. Corriger `project-runtime-state` si un écart subsiste encore.
5. Corriger `project-handoff-packet` pour séparer lecture, projection et sync.
6. Compléter la `source-of-truth-policy` pour les concepts manquants.
7. Trancher le statut de `baseline` et `snapshot` dans le modèle informationnel.
8. Durcir les contrats JSON critiques et leurs fixtures golden.
9. Enrichir `governance-diagnostics` avec un statut de couverture par concept.
10. Classer la surface CLI en `stable / advanced / experimental / internal`.
11. Ajouter le baseline sécurité CI minimal.
12. Mettre à jour les ADR concernées pour refléter l'état réel.
