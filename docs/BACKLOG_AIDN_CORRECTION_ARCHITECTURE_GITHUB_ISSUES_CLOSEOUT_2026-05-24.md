# Backlog de closeout des issues GitHub AIDN

Référence de cadrage: [docs/PLAN_AIDN_CORRECTION_ARCHITECTURE_GITHUB_ISSUES_CLOSEOUT_2026-05-24.md](./PLAN_AIDN_CORRECTION_ARCHITECTURE_GITHUB_ISSUES_CLOSEOUT_2026-05-24.md)

Ce backlog formalise la résolution des issues GitHub encore ouvertes mais déjà absorbées par l'état actuel du dépôt. Il ne demande aucun changement applicatif supplémentaire.

## Statut

Les issues suivantes sont closes sur GitHub et ne nécessitent aucune action:

- `#24` `Classify all CLI surfaces`
- `#27` `Extend no implicit write coverage`
- `#28` `Add a shared runtime extension gate`
- `#29` `Expose SoT coverage in governance diagnostics`
- `#33` `Add a release and provenance checklist`

Les issues suivantes restent ouvertes sur GitHub au moment de la vérification mais sont maintenant closes-out comme `stale`:

| Issue | Titre court | Statut GitHub à la vérification | Résolution backlog | Action concrète |
| --- | --- | --- | --- | --- |
| `#25` | `db-only-readiness` | ouverte | `stale` | fermer l'issue avec une note de synchronisation; ne pas rouvrir en lot d'implémentation |
| `#26` | `repair-layer` | ouverte | `stale` | fermer l'issue avec une note de synchronisation; conserver le statut `internal` documenté |
| `#30` | `pre-write-admit` tranche 1 | ouverte | `stale` | fermer l'issue avec une note de synchronisation; garder le wrapper CLI mince comme état cible |
| `#31` | runbooks backup/restore/adopt/reanchor | ouverte | `stale` | fermer l'issue avec une note de synchronisation; conserver les runbooks actuels |
| `#32` | split CI gates by intention | ouverte | `stale` | fermer l'issue avec une note de synchronisation; garder les workflows déjà séparés |

## Critères de résolution

- aucun de ces sujets ne doit générer un nouveau ticket d'implémentation dans ce cycle;
- les artefacts existants restent la trace de référence;
- toute réapparition future doit être traitée comme un nouveau sibling daté;
- le closeout doit rester lisible sans nécessiter de recouper l'historique GitHub complet.

## Vérifications retenues

- `npm run perf:verify-cli-effect-policy` PASS
- `npm run perf:verify-cli-surface-parity` PASS
- `npm run perf:verify-pre-write-admit` PASS
- `npm run perf:verify-db-only-readiness` PASS
- `npm run perf:verify-shared-coordination-backup` PASS
- `npm run perf:verify-shared-coordination-restore` PASS
- `npm run perf:verify-shared-coordination-doctor` PASS

## Notes de traçabilité

- Ce backlog est un artefact de closeout, pas un backlog d'implémentation.
- Les issues GitHub étaient ouvertes au moment de la vérification, mais l'état du dépôt les rend obsolètes.
- Le traitement correct est donc la fermeture GitHub avec un commentaire de synchronisation et la conservation de ces fichiers comme trace datée.

## Résultat

- Les issues `#25`, `#26`, `#30`, `#31` et `#32` ont été fermées sur GitHub.
- Les artefacts datés restent la trace de référence pour ce closeout.
