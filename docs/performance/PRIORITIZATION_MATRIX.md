# Priorization Matrix - Workflow Performance

Scoring:
- Impact: 1 (faible) -> 5 (très fort)
- Effort: 1 (faible) -> 5 (élevé)
- Risque qualité: 1 (faible) -> 5 (élevé)
- Priority Score: `Impact / Effort` (indicatif)

| Initiative | Impact | Effort | Risque qualité | Lot | Priority Score | Note |
|---|---:|---:|---:|---|---:|---|
| Instrumentation NDJSON standard | 5 | 2 | 1 | Lot 1 | 2.50 | Base de mesure indispensable |
| Couverture skills Phase 1 (context-reload, branch-cycle-audit, drift-check) | 5 | 2 | 2 | Lot 1 | 2.50 | Plus gros gain latence avec risque maîtrisé |
| Wrapper unique `perf:checkpoint` pour hooks skills | 5 | 2 | 2 | Lot 1/2 | 2.50 | Évite duplication et divergence entre skills |
| KPI reporter CLI | 4 | 2 | 1 | Lot 1 | 2.00 | Rend les gains pilotables |
| L1 fast checks (hash + mapping) | 5 | 2 | 2 | Lot 1 | 2.50 | Coupe les gates redondants |
| Écriture conditionnelle artefacts inchangés | 4 | 2 | 2 | Lot 1 | 2.00 | Réduit le churn sans perte de trace |
| Signaux L2 drift-check conditionnel | 4 | 3 | 3 | Lot 1/2 | 1.33 | Exige seuils bien calibrés |
| Profil structurel multi-version (legacy/modern/mixed) | 5 | 2 | 2 | Lot 1/2 | 2.50 | Fiabilise les checks quand la version déclarée est inexacte |
| Couverture skills Phase 2 (cycle-create, cycle-close, promote-baseline, requirements-delta) | 4 | 3 | 2 | Lot 2 | 1.33 | Réduit churn et améliore traçabilité par skill |
| Couverture skills Phase 3 (convert-to-spike + harmonisation) | 3 | 2 | 1 | Lot 2/3 | 1.50 | Finalise la couverture 10/10 du pack |
| Taxonomie artefacts (normatif/support/unknown) | 5 | 3 | 2 | Lot 2 | 1.67 | Couvre les artefacts non standards sans perte silencieuse |
| Digest reload incrémental | 5 | 3 | 3 | Lot 2 | 1.67 | Gain direct sur latence |
| Fallback full reload robuste | 5 | 2 | 1 | Lot 2 | 2.50 | Sécurité anti-régression |
| Index local minimal (SQLite) | 4 | 3 | 2 | Lot 2 | 1.33 | Lookup rapide cycles/artefacts |
| Requêtes analytiques standard | 3 | 2 | 1 | Lot 2 | 1.50 | Facilite tuning continu |
| Dual-write fichiers + DB | 3 | 4 | 4 | Lot 3 | 0.75 | À activer progressivement |
| Contrat mode d'état `files|dual|db-only` | 5 | 2 | 3 | Lot 3 | 2.50 | Rend la transition explicite et pilotable |
| Interface `IndexStore` abstraite | 4 | 3 | 2 | Lot 3 | 1.33 | Prépare la DB future |
| Sync import/export complet | 4 | 4 | 3 | Lot 3 | 1.00 | Nécessaire pour rollback sûr |
| Reconstruction DB -> fichiers (incluant supports) | 5 | 4 | 3 | Lot 3 | 1.25 | Indispensable pour `db-only` sûr |
| Équivalence gates `dual` vs `db-only` | 5 | 3 | 4 | Lot 3 | 1.67 | Garantit qualité inchangée en mode DB-first |
| Schéma canonique artefacts (JSON/SQLite) | 5 | 3 | 3 | Lot 3 | 1.67 | Base de vérité optimisée pour runtime multi-branches |
| Renderer Markdown déterministe depuis état canonique | 4 | 3 | 2 | Lot 3 | 1.33 | Maintient lisibilité sans faire du Markdown la source runtime |
| Rendu Markdown incrémental (section-level) | 4 | 3 | 2 | Lot 3 | 1.33 | Réduit le churn et les réécritures complètes |

## Priorité Exécution Recommandée

1. Instrumentation NDJSON standard
2. Couverture skills Phase 1 (context-reload, branch-cycle-audit, drift-check)
3. Wrapper unique `perf:checkpoint` pour hooks skills
4. L1 fast checks
5. Fallback full reload robuste
6. KPI reporter CLI
7. Écriture conditionnelle artefacts inchangés
8. Digest reload incrémental
9. Index local minimal (SQLite)
10. Signaux L2 drift-check conditionnel
11. Profil structurel multi-version (legacy/modern/mixed)
12. Couverture skills Phase 2 (cycle-create, cycle-close, promote-baseline, requirements-delta)
13. Taxonomie artefacts (normatif/support/unknown)
14. Requêtes analytiques standard
15. Contrat mode d'état `files|dual|db-only`
16. Interface `IndexStore` abstraite
17. Sync import/export complet
18. Reconstruction DB -> fichiers (incluant supports)
19. Équivalence gates `dual` vs `db-only`
20. Couverture skills Phase 3 (convert-to-spike + harmonisation)
21. Schéma canonique artefacts (JSON/SQLite)
22. Renderer Markdown déterministe depuis état canonique
23. Rendu Markdown incrémental (section-level)
24. Dual-write fichiers + DB
