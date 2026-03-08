# Backlog Architecture Remediation - 2026-03-07

## Objectif

Transformer le plan de remédiation d'architecture en backlog exécutable, structuré en epics et tickets actionnables.

Ce backlog est conçu pour:

- ouvrir des issues
- préparer une roadmap d'exécution
- séquencer les PRs
- suivre les dépendances et les critères d'acceptation

## Règles d'utilisation

1. chaque ticket doit tenir dans une PR reviewable
2. chaque PR doit conserver la surface CLI existante sauf mention explicite
3. chaque PR doit inclure validation fixtures avant fusion
4. aucune PR ne doit mélanger refonte structurelle et changement de règle `SPEC-R01..R11` sauf nécessité explicite
5. les wrappers transitoires sont autorisés, mais doivent être documentés

## Vue D'Ensemble

| Epic | Sujet | Priorité | Dépend de |
|---|---|---:|---|
| E1 | Cadrage et documentation directionnelle | P0 | - |
| E2 | Décomposition du monolithe d'installation | P0 | E1 |
| E3 | Contrats cœur d'architecture | P1 | E2 |
| E4 | Séparation runtime vs observabilité | P1 | E3 |
| E5 | Contrats explicites de state stores | P1 | E4 |
| E6 | Encapsulation Codex et intégrations agent | P1 | E3 |
| E7 | Repackaging produit | P2 | E5, E6 |
| E8 | Validation terrain et corpus réels | P2 | E5, E7 |

## E1 - Cadrage Et Documentation Directionnelle

### E1-T1 - Ajouter l'ADR architecture cible

- priorité: `P0`
- statut cible: `Done`
- livrable: ADR décrivant positionnement runtime-platform, couches, contrats et source de vérité

Critères d'acceptation:

- l'ADR est versionnée dans `docs/ADR/`
- la direction cible n'est plus ambiguë
- la notion de couches `core/application/adapters/distribution` est définie

### E1-T2 - Ajouter le plan de remédiation architecture

- priorité: `P0`
- dépend de: `E1-T1`
- livrable: plan détaillé par PR

Critères d'acceptation:

- la séquence de migration est explicitée
- les risques principaux sont listés
- les critères de succès sont définis

### E1-T3 - Aligner le README sur le positionnement runtime-platform

- priorité: `P0`
- dépend de: `E1-T1`

Critères d'acceptation:

- le `README` ne décrit plus `aidn` comme template-only
- les modes `files|dual|db-only` sont visibles
- les documents d'architecture sont référencés

## E2 - Décomposition Du Monolithe D'Installation

### E2-T1 - Extraire le chargement des manifests

- priorité: `P0`
- dépend de: `E1-T2`
- cible technique:
  - `src/application/install/manifest-loader.mjs`
  - `src/adapters/manifest/yaml-reader.mjs`

Critères d'acceptation:

- `tools/install.mjs` ne parse plus directement les manifests
- les manifests sont chargeables indépendamment de la CLI
- les fixtures d'installation passent sans changement de comportement

### E2-T2 - Extraire la politique de compatibilité

- priorité: `P0`
- dépend de: `E2-T1`
- cible technique:
  - `src/application/install/compatibility-policy.mjs`

Critères d'acceptation:

- validation OS / Node / Codex isolée
- décisions de compatibilité testables sans exécuter l'installation complète

### E2-T3 - Extraire la gestion de `.aidn/config.json`

- priorité: `P0`
- dépend de: `E2-T1`
- cible technique:
  - `src/application/install/project-config-service.mjs`

Critères d'acceptation:

- construction et persistance config isolées
- logique actuelle conservée
- fallback env/config inchangé

### E2-T4 - Extraire copy/merge templates

- priorité: `P0`
- dépend de: `E2-T1`
- cible technique:
  - `src/application/install/template-copy-service.mjs`
  - `src/application/install/template-merge-service.mjs`

Critères d'acceptation:

- copie et merge ne vivent plus dans `tools/install.mjs`
- les stratégies `block` et `append_unique` restent identiques

### E2-T5 - Extraire la politique de fichiers custom

- priorité: `P0`
- dépend de: `E2-T4`
- cible technique:
  - `src/application/install/custom-file-policy.mjs`

Critères d'acceptation:

- la logique "preserve customized files" est isolée
- les patterns personnalisables sont centralisés
- la décision ne dépend pas implicitement du flux principal d'installation

### E2-T6 - Réduire `tools/install.mjs` à un wrapper transitoire

- priorité: `P0`
- dépend de: `E2-T2`, `E2-T3`, `E2-T4`, `E2-T5`

Critères d'acceptation:

- `tools/install.mjs` devient majoritairement orchestration fine
- aucune logique métier lourde ne reste dans le fichier
- les commandes actuelles continuent de fonctionner

## E3 - Contrats Cœur D'Architecture

### E3-T1 - Définir `WorkflowStateStore`

- priorité: `P1`
- dépend de: `E2-T6`
- cible technique:
  - `src/core/ports/workflow-state-store.mjs`

Critères d'acceptation:

- contrat documenté
- opérations minimales définies: load, persist, listArtifacts, getArtifact
- utilisable par `files`, `dual`, `db-only`

### E3-T2 - Définir `ArtifactProjector`

- priorité: `P1`
- dépend de: `E3-T1`

Critères d'acceptation:

- projection full et incremental définies
- rebuild `docs/audit` depuis état canonique prévu par contrat

### E3-T3 - Définir `HookContextStore`

- priorité: `P1`
- dépend de: `E3-T1`

Critères d'acceptation:

- contrat de persistance des payloads hooks défini
- exposition de l'historique et des décisions normalisées prévue

### E3-T4 - Définir `AgentAdapter`

- priorité: `P1`
- dépend de: `E3-T3`

Critères d'acceptation:

- intégration agent rendue optionnelle par contrat
- aucune référence Codex nécessaire dans le cœur

### E3-T5 - Définir `VcsAdapter`

- priorité: `P1`
- dépend de: `E3-T1`

Critères d'acceptation:

- lecture branche / HEAD / divergence encapsulée
- le cœur runtime n'appelle plus git directement à terme

### E3-T6 - Formaliser les modes d'état dans `core/state`

- priorité: `P1`
- dépend de: `E3-T1`

Critères d'acceptation:

- la sémantique `files|dual|db-only` est codée en un seul endroit
- les règles de source de vérité sont explicites et testables

## E4 - Séparation Runtime Vs Observabilité

### E4-T1 - Extraire `checkpoint` en use case applicatif

- priorité: `P1`
- dépend de: `E3-T6`
- cible technique:
  - `src/application/runtime/checkpoint-use-case.mjs`

Critères d'acceptation:

- l'orchestration checkpoint n'est plus script-centric
- les scripts actuels deviennent wrappers

### E4-T2 - Extraire `workflow-hook` en use case applicatif

- priorité: `P1`
- dépend de: `E4-T1`
- cible technique:
  - `src/application/runtime/hook-use-case.mjs`

Critères d'acceptation:

- `tools/perf/workflow-hook.mjs` devient fin
- la séquence runtime vit hors CLI

### E4-T3 - Extraire la vérification de parité runtime

- priorité: `P1`
- dépend de: `E4-T1`
- cible technique:
  - `src/application/runtime/parity-verify-use-case.mjs`

Critères d'acceptation:

- la logique de parité n'est plus mélangée à la CLI ou au reporting

### E4-T4 - Déplacer la collecte et les rapports KPI dans `application/observability`

- priorité: `P1`
- dépend de: `E4-T1`

Critères d'acceptation:

- collecte NDJSON, rapports, checks de seuils et résumés ne pilotent plus directement le runtime
- séparation claire entre moteur et observabilité

## E5 - Contrats Explicites De State Stores

### E5-T1 - Implémenter `FileWorkflowStateStore`

- priorité: `P1`
- dépend de: `E3-T1`, `E4-T2`
- cible technique:
  - `src/adapters/filesystem/file-workflow-state-store.mjs`

Critères d'acceptation:

- lecture/écriture canonique depuis fichiers disponible via contrat

### E5-T2 - Implémenter `DbWorkflowStateStore`

- priorité: `P1`
- dépend de: `E3-T1`, `E4-T2`
- cible technique:
  - `src/adapters/sqlite/db-workflow-state-store.mjs`

Critères d'acceptation:

- lecture/écriture canonique DB disponible via contrat
- support des artefacts normatifs et support

### E5-T3 - Implémenter le coordinateur `DualWorkflowStateStore`

- priorité: `P1`
- dépend de: `E5-T1`, `E5-T2`

Critères d'acceptation:

- source DB explicite
- projection fichiers obligatoire en `dual`
- comportement hybride implicite interdit

### E5-T4 - Brancher `ArtifactProjector` sur rebuild et projection

- priorité: `P1`
- dépend de: `E3-T2`, `E5-T1`, `E5-T2`

Critères d'acceptation:

- export DB -> fichiers utilise le même contrat que la projection courante
- rebuild full et projection incremental passent par le même composant

### E5-T5 - Extraire `mode-migrate` en use case applicatif

- priorité: `P1`
- dépend de: `E5-T3`, `E5-T4`

Critères d'acceptation:

- migrations `files -> dual -> db-only -> files` passent par les contrats de state store

## E6 - Encapsulation Codex Et Intégrations Agent

### E6-T1 - Extraire la migration custom Codex en adaptateur

- priorité: `P1`
- dépend de: `E2-T5`, `E3-T4`
- cible technique:
  - `src/adapters/codex/codex-migrate-custom.mjs`

Critères d'acceptation:

- aucune dépendance Codex directe dans la logique générique d'installation

### E6-T2 - Brancher `run-json-hook` sur `AgentAdapter`

- priorité: `P1`
- dépend de: `E3-T4`

Critères d'acceptation:

- l'exécution de hooks JSON n'impose plus Codex au cœur applicatif

### E6-T3 - Brancher `hydrate-context` sur `HookContextStore` + `WorkflowStateStore`

- priorité: `P1`
- dépend de: `E3-T3`, `E5-T2`

Critères d'acceptation:

- hydratation contexte dépend des contrats et non d'un chemin script ad hoc

## E7 - Repackaging Produit

### E7-T1 - Réévaluer `packs/core` et `packs/extended`

- priorité: `P2`
- dépend de: `E5-T5`, `E6-T3`

Critères d'acceptation:

- `extended` n'est plus vide ou est supprimé
- frontières de packs justifiées

### E7-T2 - Introduire `runtime-local` si pertinent

- priorité: `P2`
- dépend de: `E7-T1`

Critères d'acceptation:

- runtime local packagé explicitement
- install plus lisible pour l'utilisateur

### E7-T3 - Introduire `codex-integration` si pertinent

- priorité: `P2`
- dépend de: `E6-T3`, `E7-T1`

Critères d'acceptation:

- intégration agent rendue installable / optionnelle explicitement

### E7-T4 - Mettre à jour scripts package et docs de packaging

- priorité: `P2`
- dépend de: `E7-T2`, `E7-T3`

Critères d'acceptation:

- les scripts package reflètent la nouvelle surface produit
- la doc d'installation est alignée

## E8 - Validation Terrain Et Corpus Réels

### E8-T1 - Définir le corpus cible réel

- priorité: `P2`
- dépend de: `E5-T5`

Critères d'acceptation:

- 3 à 5 types de repos cibles identifiés
- scénarios critiques documentés

### E8-T2 - Ajouter les scénarios de migration inter-modes

- priorité: `P2`
- dépend de: `E5-T5`

Critères d'acceptation:

- `files -> dual`
- `dual -> db-only`
- `db-only -> files`
- validations reproductibles

### E8-T3 - Ajouter les scénarios d'installation customisée

- priorité: `P2`
- dépend de: `E2-T6`, `E6-T1`

Critères d'acceptation:

- couverture des cas avec fichiers custom préexistants
- couverture avec et sans Codex disponible

### E8-T4 - Valider la parité runtime sur corpus réel

- priorité: `P2`
- dépend de: `E8-T2`

Critères d'acceptation:

- équivalence de décision `dual` vs `db-only`
- rebuild sans perte
- absence de fallback silencieux non expliqué

## Board Recommandé

Colonnes recommandées:

1. `Backlog`
2. `Ready`
3. `In Progress`
4. `In Review`
5. `Blocked`
6. `Done`

## Définition De Ready

Un ticket est `Ready` si:

- son périmètre tient dans une PR
- ses dépendances sont terminées
- ses critères d'acceptation sont écrits
- la validation attendue est identifiée

## Définition De Done

Un ticket est `Done` si:

- le code ou la doc cible est livré
- les tests ou vérifications associées passent
- les wrappers transitoires sont documentés si présents
- aucun drift de positionnement produit n'est introduit

## Jalons Recommandés

### Milestone M1 - Direction Et Décompression Initiale

Contenu:

- E1 complet
- E2-T1 à E2-T3

Résultat attendu:

- direction figée
- réduction du premier point de concentration

### Milestone M2 - Décomposition Install Complète

Contenu:

- E2-T4 à E2-T6

Résultat attendu:

- `tools/install.mjs` n'est plus un monolithe métier

### Milestone M3 - Contrats Noyau

Contenu:

- E3 complet

Résultat attendu:

- interfaces structurantes disponibles

### Milestone M4 - Runtime Séparé

Contenu:

- E4 complet

Résultat attendu:

- moteur runtime séparé de l'observabilité

### Milestone M5 - State Stores Explicites

Contenu:

- E5 complet

Résultat attendu:

- source de vérité maîtrisée par mode

### Milestone M6 - Intégration Agent Encapsulée

Contenu:

- E6 complet

Résultat attendu:

- Codex traité comme adaptateur

### Milestone M7 - Packaging Aligné

Contenu:

- E7 complet

Résultat attendu:

- surface produit cohérente avec l'architecture

### Milestone M8 - Validation Terrain

Contenu:

- E8 complet

Résultat attendu:

- confiance sur corpus réels, pas seulement fixtures
