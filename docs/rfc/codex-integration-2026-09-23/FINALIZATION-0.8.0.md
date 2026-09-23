# Finalisation AIDN × Codex — 0.8.0

Plan accepté le 2026-09-23. Ce document suit le chantier produit et ses preuves ;
il ne remplace ni les autorités exécutables ni les obligations du resolver.
Le [plan initial](PLAN.md) conserve son état historique d'audit.

## Portée

Le dépôt reste une source de package. Les installations, interruptions et refus
sont testés dans des clients temporaires. Le client pilote existant conserve sa
distribution de test jusqu'à la livraison. Aucun changement de confiance globale,
appel LLM implicite, serveur MCP, plugin, runner ou installation WSL n'est prévu.

## Lots et acceptation

| Lot | Résultat attendu | Preuve d'acceptation |
| --- | --- | --- |
| Version | `VERSION` = 0.8.0 ; package, lock et manifests alignés ; config schéma 1 conservé | Gate version et fixtures de validation |
| Version cliente | `install.aidnVersion` finalisé seulement après installation complète ; absence legacy = inconnue | Échec, interruption, reprise et rollback avec empreintes avant/après |
| Migration | Ancien bloc AGENTS reconnu ; ancien YAML exact réparé sans changer les instructions | Fixture issue du Git historique ; variante personnalisée en conflit sans écriture |
| Preview | Un plan commun inclut Codex, documents, configuration et effets de persistance distincts | Arbre inchangé ; pas d'accès DB ni LLM pendant le preview |
| Récupération | Même journal/reçu ; `--scope installation` explicite ; portée Codex par défaut | Réinstallation, concurrence, CAS, reprise, rollback et désinstallation |
| Conservation | Instructions/configurations tierces, sessions, cycles, historiques, données et bases préservés | Oracles ciblés sur fichiers, blocs, champs et historique |
| Qualification native | Démarrage, nouvelle conversation, reprise, compaction, refus couvert puis admission fraîche | Vraies sessions Windows CLI/application/IDE approuvées par un humain |
| Qualification Unix | Même protocole sur un hôte Unix distinct | Version, binaire, commit, conditions et traces enregistrés |
| Livraison | Obligations ASSURED du diff, paquet reproductible, manifest et checksums | Candidat immuable propre ; revue puis intégration sur dev avant branche release |

La version installée provient du package exécuté. Les diagnostics distinguent
cette version du CLI, celle enregistrée dans la configuration et la cohérence
avec le reçu et les assets. Un rollback d'assets ne prétend jamais annuler une
migration de données. Un ancien reçu ne prouve la propriété que de ses objets
explicitement enregistrés.

## Ordre de réalisation

1. Implémenter version/configuration et récupération dans des commits distincts
   sur une branche de travail issue de dev.
2. Exécuter les scénarios déterministes sans LLM puis construire les artefacts
   depuis le commit candidat ; conserver SHA et résultats.
3. Préparer un client temporaire reviewable pour la qualification native, avec
   empreintes des hooks et du binaire, puis obtenir les validations humaines.
4. Exécuter le [protocole natif](../../CODEX_NATIVE_QUALIFICATION.md) Windows et
   Unix, en poursuivant les tâches indépendantes lorsque l'environnement manque.
5. Aligner guides, contrats, politiques, ADR et matrice de support sur les seules
   preuves obtenues ; appliquer les obligations ASSURED du candidat final.
6. Après revue et intégration sur dev, préparer `release/v0.8.0` conformément à
   [la politique de publication](../../GIT_WORKFLOW.md). Les artefacts locaux
   préparatoires ne valent ni publication ni feu vert de livraison.
7. Après livraison, remplacer le lien de test du pilote par la distribution
   retenue, puis vérifier version enregistrée et conservation des configurations.

## Qualifications qui ne peuvent pas être déduites des fixtures

Cette machine est une VM Windows. Aucun hôte Unix distinct n'est fourni dans le
contexte d'exécution ; sa qualification reste UNAVAILABLE jusqu'à disponibilité.
WSL est hors périmètre sur ce poste. La confiance et les permissions natives
exigent une action humaine dans chaque client temporaire. Un test d'adaptateur,
un `skills/list` ou un exit code ne remplace pas une trace de refus natif.

PASS, FAIL, SKIP et UNAVAILABLE sont enregistrés séparément. Chaque preuve nomme
son commit, sa version cliente et sa portée : source, scaffold, fixture, paquet
installé ou client natif. Les mesures distinguent millisecondes, octets et appels.
Une livraison n'est pas prête tant qu'un critère requis reste ouvert.

L2 MCP demeure reporté : une ouverture nécessiterait une comparaison CLI/MCP
sur les mêmes scénarios et un bénéfice démontré.
