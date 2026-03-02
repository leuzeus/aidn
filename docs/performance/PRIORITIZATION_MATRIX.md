# Priorization Matrix - Workflow Performance

Scoring:
- Impact: 1 (faible) -> 5 (très fort)
- Effort: 1 (faible) -> 5 (élevé)
- Risque qualité: 1 (faible) -> 5 (élevé)
- Priority Score: `Impact / Effort` (indicatif)

| Initiative | Impact | Effort | Risque qualité | Lot | Priority Score | Note |
|---|---:|---:|---:|---|---:|---|
| Instrumentation NDJSON standard | 5 | 2 | 1 | Lot 1 | 2.50 | Base de mesure indispensable |
| KPI reporter CLI | 4 | 2 | 1 | Lot 1 | 2.00 | Rend les gains pilotables |
| L1 fast checks (hash + mapping) | 5 | 2 | 2 | Lot 1 | 2.50 | Coupe les gates redondants |
| Écriture conditionnelle artefacts inchangés | 4 | 2 | 2 | Lot 1 | 2.00 | Réduit le churn sans perte de trace |
| Signaux L2 drift-check conditionnel | 4 | 3 | 3 | Lot 1/2 | 1.33 | Exige seuils bien calibrés |
| Profil structurel multi-version (legacy/modern/mixed) | 5 | 2 | 2 | Lot 1/2 | 2.50 | Fiabilise les checks quand la version déclarée est inexacte |
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

## Priorité Exécution Recommandée

1. Instrumentation NDJSON standard
2. L1 fast checks
3. Fallback full reload robuste
4. KPI reporter CLI
5. Écriture conditionnelle artefacts inchangés
6. Digest reload incrémental
7. Index local minimal (SQLite)
8. Signaux L2 drift-check conditionnel
9. Profil structurel multi-version (legacy/modern/mixed)
10. Taxonomie artefacts (normatif/support/unknown)
11. Requêtes analytiques standard
12. Contrat mode d'état `files|dual|db-only`
13. Interface `IndexStore` abstraite
14. Sync import/export complet
15. Reconstruction DB -> fichiers (incluant supports)
16. Équivalence gates `dual` vs `db-only`
17. Dual-write fichiers + DB
