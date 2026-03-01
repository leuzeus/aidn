# Plan de mise a jour workflow depuis projet-source

Date: 2026-03-01
Branche de travail: chore/workflow-upgrade-v0-2 (base origin/dev)

## Objectif
Transferer dans aidn les ameliorations workflow validees dans projet-source, sans remonter les artefacts de projet (cycles/sessions/historique local).

## Resultat de l'inventaire
Comparaison basee sur les fichiers installes par aidn dans projet-source.

- 10 fichiers installes divergent entre aidn et projet-source.
- 1 fichier template absent dans projet-source (`PROJECT_WORKFLOW.md` attendu, remplace par `WORKFLOW.md` instancie).
- Des fichiers workflow supplementaires existent dans projet-source et ne sont pas encore dans aidn (continuity/rule-state/incident template/resume docs).

## Inventaire complet des templates modifies ou nouveaux

### Templates modifies detectes
- `template/root/AGENTS.md` (vs `projet-source/AGENTS.md`) -> CHANGED
- `docs/SPEC.md` (source workflow produit, installe en `docs/audit/SPEC.md`) -> CHANGED
- `template/docs_audit/baseline/current.md` -> CHANGED
- `template/docs_audit/baseline/history.md` -> CHANGED
- `template/docs_audit/cycles/TEMPLATE_STATUS.md` -> CHANGED
- `template/docs_audit/index.md` -> CHANGED
- `template/docs_audit/parking-lot.md` -> CHANGED
- `template/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md` -> CHANGED
- `template/docs_audit/snapshots/context-snapshot.md` -> CHANGED
- `template/docs_audit/PROJECT_WORKFLOW.md` -> absent cote projet-source (remplace par `docs/audit/WORKFLOW.md` instancie)
- `template/codex/skills.yaml` (vs `projet-source/.codex/skills.yaml`) -> CHANGED

### Nouveaux templates/docs de support a ajouter dans le pack
- `template/docs_audit/incidents/TEMPLATE_INC_TMP.md` (nouveau)
- `template/docs_audit/CONTINUITY_GATE.md` (nouveau doc support)
- `template/docs_audit/RULE_STATE_BOUNDARY.md` (nouveau doc support)
- `template/docs_audit/WORKFLOW_SUMMARY.md` (nouveau doc support)

### Templates cycles deja alignes (pas de changement detecte)
- `template/docs_audit/cycles/TEMPLATE_audit-spec.md`
- `template/docs_audit/cycles/TEMPLATE_brief.md`
- `template/docs_audit/cycles/TEMPLATE_change-requests.md`
- `template/docs_audit/cycles/TEMPLATE_CYCLE.md`
- `template/docs_audit/cycles/TEMPLATE_decisions.md`
- `template/docs_audit/cycles/TEMPLATE_gap-report.md`
- `template/docs_audit/cycles/TEMPLATE_hypotheses.md`
- `template/docs_audit/cycles/TEMPLATE_plan.md`
- `template/docs_audit/cycles/TEMPLATE_traceability.md`

## Fichiers a reimporter (priorite haute)

### 1) Canonique workflow (adapter puis importer)
- source: `G:/projets/projet-source/docs/audit/SPEC.md`
- cible: `G:/projets/aidn/docs/SPEC.md`
- action: importer les regles generalisables (SPEC-R01..SPEC-R11, gates session close/PR/local sync/incident, continuity).

- source: `G:/projets/projet-source/AGENTS.md`
- cible: `G:/projets/aidn/template/root/AGENTS.md`
- action: reprendre uniquement les passages generiques du bloc manage (branch ownership session/cycle/intermediate, session close rule, PR gate), sans references repo-specifiques.

- source: `G:/projets/projet-source/docs/audit/cycles/TEMPLATE_STATUS.md`
- cible: `G:/projets/aidn/template/docs_audit/cycles/TEMPLATE_STATUS.md`
- action: importer schema state-only + metadonnees continuity.

- source: `G:/projets/projet-source/docs/audit/sessions/TEMPLATE_SESSION_SXXX.md`
- cible: `G:/projets/aidn/template/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md`
- action: importer sections session continuity + branch context + session close cycle resolution.

### 2) Nouveaux docs de support workflow (import quasi direct)
- source: `G:/projets/projet-source/docs/audit/CONTINUITY_GATE.md`
- cible proposee: `G:/projets/aidn/template/docs_audit/CONTINUITY_GATE.md`

- source: `G:/projets/projet-source/docs/audit/RULE_STATE_BOUNDARY.md`
- cible proposee: `G:/projets/aidn/template/docs_audit/RULE_STATE_BOUNDARY.md`

- source: `G:/projets/projet-source/docs/audit/WORKFLOW_SUMMARY.md`
- cible proposee: `G:/projets/aidn/template/docs_audit/WORKFLOW_SUMMARY.md`

- source: `G:/projets/projet-source/docs/audit/incidents/TEMPLATE_INC_TMP.md`
- cible proposee: `G:/projets/aidn/template/docs_audit/incidents/TEMPLATE_INC_TMP.md`

### 3) Ajustements template complementaires (adaptes)
- source: `G:/projets/projet-source/docs/audit/index.md`
- cible: `G:/projets/aidn/template/docs_audit/index.md`
- action: ajouter liens vers continuity gate + workflow summary (sans version projet).

- source: `G:/projets/projet-source/docs/audit/snapshots/context-snapshot.md`
- cible: `G:/projets/aidn/template/docs_audit/snapshots/context-snapshot.md`
- action: garder format compact (baseline/active cycles/open gaps/top hypotheses/next entry), avec placeholders neutres.

- source: `G:/projets/projet-source/docs/audit/WORKFLOW.md`
- cible: `G:/projets/aidn/template/docs_audit/PROJECT_WORKFLOW.md`
- action: extraire uniquement les sections generiques pour enrichir le template adapter (sans contraintes specifique projet-source).

- source: `G:/projets/projet-source/docs/audit/baseline/current.md`
- cible: `G:/projets/aidn/template/docs_audit/baseline/current.md`
- action: ne pas recopier le contenu instance; adapter seulement la structure si une evolution de schema est necessaire.

- source: `G:/projets/projet-source/docs/audit/baseline/history.md`
- cible: `G:/projets/aidn/template/docs_audit/baseline/history.md`
- action: ne pas recopier l'historique projet; adapter seulement le format/template si utile.

- source: `G:/projets/projet-source/docs/audit/parking-lot.md`
- cible: `G:/projets/aidn/template/docs_audit/parking-lot.md`
- action: conserver template neutre (ne pas importer les IDEAs projet), verifier uniquement le schema attendu.

- source: `G:/projets/projet-source/.codex/skills.yaml`
- cible: `G:/projets/aidn/template/codex/skills.yaml`
- action: garder la logique versionnee par placeholder (`v{{VERSION}}`), ne pas figer une version.

## Fichiers a ne PAS reimporter (projet-specifiques)
- `G:/projets/projet-source/docs/audit/WORKFLOW.md` (version instanciee projet-source, trop locale; utiliser seulement comme reference pour enrichir `PROJECT_WORKFLOW.md`).
- `G:/projets/projet-source/docs/audit/baseline/current.md`
- `G:/projets/projet-source/docs/audit/baseline/history.md`
- `G:/projets/projet-source/docs/audit/parking-lot.md`
- `G:/projets/projet-source/docs/audit/cycles/C*/**`
- `G:/projets/projet-source/docs/audit/sessions/S*.md`
- `G:/projets/projet-source/docs/audit/reports/**`
- `G:/projets/projet-source/docs/audit/migration/**`
- `G:/projets/projet-source/docs/audit/WORKFLOW_IMPROVEMENT_PLAN.md`

## Option technique a arbitrer (avant implementation)
projet-source ajoute un controle outille de policy workflow:
- `G:/projets/projet-source/tools/workflowpolicy/main.go`
- `G:/projets/projet-source/tools/workflowpolicy/main_test.go`
- references dans `Makefile` et `.drone.yml`

Dans aidn, deux options:
1. ne pas packager cet outillage (doc-only).
2. packager un equivalent portable (Node) dans `tools/` + doc d'integration CI.

## Sequence d'implementation recommandee
1. Uplift canonique: `docs/SPEC.md`.
2. Uplift execution contract: `template/root/AGENTS.md`.
3. Uplift templates: `TEMPLATE_STATUS.md`, `TEMPLATE_SESSION_SXXX.md`, `index.md`, `context-snapshot.md`, `PROJECT_WORKFLOW.md`.
4. Ajout des nouveaux docs (`CONTINUITY_GATE`, `RULE_STATE_BOUNDARY`, `WORKFLOW_SUMMARY`, `incidents/TEMPLATE_INC_TMP`).
5. Mise a jour doc produit (`docs/INSTALL.md`, `docs/TROUBLESHOOTING.md`, `docs/UPGRADE.md`) pour les nouvelles sections/gates.
6. Mise a jour fixtures/tests d'installation pour refleter les nouveaux artefacts installes.
7. Bump version workflow (propose: 0.2.0) + manifests + release notes.

## Risques connus
- Sur-specification: risque de rendre `PROJECT_WORKFLOW.md` trop dense si on y copie du contenu local projet-source.
- Derive de duplication: verifier la precedence SPEC > WORKFLOW > AGENTS.
- Compatibilite ascendante: conserver un mode de migration non destructif pour repos deja installes.

