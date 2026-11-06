# Appels de sous-modèles pour le workflow STANDARD

Statut : **conception de référence ; premier candidat exécutable ajouté à la
source, non qualifié**. Les contrats explicites sont décrits dans ADR-0022 et
les sélecteurs de qualification dans `docs/TESTING.md`. Le raccordement complet
à STANDARD, les bornes et profils encore non couverts restent à achever.
Ce document prépare le contrat restant de L3. Il ne remplace ni
[SPEC](SPEC.md), ni les décisions et autorisations d'exécution existantes.
Le [plan complet](PLAN_STANDARD_WORKFLOW_PROCESS_IR_2026-11-01.md) conserve
tous ses lots L1–L8 et critères A1–A10.

## Problème vérifié dans la source

Le modèle composé courant contient 256 nœuds et déclare encore
`complete_standard_workflow: false`. L'auteur retire ou développe déjà des
groupes séquentiels pour respecter cette borne. Une nouvelle activité ne doit
pas être obtenue en retirant un chemin applicable ou son admission.

Le `call` actuel référence un `child` du même tableau `nodes`.
`agentic-process-model.mjs` impose un parent unique à chaque nœud non racine et
refuse une seconde visite. Ce contrat représente un arbre, y compris ses appels.
Il ne constitue pas une bibliothèque de sous-modèles réutilisables.

Le problème ne se limite pas à ce validateur :

- `process-data-contracts.mjs` construit une seule ascendance par nœud ; une
  seconde arête remplacerait silencieusement le parent précédent dans sa Map.
- `process-input-resolution.mjs` sélectionne les résultats par occurrence et
  scopes d'appel, de boucle et de collection. Une valeur n'est pas le dernier
  résultat portant un nom de nœud.
- L'hôte STANDARD résout les opérations dans `model.nodes`. Il ne sait pas
  résoudre une activité dans un autre modèle épinglé.
- Le réducteur conserve des occurrences distinctes et leurs parents. Il utilise
  la même histoire pour l'exécution, le replay et la simulation.

Assouplir seulement le nombre de parents ou la limite de 256 nœuds laisserait
ces contrats en désaccord. Le premier incrément doit traverser ces quatre
surfaces, avant toute déclaration de couverture STANDARD supplémentaire.

## Direction de conception retenue pour le prochain incrément

Préparer des appels explicites vers des **modèles v2 embarqués et épinglés** dans
la définition persistée de l'instance. V2 reste le défaut global. Le `call.child`
historique conserve son sens ; un appel vers un autre modèle a une forme
explicite distincte, jamais déduite d'un identifiant manquant.

Chaque cible possède son `model_id`, sa révision, son empreinte de contenu et
ses bindings. Deux appels peuvent référencer la même cible immuable sans copier
son graphe. Les identifiants locaux de ses nœuds restent locaux à cette cible.
L'identité de résolution est donc le couple modèle épinglé/nœud local ;
l'identité métier d'une exécution demeure son occurrence complète.

La bibliothèque fait partie du contenu authentifié et persisté de l'instance.
Une lecture froide doit pouvoir résoudre chaque cible avec ces seuls octets.
Une résolution par le fichier actuellement présent dans le package, par un
chemin fourni par le modèle ou par un téléchargement serait une autre autorité
et doit être refusée. Une lecture ne rafraîchit aucune cible ni aucun pin.

Cette direction exige encore les schémas fermés et leurs vérificateurs. Les
noms et formes des nouveaux champs ne sont pas publiés par ce document.

## Invariants du contrat à implémenter ensemble

| Surface | Invariant et refus attendu |
| --- | --- |
| Résolution | Une référence complète identifie exactement une cible, sa révision et son empreinte. Cible absente, empreinte différente, conflit de définition ou cible non accessible : refus avant entrée. |
| Graphe des appels | Appels récursifs directs ou indirects et dépendances cycliques refusés. Les appels historiques restent des arbres locaux. Aucun graphe de contrôle arbitraire ou passage de participant n'est ajouté. |
| Occurrences | Deux appels de la même cible ont des occurrences et corrélations distinctes, même avec les mêmes nœuds locaux. Les descendants restent rattachés à l'appel exact, y compris après reprise froide. |
| Entrées | Les paramètres sont résolus une fois pour l'entrée exacte de cet appel, avec sources et empreintes conservées. Une entrée extérieure ne remplace pas implicitement les paramètres d'un appel déjà entré. |
| Sources de données | Validation de toutes les ascendances applicables ; résolution au scope exact de l'occurrence. Aucun écrasement de parent, dernier résultat global ou choix ambigu entre deux appels. |
| Sorties | Retour déclaré, typé et lié aux résultats acceptés de cet appel. Un retour ne copie pas un reçu d'un autre appel et ne transforme pas refus, report, annulation, attente ou UNKNOWN en succès. |
| Persistance | Une entrée ou un retour nécessitant un événement utilise le journal commun et son CAS. Une entrée dupliquée se déduplique ; une entrée portant le même identifiant avec un autre contenu refuse. |
| Réducteur | Même résolution épinglée et même réducteur pour exécution, reprise, replay et SIM. Pas de second ordonnanceur de sous-workflows ni d'orchestrateur parallèle dans un skill. |
| Effets | L'appel ne confère aucune autorité. Intentions, grants, owners, réservations et reçus restent liés à l'occurrence, au modèle exact, au scope et au préfixe actuel. |
| Coûts | Les appels partagent les comptes et plafonds cumulés de l'instance et de sa chaîne. Aucun compteur initialisé à nouveau par cible, tentative, appel, reprise ou retour. |
| Compatibilité | Anciennes instances/modèles/bindings lus sans conversion persistée ; aucune réparation implicite des définitions ou références. |

Les paramètres d'appel ne peuvent pas simplement être injectés dans des frames
éphémères puis oubliés. Le service doit conserver la résolution authentifiée
nécessaire au replay. Le choix exact de l'événement d'entrée, du retour dérivé
ou journalisé et de leurs empreintes est à fermer dans le premier changement
exécutable, avec ses preuves négatives. Une donnée de modèle ne devient pas
une autorité pour fabriquer cet événement ou un résultat accepté.

Une cible reste sous la borne v2 de 256 nœuds. Les limites actuelles de JSON,
profondeur, identifiants d'occurrence, événements et occurrences restent
applicables à l'enveloppe et à l'exécution. Le réducteur conserve sa limite de
1 024 occurrences. Une bibliothèque ne contourne pas ces protections en
répartissant les mêmes données dans plusieurs objets. Toute incompatibilité
mesurée avec le workflow complet doit être traitée explicitement et qualifiée,
sans hausse implicite d'une borne.

## Première expérience discriminante et critères d'acceptation

Construire une définition JSON directe v2 contenant un parent et une cible
réutilisée au moins deux fois. Chaque composant reste sous 256 nœuds ; le
parcours développé doit dépasser 256 occurrences et rester dans les autres
bornes inchangées. Il doit inclure des opérations authentifiées et des données
locales à l'appel, puis une consommation de sortie par le parent. Un parcours
composé uniquement de séquences vides n'établit pas ces propriétés.

| Cas | Observation requise |
| --- | --- |
| Deux appels séquentiels | Deux identités d'opération, bons paramètres et bonnes sources ; le second n'accepte ni l'intention ni le reçu du premier. |
| Deux appels logiquement concurrents | Résolution séparée malgré des noms de nœuds identiques ; un retour ne termine pas l'autre appel ou son join. Aucune nouvelle allocation native implicite. |
| Reprise froide | Arrêt après entrée, après intention, après effet et après retour accepté ; réouverture depuis les octets persistés, préfixe identique et absence de répétition des effets confirmés. |
| Redelivery/CAS | Doublon identique dédupliqué ; contenu différent ou préfixe concurrent refusé ; même reçu accepté une seule fois. |
| Sorties négatives | Refus, report, annulation, attente et UNKNOWN conservent leurs types. UNKNOWN garde les exclusions d'effets incompatibles et le protocole L4 existant. |
| Falsifications | Mauvaise cible/révision/empreinte, paramètre, scope, occurrence, auteur ou reçu d'un autre appel : refus précis avant l'effet concerné. |
| Bornes | 257 nœuds dans une cible reste refusé ; profondeur, occurrence trop longue, bibliothèque JSON trop grande, récursion et limite d'occurrences restent refusés. |
| Compatibilité | Modèles v1/v2 et appels `child` existants conservent leurs empreintes, événements, sorties et refus, sans conversion. |
| Replay/SIM | Les événements réels retenus donnent les mêmes identités, données, attentes et curseurs dans le réducteur commun, sans effet ni appel modèle. |

La première fixture peut employer des autorités explicitement synthétiques pour
qualifier ce contrat structurel et les vrais stores locaux. Elle ne qualifie pas
un parcours STANDARD productif, un acteur humain/provider/native réel ou un
package installé. La qualification de ces niveaux reste distincte.

## Raccordement à STANDARD après cette expérience

Après preuve de l'expérience, extraire un composant réel du graphe distribué,
conserver toutes ses opérations, décisions, admissions et issues, et remplacer
ses occurrences par les appels épinglés. La matrice de trace doit conserver la
correspondance règle SPEC/ancien nœud/cible locale/nouvelle occurrence/binding.
Les événements des anciennes révisions ne sont jamais réécrits.

Comparer le parcours avant/après par les entrées, sorties acceptées, effets et
causalités, en explicitant les nouvelles identités d'occurrence. Ne pas annoncer
la parité sur la seule égalité du nombre de feuilles ou sur le chargement d'un
catalogue. Ce raccord doit ensuite permettre d'ajouter les chemins manquants
du plan, avec les vraies entrées ordinaires, puis A1–A10, les acteurs réels et
l'archive installée exacte.

Avant de publier ce contrat, aligner les schémas, validateurs, résolveurs,
service/store/hôte, auteurs et loaders concernés, ainsi que
[ADR-0022](ADR/ADR-0022-structured-agentic-process.md),
[ADR-0025](ADR/ADR-0025-standard-workflow-runtime-binding.md), les docs de
contrats et la sélection de tests. Les règles d'autorisation de
[ADR-0026](ADR/ADR-0026-explicit-native-authorization-epochs.md) restent
applicables. Ce document seul ne change aucun comportement exécutable.
