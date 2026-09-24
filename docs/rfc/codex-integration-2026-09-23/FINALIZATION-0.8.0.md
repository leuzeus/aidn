# Finalisation AIDN × Codex — 0.8.0

Plan accepté et actualisé le 2026-09-23. Il suit le chantier et ses preuves sans
remplacer les autorités exécutables ou les obligations du resolver.
Le [plan initial](PLAN.md) conserve son état historique d'audit.

## Renforcement de l'admission spécifique — 2026-09-24

Base vérifiée à distance : dev `d074b523e3d248e2d13e777e8d498dad997076ea`.
PR #62 fusionnée dans dev (`7bba1dd`), #63 dans main (`7030f05`) ; release
v0.8.0 publiée à 00:48:23 UTC. Cette publication est historique : elle ne
qualifie pas le nouveau candidat, et ne transforme pas les anciens échecs ou
cas non exécutés en PASS. La suite de ce document conserve le plan 0.8.0.

Le nouveau candidat porte la version produit 0.9.0, distincte de la base publiée
0.8.0. Les paquets et reçus locaux antérieurs restent des preuves de leur propre
commit ; ils ne sont pas renommés ni réattribués à 0.9.0.

Le nouveau chantier reste local, ASSURED, sur branche de travail : aucun push,
PR, merge, publication, projet client réel ou Codex home global modifié.

| Lot | Delta local | Preuve / frontière |
| --- | --- | --- |
| A | Extension compatible de pre-write-admit, demande stdin, matrice opération/chemin, contrat additif, périmètre dans le plan canonique | Fixtures moteur et vraie CLI ; THINKING produit refusé, note permise ; DoR/tâche/scope et modes fichiers/dual/db-only |
| B | Hook mince, transmission du payload, validation de la décision spécifique, refus explicite et diagnostics stderr | Fixtures de wrappers et d'installation ; pas une preuve d'interception native |
| C | Diagnostic de couverture distinct de confiance/exécution, protocole N15–N17, documentation/ADR et mesures | Qualification native OPEN ; approbation humaine et trace du candidat nécessaires |

Les règles SPEC-R02/R03/R04, les résolutions canoniques existantes, l'activation
ADR-0012 et la maintenance ADR-0011 sont réutilisées. Pas de second moteur,
journal, MCP obligatoire ni cache d'autorisation. La matrice et les limites sont
dans [le guide](../../CODEX_INTEGRATION.md#specific-native-write-admission).
Réparation des contrôles installés et transitions métier conservent leurs
opérations existantes ; un texte libre repair ou PASS n'autorise aucun patch.

Mesure comparative initiale, trois exécutions par scénario, même corpus et même
compteur temporaire des API de création de processus Node :

| Scénario wrapper | Médiane avant / après (ms) | Appels enfants avant / après | Octets de contexte avant / après |
| --- | --- | --- | --- |
| Produit en THINKING | 1654 / 1833 | 11 / 13 | 434 / 0 (refus) |
| Note en THINKING | 1652 / 2140 | 11 / 13 | 434 / 441 |
| Implémentation dans le périmètre | 1663 / 1962 | 11 / 13 | 436 / 443 |

Plages après : 1830–1836, 2044–2259 et 1947–1974 ms respectivement.
Ces mesures portent sur l'arbre d'implémentation au moment du test, pas sur une
session native. Un processus racine par échantillon ; appels API enfants ne
signifie pas nombre exact de descendants OS. Zéro appel LLM, aucune conversion
octets/tokens, aucun cache d'autorisation ni objectif de latence inventé.

Le paquet de qualification doit être construit depuis un commit identifié et
installé dans un nouveau client temporaire sans stub de prérequis. Son dossier
de preuve local conserve manifeste, empreintes paquet/hooks, état source,
version installée et identité du backend. Les reçus, pré-images et chemins
privés restent hors des documents suivis. L'installation ne ferme aucun cas natif.

Inventaire observé : CLI/candidat desktop `0.155.0-alpha.16.3`, schéma app-server
généré ; backends IDE `0.146.0-alpha.3.1` et `0.146.0-alpha.9.2`, extension active
inconnue. Cette présence ne prouve pas le backend de la session applicative.
Le contrôle UI natif n'est pas disponible dans cette tâche ; aucune approbation
de projet/hook n'a été effectuée. N01–N17 restent OPEN/SKIP pour le nouveau
candidat. Unix et WSL sont UNAVAILABLE ici (WSL : E_ACCESSDENIED), cloud non testé.

Première étape de livraison restante : revue humaine des scripts et du client
temporaire exact, puis trace native et oracle fichier indépendant sur N03–N06
et N15–N17 avant toute revendication de prévention. La provenance distante de
la nouvelle branche ne peut pas être satisfaite sans un push ultérieurement
autorisé. Ni un paquet local ni un PASS fixture ne constituent cette livraison.

## Portée et décisions acceptées

Le dépôt reste une source de package. Les installations et refus sont éprouvés
dans des clients temporaires. Une migration pilote est une opération distincte
sur une cible explicitement choisie, selon la
[procédure Windows](../../CODEX_CLIENT_MIGRATION.md), avec un candidat immuable
et des sauvegardes privées. Ce plan ne déclare aucun pilote migré.

L'activation combine une autorisation au Git common-dir avec un reçu complet
et les assets locaux de chaque worktree. Les worktrees partagent la révocation ;
un clone indépendant n'hérite pas du grant. Le mode non-Git conserve une autorité
locale. Configuration, base de données, découverte ou cache ne prouvent pas
l'activation. Les reçus legacy valides ont un état distinct.

Les treize skills publics portent le préfixe aidn- ; les identifiants CLI
internes restent compatibles. La migration des skills globaux est une action
séparée et explicite, sur un Codex home choisi. Seuls les contenus historiques
exacts sont désactivés par des entrées TOML ; fichiers et homonymes personnalisés
restent préservés. Aucune approbation native n'est créée.

## Lots et acceptation

| Lot | Résultat attendu | Preuve d'acceptation |
| --- | --- | --- |
| Version | VERSION = 0.8.0 ; signaux alignés ; config schéma 1 | Gate version et fixtures de validation |
| Version cliente | install.aidnVersion finalisé après succès complet ; absence legacy = inconnue | Échec, interruption, reprise et empreintes avant/après |
| Activation | Git commun, préparation locale, révocation prioritaire, état legacy distinct | Git/worktrees réels, clone, refus avant contexte/backend, verrou et CAS |
| Skills | Noms aidn-*, migration globale séparée, propriété exacte | Pas de doublons gérés, homonymes conservés, TOML preview/reprise/restauration |
| Migration | Ancien AGENTS et ancien YAML exact reconnus | Corpus historique ; variantes personnalisées en conflit sans écriture |
| Preview | Plan commun assets/configuration et effets déclarés | Arbre inchangé ; pas de DB ni LLM pendant le preview |
| Persistance | verify-only : PostgreSQL doit déjà être compatible ; SQLite sans import/migration ni ouverture de base | PostgreSQL refusé avant écritures si incompatible ; aucune preuve implicite de disponibilité/intégrité SQLite ; intention au journal |
| Récupération | Même journal/reçu, scope installation explicite | Interruption, CAS, reprise, rollback et désinstallation |
| Conservation | Instructions/configurations tierces, sessions, cycles, données préservées | Oracles ciblés sur fichiers, blocs, champs et état persistant |
| Qualification Windows | Gates, paquet installé, wrappers, activation et récupération du candidat | Commit et SHA256 exacts ; portée fixture séparée du natif |
| Qualification native | Contrôle court avant livraison, recette N01-N14 après migration pilote | Sessions CLI/app/IDE approuvées par un humain ; chaque cas non exécuté reste SKIP |
| Unix/WSL | Hors environnement disponible de ce lot Windows | UNAVAILABLE, non bloquant ; aucune extrapolation des anciennes preuves |
| Livraison | Obligations ASSURED, artefacts et checksums | Candidat propre, revue, intégration dev puis procédure release |

Révocation et récupération ne sont pas interchangeables. Repair, resume et
rollback ne réautorisent jamais implicitement un dépôt révoqué. Le retour vers
des hooks legacy incapables d'appliquer cette frontière est refusé. Le rollback
initial sans reçu antérieur reste possible. Le binding de récupération des
skills globaux survit au rollback projet jusqu'à leur restauration explicite.

La version installée provient du paquet exécuté. Diagnostic, version
enregistrée, reçu et assets sont distingués. Npm et bootstrap sont deux
transactions : un rollback d'assets ne restaure ni le paquet npm ni une base.
Un ancien reçu ne prouve la propriété que des objets qu'il a enregistrés.

## Ordre de réalisation

1. Implémenter sur une branche de travail issue de dev, avec commits atomiques.
2. Exécuter les scénarios déterministes sans LLM, construire les artefacts depuis
   le commit candidat et conserver SHA256, résultats et limites.
3. Qualifier le candidat Windows sur clients temporaires, en distinguant source,
   scaffold, paquet installé et exécution native. Avant publication, observer
   démarrage, édition admise, refus couvert et inactivité hors projet autorisé
   après approbation humaine. Une absence de cette preuve bloque la livraison.
4. Pour toute revendication native, suivre le
   [protocole dédié](../../CODEX_NATIVE_QUALIFICATION.md) avec validation humaine.
   Conserver OPEN/SKIP si non exécuté ; Unix et WSL restent UNAVAILABLE,
   non bloquants pour les preuves Windows de ce lot.
5. Aligner guides, contrats, politiques, ADR et support sur les seules preuves
   obtenues ; satisfaire les obligations ASSURED du candidat final.
6. Après revue et intégration dev, préparer release/v0.8.0 selon la
   [politique de publication](../../GIT_WORKFLOW.md). Un artefact local ne vaut
   ni publication ni autorisation générale de déploiement.
7. Après le contrôle natif court et la livraison, lorsqu'une migration
   pilote est explicitement retenue, conserver l'ancien runtime, sauvegarder les
   configurations et l'état persistant, examiner les deux transactions de la
   procédure Windows puis vérifier leurs postconditions. Exécuter ensuite N01-N14
   sur un nouveau client temporaire dans l'application ; la migration pilote
   ne sert pas de fixture de refus ou de panne.

## Limites et phases ultérieures

Cette machine est une VM Windows. Aucun hôte Unix distinct n'est fourni et WSL
n'est pas disponible pour ce chantier. Cela ne bloque pas la qualification
Windows ; toute future revendication Unix exige une preuve du candidat concerné.
Les anciens résultats Ubuntu de la base 0.8.0 ne qualifient pas ce delta.

PASS, FAIL, SKIP et UNAVAILABLE restent distincts. Chaque preuve nomme son
commit et sa portée ; les mesures distinguent millisecondes, octets et appels.
Découverte et succès d'un wrapper ne remplacent pas l'approbation humaine ou
une trace de refus natif. Les limites natives restent explicites dans la
décision de livraison, sans prétendre qu'un test non exécuté aurait passé.

Une distribution globale facultative avec versions immuables par projet est
une phase ultérieure. Elle réutilisera les artefacts de package existants, sans
résolution latest à l'exécution ni registre parallèle. Elle ne remplacera pas
l'autorisation du dépôt et les reçus locaux.

L2 MCP demeure conditionnel : comparer sur les mêmes scénarios déterministes
CLI JSON, CLI agrégée workflow-step, daemon optionnel et transport proposé.
Mesurer temps, octets, appels, effets et refus sans attribuer à MCP un gain déjà
obtenu par agrégation ou cache. Aucun moteur ou autorité de transition ne
découle du transport ; le spike doit montrer un bénéfice avant son adoption.
