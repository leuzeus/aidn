# Plan de mise a jour workflow depuis projet-source

Date: 2026-03-01
Branche de travail: chore/workflow-upgrade-v0-2 (base origin/dev)

## Objectif
Transferer dans aidn les ameliorations workflow validees dans projet-source, sans remonter les artefacts de projet (cycles/sessions/historique local).

## Resultat de l'inventaire
Comparaison basee sur les fichiers installes par aidn dans projet-source.

- 10 fichiers installes divergent entre aidn et projet-source.
- 1 fichier template absent dans projet-source (`PROJECT_WORKFLOW.md` attendu, remplace par `WORKFLOW.md` instancie).
- Des fichiers workflow supplementaires existent dans projet-source et ne sont pas encore dans aidn (continuity/rule-state/incident scaffold/resume docs).

## Inventaire complet des templates modifies ou nouveaux

### Templates modifies detectes
- `scaffold/root/AGENTS.md` (vs `projet-source/AGENTS.md`) -> CHANGED
- `docs/SPEC.md` (source workflow produit, installe en `docs/audit/SPEC.md`) -> CHANGED
- `scaffold/docs_audit/baseline/current.md` -> CHANGED
- `scaffold/docs_audit/baseline/history.md` -> CHANGED
- `scaffold/docs_audit/cycles/TEMPLATE_STATUS.md` -> CHANGED
- `scaffold/docs_audit/index.md` -> CHANGED
- `scaffold/docs_audit/parking-lot.md` -> CHANGED
- `scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md` -> CHANGED
- `scaffold/docs_audit/snapshots/context-snapshot.md` -> CHANGED
- `scaffold/docs_audit/PROJECT_WORKFLOW.md` -> absent cote projet-source (remplace par `docs/audit/WORKFLOW.md` instancie)
- `scaffold/codex/skills.yaml` (vs `projet-source/.codex/skills.yaml`) -> CHANGED

### Nouveaux templates/docs de support a ajouter dans le pack
- `scaffold/docs_audit/incidents/TEMPLATE_INC_TMP.md` (nouveau)
- `scaffold/docs_audit/CONTINUITY_GATE.md` (nouveau doc support)
- `scaffold/docs_audit/RULE_STATE_BOUNDARY.md` (nouveau doc support)
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md` (nouveau doc support)

### Templates cycles deja alignes (pas de changement detecte)
- `scaffold/docs_audit/cycles/TEMPLATE_audit-spec.md`
- `scaffold/docs_audit/cycles/TEMPLATE_brief.md`
- `scaffold/docs_audit/cycles/TEMPLATE_change-requests.md`
- `scaffold/docs_audit/cycles/TEMPLATE_CYCLE.md`
- `scaffold/docs_audit/cycles/TEMPLATE_decisions.md`
- `scaffold/docs_audit/cycles/TEMPLATE_gap-report.md`
- `scaffold/docs_audit/cycles/TEMPLATE_hypotheses.md`
- `scaffold/docs_audit/cycles/TEMPLATE_plan.md`
- `scaffold/docs_audit/cycles/TEMPLATE_traceability.md`

## Fichiers a reimporter (priorite haute)

### 1) Canonique workflow (adapter puis importer)
- source: `<local-workspace-root>/projet-source/docs/audit/SPEC.md`
- cible: `<local-source-root>/docs/SPEC.md`
- action: importer les regles generalisables (SPEC-R01..SPEC-R11, gates session close/PR/local sync/incident, continuity).

- source: `<local-workspace-root>/projet-source/AGENTS.md`
- cible: `<local-source-root>/scaffold/root/AGENTS.md`
- action: reprendre uniquement les passages generiques du bloc manage (branch ownership session/cycle/intermediate, session close rule, PR gate), sans references repo-specifiques.

- source: `<local-workspace-root>/projet-source/docs/audit/cycles/TEMPLATE_STATUS.md`
- cible: `<local-source-root>/scaffold/docs_audit/cycles/TEMPLATE_STATUS.md`
- action: importer schema state-only + metadonnees continuity.

- source: `<local-workspace-root>/projet-source/docs/audit/sessions/TEMPLATE_SESSION_SXXX.md`
- cible: `<local-source-root>/scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md`
- action: importer sections session continuity + branch context + session close cycle resolution.

### 2) Nouveaux docs de support workflow (import quasi direct)
- source: `<local-workspace-root>/projet-source/docs/audit/CONTINUITY_GATE.md`
- cible proposee: `<local-source-root>/scaffold/docs_audit/CONTINUITY_GATE.md`

- source: `<local-workspace-root>/projet-source/docs/audit/RULE_STATE_BOUNDARY.md`
- cible proposee: `<local-source-root>/scaffold/docs_audit/RULE_STATE_BOUNDARY.md`

- source: `<local-workspace-root>/projet-source/docs/audit/WORKFLOW_SUMMARY.md`
- cible proposee: `<local-source-root>/scaffold/docs_audit/WORKFLOW_SUMMARY.md`

- source: `<local-workspace-root>/projet-source/docs/audit/incidents/TEMPLATE_INC_TMP.md`
- cible proposee: `<local-source-root>/scaffold/docs_audit/incidents/TEMPLATE_INC_TMP.md`

### 3) Ajustements template complementaires (adaptes)
- source: `<local-workspace-root>/projet-source/docs/audit/index.md`
- cible: `<local-source-root>/scaffold/docs_audit/index.md`
- action: ajouter liens vers continuity gate + workflow summary (sans version projet).

- source: `<local-workspace-root>/projet-source/docs/audit/snapshots/context-snapshot.md`
- cible: `<local-source-root>/scaffold/docs_audit/snapshots/context-snapshot.md`
- action: garder format compact (baseline/active cycles/open gaps/top hypotheses/next entry), avec placeholders neutres.

- source: `<local-workspace-root>/projet-source/docs/audit/WORKFLOW.md`
- cible: `<local-source-root>/scaffold/docs_audit/PROJECT_WORKFLOW.md`
- action: extraire uniquement les sections generiques pour enrichir le template adapter (sans contraintes specifique projet-source).

- source: `<local-workspace-root>/projet-source/docs/audit/baseline/current.md`
- cible: `<local-source-root>/scaffold/docs_audit/baseline/current.md`
- action: ne pas recopier le contenu instance; adapter seulement la structure si une evolution de schema est necessaire.

- source: `<local-workspace-root>/projet-source/docs/audit/baseline/history.md`
- cible: `<local-source-root>/scaffold/docs_audit/baseline/history.md`
- action: ne pas recopier l'historique projet; adapter seulement le format/template si utile.

- source: `<local-workspace-root>/projet-source/docs/audit/parking-lot.md`
- cible: `<local-source-root>/scaffold/docs_audit/parking-lot.md`
- action: conserver template neutre (ne pas importer les IDEAs projet), verifier uniquement le schema attendu.

- source: `<local-workspace-root>/projet-source/.codex/skills.yaml`
- cible: `<local-source-root>/scaffold/codex/skills.yaml`
- action: garder la logique versionnee par placeholder (`v{{VERSION}}`), ne pas figer une version.

## Fichiers a ne PAS reimporter (projet-specifiques)
- `<local-workspace-root>/projet-source/docs/audit/WORKFLOW.md` (version instanciee projet-source, trop locale; utiliser seulement comme reference pour enrichir `PROJECT_WORKFLOW.md`).
- `<local-workspace-root>/projet-source/docs/audit/baseline/current.md`
- `<local-workspace-root>/projet-source/docs/audit/baseline/history.md`
- `<local-workspace-root>/projet-source/docs/audit/parking-lot.md`
- `<local-workspace-root>/projet-source/docs/audit/cycles/C*/**`
- `<local-workspace-root>/projet-source/docs/audit/sessions/S*.md`
- `<local-workspace-root>/projet-source/docs/audit/reports/**`
- `<local-workspace-root>/projet-source/docs/audit/migration/**`
- `<local-workspace-root>/projet-source/docs/audit/WORKFLOW_IMPROVEMENT_PLAN.md`

## Option technique a arbitrer (avant implementation)
projet-source ajoute un controle outille de policy workflow:
- `<local-workspace-root>/projet-source/tools/workflowpolicy/main.go`
- `<local-workspace-root>/projet-source/tools/workflowpolicy/main_test.go`
- references dans `Makefile` et `CI provider configuration`

Dans aidn, deux options:
1. ne pas packager cet outillage (doc-only).
2. packager un equivalent portable (Node) dans `tools/` + doc d'integration CI.

## Sequence d'implementation recommandee
1. Uplift canonique: `docs/SPEC.md`.
2. Uplift execution contract: `scaffold/root/AGENTS.md`.
3. Uplift templates: `TEMPLATE_STATUS.md`, `TEMPLATE_SESSION_SXXX.md`, `index.md`, `context-snapshot.md`, `PROJECT_WORKFLOW.md`.
4. Ajout des nouveaux docs (`CONTINUITY_GATE`, `RULE_STATE_BOUNDARY`, `WORKFLOW_SUMMARY`, `incidents/TEMPLATE_INC_TMP`).
5. Mise a jour doc produit (`docs/INSTALL.md`, `docs/TROUBLESHOOTING.md`, `docs/UPGRADE.md`) pour les nouvelles sections/gates.
6. Mise a jour fixtures/tests d'installation pour refleter les nouveaux artefacts installes.
7. Bump version workflow (propose: 0.2.0) + manifests + release notes.

## Risques connus
- Sur-specification: risque de rendre `PROJECT_WORKFLOW.md` trop dense si on y copie du contenu local projet-source.
- Derive de duplication: verifier la precedence SPEC > WORKFLOW > AGENTS.
- Compatibilite ascendante: conserver un mode de migration non destructif pour repos deja installes.

