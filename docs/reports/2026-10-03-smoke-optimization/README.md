# Smoke benchmark après optimisation AID’N

Le [rapport complet](report.md) compare la campagne C1 du 2 octobre 2026 à la paire C2 corrigée du 3 octobre. Modèle natif `gpt-6.1-sol`, effort medium ; AID’N issu du dernier `dev` vérifié avant A puis gelé à `6a79e0dd983bb8d16769017d2ac9cbb011de2b05` (PR 130–133).

C2 : les deux applications passent 21/21 critères fonctionnels (60/60), avec 96/100 chacune en revue descriptive informée. Le contrôle complémentaire NUL échoue dans les deux. A consomme 33 min 31 s contre 16 min 32 s, soit +16 min 59 s ; entrée neuve+sortie 1,91×, total incluant cache 7,48×. Aucun gain global de temps/qualité ni effet causal propre à GFD n’est démontré.

Les [agrégats neutres](results.json), les quatre figures PNG/SVG et le [manifeste de publication](publication-manifest.json) permettent de vérifier les tableaux. Le PDF complet (57 pages, annexes incluses), les applications, bases et traces brutes restent locaux. Aucun PDF n’est livré au dépôt.

Les inventaires sont reproduits intégralement dans le rapport, et consultables séparément :

- [Raisons, null/vide/absent et contrats C2](reason-inventory.md).
- [Paire invalidée, conservée hors comparaison principale](invalid-pair-reason-inventory.md).
- [Workflow AID’N et attribution GFD bornée](aidn-gfd-workflow-note.md).
- [Workflow sans AID’N](baseline-review.md).
- [Latence et frictions natives](latency-inventory.md).
- [Architecture, accès aux données et suites](static-architecture-followup.md).
- [Correctifs fusionnés et preuves ciblées](DELIVERED_FIXES_PR130_133.md).

Un défaut public restant est documenté : le packet de handoff PostgreSQL omet six propriétés exigées par son schéma (15/16 documents publics conformes dans la trace). Un succès natif, de persistance ou de test ne remplace pas cette conformité. Les champs null autorisés et le défaut de projection corrigé restent distingués.

Le [format des futurs rapports](../README.md) conserve Markdown complet au dépôt et PDF local. Ces rapports exploratoires ne sont pas une qualification de release ni une autorité normative du runtime.
