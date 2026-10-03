# Format des rapports smoke benchmark

Le dépôt conserve un rapport Markdown complet et ses figures exportables. Le PDF et les traces brutes restent locaux. Un résumé ne remplace pas le rapport complet.

Chaque rapport inclut :

- La question évaluée, le sujet, les critères et pondérations figés, les budgets par phase, l'ordre des bras et les règles d'arrêt.
- Le modèle et l'effort réellement confirmés, l'absence de fallback, les versions des outils, le commit/tree du package construit depuis la branche demandée, ses empreintes et les identités des installations/runtime neufs.
- La branche source du **client**, distincte de la provenance du package, avec cohérence vérifiée avant le lancement. La revue des hooks passe par les contrôles natifs humains du projet exact.
- Les essais complets, incomplets et invalides, conservés avec leur cause et leurs coûts disponibles. Une nouvelle étude après correction de préparation est présentée séparément ; aucun meilleur essai n'est choisi après observation de la qualité.
- Les résultats de l'oracle externe, les exigences réellement exercées, les contrôles complémentaires séparés et une revue qualitative avec critères, preuves, auteur et limites.
- Les temps réellement consommés, les blocages et interventions ; préparation, développement et évaluation séparés. Une terminaison sans application utilisable n'est pas un gain de vitesse.
- Les derniers cumuls de tokens par thread distinct : entrée, cache, entrée neuve, sortie, raisonnement inclus dans la sortie et cache-write séparé. Les ratios par exigence/point indiquent le dénominateur ; une valeur absente reste indisponible.
- Les latences observables, les unions des intervalles concurrents, les premières réponses visibles et les volumes UTF8. Octets, tokens, temps et facture sont des mesures distinctes ; les coûts auxiliaires non exposés restent inconnus.
- Un inventaire exhaustif des champs de raison : null, vide et absent par famille, producteur et contrat ; notifications natives, décisions AIDN et copies imbriquées distinguées.
- Les mécanismes AIDN/GFD réellement observés, l'adoption package/client séparée, les accès canoniques et caches, les corrections/reproductions ciblées et les coûts restants.
- Des graphiques lisibles, une conclusion proportionnée aux preuves, les facteurs de confusion et les recommandations concrètes.

Pour les comparaisons avant/après, afficher les valeurs de chaque bras et campagne. Signaler toute variation de préparation, outil, protocole ou oracle. N=1 et deux bras ne permettent pas d'isoler causalement GFD ni chaque correctif.

La livraison documentaire suit les commits atomiques et PR ; fusion seulement lorsque les contrôles requis du commit final réussissent. Aucun PDF, credential, solution pilote ou trace brute n'est livré au dépôt.

Ces rapports sont exploratoires et non normatifs. Ils ne qualifient ni une release ni la conformité générale d’un produit. Le format documentaire demandé par l’utilisateur ne remplace pas les autorités et contrôles de livraison du dépôt.

Campagnes antérieures : [smoke AID’N/GFD du 2 octobre 2026](2026-10-02-smoke-aidn-gfd/README.md) ; [frictions et architecture](2026-10-02-friction-architecture/report.md).
