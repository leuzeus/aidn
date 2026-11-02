# Raccordement du workflow standard AIDN à l’IR de processus

Date : 2026-11-01. État : **PLAN ENREGISTRÉ — INTÉGRATION STANDARD À RÉALISER**.
Référence inspectée : commit `dd1dbaba9ae7123c157dd35f8a6f42f34f32d3fa`.
Catégorie : architecture et intégration runtime ; voie prévue pour la réalisation :
**ASSURED**, compte tenu des effets, contrats, autorités et persistances concernés.
La version initiale du plan (`6886132`) enregistrait le diagnostic et le travail
restant. L’avancement ci-dessous ne vaut pas livraison du modèle standard ni
qualification de son parcours complet.

Dernier état relu : `843ec2f` et tranche courante de revue humaine R05 et
conservation des constats.
Les constats initiaux ci-dessous restent datés de `dd1dbab` ; les
addenda et l’avancement distinguent les composants livrés des raccordements
encore ouverts.

### Avancement d’exécution

- L0 : diagnostic terminé, conservé ci-dessous avec sa référence de code.
- L1 : socle de contrats **VALIDÉ HORS LIGNE**. Contrats
  binding/intention/reçu/livraison de contrôle, formats
  modèle/instance v2, événements du réducteur commun et ports de service
  authentifiés implémentés. Les lecteurs v1 restent séparés, avec hashes de
  référence `dd1dbab` vérifiés. Voir [ADR-0025](ADR/ADR-0025-standard-workflow-runtime-binding.md).
- Preuve de cette tranche : fixtures hors ligne sur stores réels et autorités
  doublées ; attentes, reports, refus, effets inconnus, réconciliation, simulation,
  replay, timeout et course CAS. Aucun adaptateur métier standard n’est qualifié
  par ces doubles. L’enveloppe de livraison est authentifiée par un port hôte
  borné ; ces doubles ne qualifient pas les adaptateurs métier L2/L4.
- L2/L4 : en cours. Ports de bootstrap/cycle, journal de dispatch signé, choix
  de mode/hook, inbox de contrôle durable et conservation de l'état natif décrits
  dans les addenda ci-dessous, ainsi que diagnostic typé et finalisation R05 sans
  dérive avec vrai hook, revue humaine et conservation canonique des constats.
  L'exécution de la récupération choisie reste ouverte. Le journal d'allocation signé constitue une tranche
  supplémentaire. La reprise native et l'hôte mixte sont des compositions
  internes explicites ; la garde du démarrage ordinaire reste inchangée.
- L3 : en cours, composants IR de démarrage et de squelette de cycle distribués,
  avec raccords de données déclarés dans leurs nouvelles révisions et consommés
  par les tests de ports réels ; le modèle standard complet reste à livrer.
- L4 : scope commun et dispatcher mixte interne implémentés et validés sur les
  corpus ciblés ; réconciliation des inconnus et continuation après expiration restent
  ouvertes. Voir l'addendum du 2026-11-02.
- L5 à L8 : à réaliser. Le modèle standard complet, son branchement ordinaire,
  la reprise générale et les preuves natives/package installé restent ouverts.
- Vérifications L1 : 27 cas dédiés, 38 régressions du réducteur/service, 51 de
  composition native sur transport simulé, 14 du compilateur, 10 du défaut moteur
  et 12 de console. Aucun appel modèle réel. Les contrôles de gouvernance et
  documentation accompagnent cette tranche ; ces seuls résultats L1 ne
  qualifient pas L2–L8.

## 1. Résultat attendu et limite du travail déjà réalisé

Le workflow standard d’AIDN doit être un modèle IR JSON versionné, distribué avec
le produit et effectivement consommé par le moteur commun. Ses activités doivent
appeler les véritables ports applicatifs des skills et opérations. Le même modèle
et le même réducteur doivent permettre exécution, simulation et replay.

BPMN est une voie facultative de modélisation et de compilation vers cette IR.
Le parcours standard, sa configuration et son acceptation ne nécessitent aucun
fichier XML. Le rapport d’architecture joint à la demande est une référence de
conception ; il ne constitue ni une autorisation d’effet ni une nouvelle règle
canonique. La distinction processus / état / ressource est conservée.

**Le livrable manquant est ajouté explicitement au périmètre restant : modèle
standard versionné + ports réels + attentes et reprise durable + raccordement des
entrées ordinaires + qualification du parcours complet.** `dd1dbab` a livré la
sélection du moteur et des entrées génériques. Cette sélection ne termine pas ce
livrable, et les benchmarks de modèles de démonstration ne le qualifient pas.

## 2. État constaté dans le code

| ID | Constat confirmé | Source et portée de la preuve |
| --- | --- | --- |
| E01 | Moteur commun disponible : contrôle structuré, journal, CAS, simulation et replay. | [Réducteur](../src/core/workflow/agentic-process.mjs), [simulation](../src/core/workflow/agentic-process-simulation.mjs), [service](../src/application/runtime/agentic-process-service.mjs). Ce sont des capacités génériques. |
| E02 | Sélection agentique par défaut pour les nouveaux workflows. | [Politique](../src/core/workflow/workflow-engine-policy.mjs), [composition](../src/application/runtime/workflow-instance-composition.mjs), [commande générique](../src/application/runtime/workflow-run-service.mjs), [ADR-0024](ADR/ADR-0024-default-agentic-workflow-engine.md). |
| E03 | Aucun modèle runtime JSON du workflow standard ni chargeur de ce modèle identifié dans les sources et catalogues inspectés. | La commande générique demande une configuration ; la composition native lit le modèle fourni par cette configuration. Elle ne sélectionne pas un modèle standard livré. |
| E04 | La définition historique reste descriptive. | [audit-informed.v1.json](../tests/fixtures/workflow-shadow/audit-informed.v1.json) : `workflow-definition.v1`, `revision: 2`, `reference_only`, `execution: unsupported`, compatibilité produit `0.11.0`. [Registre shadow](../package/catalogs/workflow-shadow.v1.json) également `reference_only` / `unsupported`. |
| E05 | Les décisions et opérations existent en plusieurs ports ; elles ne sont pas orchestrées par une instance IR standard identifiée. | [Transitions](../src/application/runtime/workflow-transition-lib.mjs), services `*-admit-use-case`, [routage des skills](../src/core/skills/skill-policy.mjs), [skill hook](../src/application/runtime/skill-hook-use-case.mjs). Un résultat d’admission n’est pas la preuve de création d’une session ou d’une clôture. |
| E06 | `codex workflow-step` conserve son rôle d’admission, contexte et coordination. | [Entrée](../tools/codex/workflow-step.mjs) : hydratation, `preWriteAdmit`, coordination et projection. Ce fichier ne charge ni n’exécute le modèle IR standard. Certaines variantes sont des projecteurs ; seule une invocation classée lecture seule peut être utilisée comme observation sans effet. |
| E07 | La reprise du service/réducteur est distincte de celle du lanceur natif. | Les fixtures conservent une attente après recréation du service. Mais [garde de démarrage](../src/core/workflow/agentic-process-start.mjs) et [composition native](../src/application/runtime/agentic-process-execution-composition.mjs) refusent un historique non vierge avec `PROCESS_EXECUTION_EXISTING_INSTANCE_REQUIRES_RECONCILIATION`. Le lanceur peut conserver une attente et fermer ses ressources ; il ne sait pas généralement repartir de cet historique. |
| E08 | L’hôte actuel n’est pas un dispatcher de toutes les opérations standard. | [Hôte](../src/application/runtime/agentic-process-execution-host.mjs) : activités préparées puis exécutées par `resource.session.run`; ressources, contributions, observations et résultats conservés dans des `Map` en mémoire. Les skills sont chargés comme contenu de contexte dans la composition native, sans preuve qu’un skill complet soit exécuté comme opération déterministe. |

Les contrats actuels sont fermés : un nœud `activity` porte `role_ref` et
`policy_ref`, et son affectation/résultat est lié au contrat de ressource agentique.
Ils ne fournissent pas, à eux seuls, un contrat de résultat authentifié pour une
commande déterministe ou une décision humaine. Il faut définir ce raccordement ;
ajouter des noms d’opération au JSON sans support du validateur ne suffit pas.

Contrôles relancés pendant ce diagnostic :

| Contrôle actuel | Résultat | Ce qu’il ne prouve pas |
| --- | --- | --- |
| `verify-workflow-engine-fixtures.mjs` | PASS, 10 vérifications | Sélection et modèle JSON de test ; pas le cycle standard complet. |
| `verify-agentic-process-fixtures.mjs` | PASS, 38 vérifications | Réducteur/service, stockage et ports d’autorité simulés ; pas la reprise générale du lanceur ni les véritables mutations des skills standard. |
| `verify-workflow-compilation-fixtures.mjs` | PASS, 64 vérifications, 28 décisions de helpers | Compilation shadow et parité ; le contrôle annonce explicitement l’absence d’exécution. |
| `verify-workflow-shadow-fixtures.mjs` | PASS, 53 vérifications, 11 règles et 45 transitions descriptives | Les références vers des suites/procédures sont des attentes liées, pas des preuves de parcours exécuté. |

Qualification actuelle du **workflow standard via IR** : hors ligne non établie,
native NOT_RUN, sur package installé NOT_RUN. Ces labels ne remettent pas en cause
les preuves génériques du moteur ; ils délimitent le livrable standard.

## 3. Autorités et exigences de raccordement

L’autorité normative est [SPEC](SPEC.md), notamment `SPEC-R01` à `SPEC-R11`,
complétée par les politiques exécutables d’effets, d’admission, de source de vérité,
de métadonnées et de coordination. Les versions livrées des skills définissent
les procédures applicables. La définition shadow et les anciens plans servent
à comparer la couverture, jamais à réintroduire une règle périmée.

| Exigence | Acceptation nécessaire |
| --- | --- |
| STD-01 | Modèle JSON standard livré, résolu par les entrées ordinaires et épinglé dans chaque instance. Aucun XML requis. |
| STD-02 | Chaque activité, décision et issue applicable est reliée à une règle courante, un port, un contrat et un test. Toute exclusion a une justification explicite. |
| STD-03 | Une admission, un hook, un code de sortie zéro ou un texte de skill chargé ne vaut pas réalisation complète de l’activité. Les postconditions sont observées. |
| STD-04 | Routage et opérations déterministes, délais et attentes humaines : zéro appel modèle. Le travail nécessitant un agent reste soumis à affectation et résultat authentifiés. |
| STD-05 | Intentions d’effets, autorisations et résultats sont liés à l’occurrence, aux entrées, au scope, à la révision et aux préconditions actuelles. |
| STD-06 | Attente, refus, report, annulation et résultat inconnu gardent des issues distinctes ; aucun ne devient une réussite par défaut. |
| STD-07 | Reprise durable après événements et résultats, sans rejouer les effets déjà confirmés ; un effet incertain impose réconciliation. |
| STD-08 | Simulation et replay consomment le même modèle et le même réducteur ; aucune mutation ni exécution externe pendant ces deux modes. |
| STD-09 | Lecteurs historiques conservés, sans conversion silencieuse. La sélection d’un moteur n’accorde aucun droit nouveau. |
| STD-10 | Preuves séparées hors ligne, natives et sur archive installée, avec provenance et limites. |

La traçabilité contiendra : `activity_id`, règle SPEC et ancre, port réel,
identité/version du skill, classe d’effet, préconditions, issues, preuve attendue,
test et niveau de qualification. Les conditions de conformité existantes restent
dans leurs politiques/helpers ; le modèle consomme leurs résultats typés pour
piloter le cycle de vie. On ne recopie pas leurs prédicats dans un second moteur
de règles, ni une deuxième orchestration complète dans les skills.

## 4. Modèle et contrats à livrer

Les chemins suivants restent **proposés, à créer** pour le modèle standard
complet et son raccordement ordinaire :

```text
package/catalogs/process-models/aidn-standard.v1.json
package/catalogs/standard-workflow.v1.json
docs/architecture/STANDARD_WORKFLOW_IR_TRACEABILITY.md
src/application/runtime/standard-workflow-composition.mjs
src/application/runtime/agentic-process-resume-service.mjs
src/adapters/runtime/standard-workflow-github-adapter.mjs
```

Les contrats `process-operation-binding.v1`, `process-operation-receipt.v1` et
`process-control-event.v1`, ADR-0025, `standard-workflow-operations.mjs` et
`standard-workflow-operation-host.mjs` existent maintenant comme fondations
partielles décrites en section 9. Leur présence ne livre pas les chemins restants.

Le catalogue standard sélectionnera le modèle et ses bindings versionnés. Il
épinglera modèle, règles, politiques et procédures, sans transformer une fixture
de test en autorité runtime. Les fixtures seront des consommateurs de ce modèle
livré. L’instance conservera ses épingles historiques.

Le lot L1 a retenu les contrats modèle/instance v2 et le dispatch explicite
des lecteurs dans ADR-0025. Ne pas ajouter
des champs inconnus au format v1 ni inventer un faux agent pour une commande ou un
humain. Une évolution de format conserve le réducteur commun ; elle ne crée pas
un moteur spécifique au parcours standard. Le modèle standard `v1` et la version
technique de son contrat sont deux identités différentes.

Le modèle couvrira une session et ses cycles applicables, avec sous-processus
structurés pour démarrage, travail/cycle, clôture et PR. Les limites actuelles
(nœuds, occurrences, itérations, événements et trace) seront mesurées sur les
scénarios standard : dépassement explicite ou continuation versionnée, jamais
troncature, boucle illimitée ou succès synthétique. Les collections dynamiques
et le passage à une session suivante devront avoir un contrat de continuation.

La trace L1 précisera notamment le bootstrap avec mode encore inconnu et le moment
où les admissions autorisent la réalisation de `start-session`. Si la procédure,
SPEC et le comportement divergent sur cet ordre, consigner l’écart et sa résolution
avant de figer le graphe ; ne pas choisir silencieusement une ancienne règle shadow.

### Catalogue des activités et raccordements

Tous les adaptateurs ci-dessous appartiendront à l’hôte et seront enregistrés dans
une liste fixe. Le JSON désigne une référence de binding ; il ne fournit ni module,
commande shell arbitraire, SQL, secret ou déclaration auto-authentifiée. Les noms
de ports cibles sont des responsabilités à implémenter, pas des APIs déjà présentes.

Types : **D** déterministe ; **H** décision/attente humaine ou événement externe ;
**A** travail agentique. Une ligne combinant plusieurs phases donnera des
occurrences distinctes quand leurs effets ou preuves diffèrent.

| Activité / règle | Opération ou skill actuel et adaptateur hôte cible | Entrées et résultat / preuve exigée | Effets admis |
| --- | --- | --- | --- |
| Recharger — R01/R11, D | `aidn-context-reload`, hydratation et `reload-check-use-case`; port de rechargement contrôlé | Projet, baseline/snapshot, scope et mode de stockage ; contexte réellement chargé, références/empreintes et verdict de rechargement. Un check seul ne prouve pas la lecture. | Lecture par défaut ; cache/projection uniquement selon la variante d’effet autorisée. |
| Admettre le démarrage — R01/R04, D | `pre-write-admit`, `runStartSessionAdmitUseCase`, transitions existantes ; port d’admission | Activation, continuité, session/cycles, PR et Git canoniques ; admission, motifs et choix requis. | Lecture ; aucun artefact créé par une admission. |
| Démarrer/reprendre la session — R01, D/H | `aidn-start-session`; port de réalisation du skill à extraire/compléter via templates et `runDbFirstArtifactUseCase` | Intention explicite, session cible et admission fraîche ; création ou rattachement effectif, chemins/IDs, hashes et postconditions. | Écritures de session autorisées, checkpoint distinct ; pas de nouvelle session si la continuité impose une reprise. |
| Choisir le mode — R01/R02, H/D | Décision opérateur et contrôle de mode ; port de décision | THINKING/EXPLORING/COMMITTING explicite, déjà fourni ou à demander ; reçu attribué à l’auteur, résultat non ambigu. | Journal seulement ; proposition d’un agent ≠ autorisation de COMMITTING. |
| Choisir un cycle / la continuité — R03/R04/R06, H/D | Helpers de branche/continuité et choix utilisateur ; port de sélection | Session, candidats canoniques, branche de base et R1/R2/R3 ; cycle choisi ou attente/STOP, justification d’exception. | Journal ; pas de création de branche avant choix conforme. |
| Créer un cycle — R03/R06, D/H | `aidn-cycle-create`, `runCycleCreateAdmitUseCase`; port artefacts + Git local à compléter | Type, portée, base approuvée, templates, ownership ; branche et artefacts réellement créés et vérifiés. | Effets Git/artefacts explicitement autorisés ; reçu séparé de l’admission. |
| Auditer branche et DoR — R03/R04, D | `aidn-branch-cycle-audit`, service d’admission correspondant | Mapping unique, intention, plan et usage matrix ; verdict frais et raisons. | Lecture, puis éventuelle preuve/checkpoint autorisé ; aucun droit déduit d’un warning. |
| Convertir une exploration retenue — R02, D/H | `aidn-convert-to-spike` et son admission ; port de réalisation à compléter | Résultat d’exploration, choix de rétention, cycle cible ; conversion effective ou report/abandon explicite. | Artefacts/branche selon consentement et continuité ; pas de promotion automatique d’un essai. |
| Admettre chaque effet — R04/R11, D | `pre-write-admit-use-case`, politique d’effets et skill ciblé | Scope, paths, révision, mode, autorisation ; décision liée à l’effet précis. | Aucune mutation métier par le seul verdict. Réévaluation avant effet, après une attente ou changement matériel. |
| Audits d’intention et d’architecture — pipeline cycle, A/H | Rôles/skills déclarés ; port agentique existant avec résultat authentifié | Portée, règles, critères et contexte admissible ; rapport, verdict, révision auditée et preuves. | Lecture ou artefacts d’audit explicitement permis ; intervention humaine si décision requise. |
| Travail — R02/R03, A/D | Hôte agentique pour analyse/implémentation ; port outil pour tâches déterministes | Tâche, périmètre, critères, permissions et admission ; résultats liés à l’exécution et aux artefacts observés. | Écritures produit bornées et autorisées ; THINKING n’admet pas d’implémentation produit. Aucune session native pour une simple opération déterministe. |
| Dérive et récupération de périmètre — R05, D/A/H | `aidn-drift-check`, gating et `aidn-requirements-delta`; port diagnostic/récupération | Intention canonique, diff et preuves ; diagnostic, parking-lot/CR, choix rollback/nouveau cycle ou attente. | Lecture ; écriture d’un delta ou rollback seulement après autorisation correspondante. Un audit de contenu peut être agentique ; le routage ne l’est pas. |
| Incident/reprise — R10, D/A/H | `aidn-crash-recovery`, opérations de diagnostic, handoff/reanchor existantes ; port à composer (`crash-recovery` n’a pas de route de hook générique) | Checkpoint, preuves partielles, sévérité et propriétaire ; triage, résolution vérifiée ou STOP. | L1/L2 dans leurs limites ; L3/L4 attendent autorisation avant changement de règle. Pas d’effacement de preuve d’effet inconnu. |
| Validation et revue indépendante — pipeline/R11, D/A | Exécuteurs de validations réels + hôte de revue indépendante | Usage matrix, révision/critères, commandes bornées et preuves ; résultats détaillés, refus/warnings conservés. | Tests/rapports explicitement autorisés ; contrôles déterministes sans modèle. Une nouvelle session seule ne prouve pas l’indépendance. |
| Fermer un cycle — R07, D/H | `aidn-cycle-close`, `runCycleCloseAdmitUseCase`; port de transition métier à compléter | Exit criteria, validations et décision DONE/NO_GO/DROPPED ; état canonique, checkpoint et éventuel drift-check de clôture effectivement réussis. | Transition et artefacts autorisés ; admission ou état terminal écrit seul ≠ clôture réussie. |
| Promotion éventuelle — R07, D/H | `aidn-promote-baseline`, `runPromoteBaselineAdmitUseCase`; port baseline à compléter | Cycle DONE retenu, choix de promotion et version ; baseline/current/history observés après effet. | Écriture baseline autorisée ; NO_GO/DROPPED non promouvables ; « non demandée » issue explicite. |
| Résoudre les cycles ouverts — R07, H/D | Choix `integrate-to-session`, `report`, `close-non-retained`, `cancel-close`; ports canoniques/Git | Décision par cycle et preuves d’intégration si demandée ; aucun cycle laissé implicitement résolu. | Report n’est ni DONE ni fusion ; cancel-close laisse la session ouverte. |
| Clôturer session / snapshot — R07, D/H | `aidn-close-session`, `runCloseSessionAdmitUseCase`, `runCheckpointUseCase`; port de réalisation | Session propriétaire, cycles résolus, notes, snapshot ; postconditions et succès du checkpoint final. | Écritures explicitement autorisées, sans libérer prématurément le propriétaire nécessaire au contrôle final. |
| Chaîne de contraintes — R07, D | `runConstraintLoopUseCase` et opérations de rapports existantes ; port déterministe | État dual/db-only et rapports ; report → thresholds → actions → history → trend → lot-plan → summaries, résultats imbriqués contrôlés. | Effets locaux/DB réels classés et autorisés ; chaîne obligatoire dans ces modes, aucun fallback fichier ni succès sur sous-échec. |
| Push / création ou récupération PR — R08, D/H | `aidn-pr-orchestrate`, `runPrOrchestrateAdmitUseCase`; ports Git et GitHub à raccorder | Branche/session, remote/base/head et autorisation ; ref distant et PR réellement observés, IDs/SHA et provenance. | Push/PR seulement autorisés. Une `suggested_command` de l’admission n’est pas une opération exécutée. |
| Attendre la revue et les checks — R08, H/D | Adaptateur GitHub authentifié + inbox durable à livrer | Repo/PR, head SHA, sources et checks requis ; attente corrélée ou événement accepté pour cette révision. | Observation réseau bornée par l’hôte ; pas de polling LLM, ni d’agent natif maintenu en attente. |
| Trier/corriger la revue — R08, A/H/D | Skill PR, port de travail/revue et adaptateur GitHub | Threads pour le head courant ; valid → correction/validation, invalid → justification, résolution observée ou exception explicitement documentée. | Corrections, réponses et résolution de threads seulement selon autorisations ; tout nouveau head invalide les preuves concernées. |
| Autoriser et fusionner — R08, H/D | Décision opérateur + port GitHub | Head/base, checks, triage et autorisation liés à la révision ; merge SHA et état distant vérifiés, ou refus/attente. | Fusion explicitement autorisée ; absence de thread ou timeout ≠ approbation. |
| Synchroniser après fusion — R09, D/H | Admission PR, adaptateur Git local et réconciliation | Branche courante, remote/source, merge SHA ; fetch réel et ahead/behind, stratégie explicite si divergence, contrôle final. | Fetch/synchronisation classés comme effets ; pas de reset/rebase destructif implicite. Une nouvelle branche reste bloquée tant que la réconciliation requise n’est pas prouvée. |
| Handoff / fin / annulation — R07/R10/R11, D/H | `aidn-handoff-close` et ports de handoff/fermeture | État exact, effets confirmés ou inconnus, prochain point ; reçu de handoff, report ou annulation et fermeture des ressources natives. | Écritures autorisées ; fin de lot, de processus natif et de workflow distinguées. |

Les réalisations manquantes seront extraites ou ajoutées dans les ports métier,
pas reproduites dans un runner shell. Le routage de `skill-policy.mjs` reste la
référence des identités et hooks. Charger son texte dans le contexte d’un agent
ne dispense ni du port de réalisation ni de ses postconditions.

## 5. Attentes, événements et reprise durable

1. **Journal avant effet.** Identité stable d’opération liée à instance, occurrence,
   binding/version, entrées et scope. Intention et préconditions conservées avant
   dispatch, puis reçu vérifié et événement de résultat. Le contrat fixe la frontière
   atomique avec le CAS canonique et les réservations existantes.
2. **Trois états d’effet.** Non lancé ; résultat confirmé ; résultat inconnu ou
   partiel. Un crash entre effet externe et reçu impose observation/réconciliation.
   Git et GitHub ne deviennent pas exactement-once par ajout d’un hash : rechercher
   la ref, le commit ou la PR correspondant à l’intention ; ne pas répéter à l’aveugle.
3. **Attente durable.** Décision humaine, revue, checks ou événement externe :
   occurrence, corrélation, révision attendue et condition de réveil conservées.
   L’hôte ferme ses ressources natives, rend un état d’attente et ne transforme pas
   une fin d’allocation en achèvement du workflow. Le transport peut être une
   livraison d’événement ou une observation hôte explicitement bornée.
4. **Inbox et authenticité.** Vérifier source/principal, droits, repo/PR/head,
   instance/occurrence et fraîcheur avant d’émettre les faits du réducteur. Garder
   l’identifiant externe, la preuve et la déduplication avant acquittement. Doublons,
   événements anciens, étrangers ou hors ordre n’autorisent pas un nouveau dispatch.
   Un booléen `approved` fourni par le modèle n’est pas un reçu humain authentifié.
5. **Reprise générale.** Relire modèle/politiques/autorités épinglés, journal,
   intentions et reçus ; recalculer le curseur ; réconcilier les opérations ambiguës ;
   acquérir une génération propriétaire et un fence avant tout nouvel effet.
   Une expiration de lease seule ne prouve pas l’arrêt d’un ancien exécuteur.
6. **Continuité des preuves.** Restaurer contributions, exclusions de revue,
   critères et identité/lineage des résultats acceptés à partir d’une autorité
   durable. Les `Map` du précédent hôte ne suffisent pas. Une nouvelle génération
   ne peut ni réémettre un résultat perdu comme nouveau succès ni effacer les
   contributeurs pour rendre une revue artificiellement indépendante.
7. **Budgets.** Séparer durée logique du workflow, attente et allocations natives.
   Une PR peut attendre au-delà d’une allocation ; l’ancien délai natif n’est pas
   prolongé ni remis à zéro. Toute nouvelle allocation demande une autorisation
   explicite compatible avec les plafonds/cumuls du workflow et ses preuves de
   fermeture. Pas de retry favorable automatique après refus.
8. **Issues explicites.** WAITING/BLOCKED/DEFERRED sont des états ou issues typés à
   contractualiser, pas des alias de COMPLETED. Refus, annulation, échec et report
   gardent leur sémantique. Les refus d’admission peuvent autoriser une remédiation
   explicite ; un verdict terminal de rejet ne se réécrit pas en succès.

Le modèle et ses événements restent la source du curseur. Les artefacts métier
(session, cycle, baseline, PR) conservent leur source de vérité propre : une
projection d’instance ne remplace pas leurs autorités. Réutiliser le store
d’artefacts et ses transactions/CAS si approprié. Tout nouveau journal, inbox ou
reçu durable exige déclaration de propriétaire, scope, rétention, migration,
remplacement et projections dans les politiques de gouvernance. Aucun élargissement
silencieux des tables/ports de coordination partagée ; PostgreSQL reste optionnel.

## 6. Lots, dépendances et sorties vérifiables

L1 est **VALIDÉ HORS LIGNE** ; L2 est **EN COURS**, avec une tranche de ports locaux
décrite ci-dessous. Les lots L3 à L8 restent **À TERMINER** ; L4 dispose de la
fondation partielle de journal décrite en section 9. L0 est le diagnostic documenté
ici, pas une qualification d’intégration. Les chemins existants sont à modifier
seulement dans le lot concerné ; les nouveaux chemins de la section 4 sont proposés.

| Lot | Dépendances | Livrables / fichiers concernés | Critère de sortie et validations |
| --- | --- | --- | --- |
| L0 — Ancrage | État `dd1dbab` | Ce plan, bornes dans AGENTIC_PROCESS/ADR-0024 ; inventaire des règles courantes et écarts de la définition historique. | E01–E08 confirmés ; règles R01–R11 identifiées ; aucun changement de marqueur shadow ni revendication d’intégration. Diagnostic présent : terminé pour ce plan. |
| L1 — Contrats et décision | L0 | ADR-0025 mis en œuvre ; contrats binding/reçu/événement et versionnement modèle/instance ; `agentic-process-model.mjs`, réducteur/service, schémas, source-of-truth, métadonnées et diagnostics. | D/A/H distingués, résultats authentifiables par type, attentes et issues sans faux agent ; tests de schémas, refus d’extensions inconnues, anciens lecteurs et limites ; décision de version fixée avant L2–L4. Validé hors ligne. |
| L2 — Ports réels | L1 | Modules standard-workflow operations proposés ; `*-admit-use-case`, `skill-hook-use-case`, `checkpoint-use-case`, `db-first-artifact-use-case`, adaptateurs Git et GitHub. | Chaque ligne du catalogue a réalisation/postcondition ou blocage explicite ; tests sur vrai projet jetable ; aucun modèle pour D/H ; admission distincte de réalisation ; échecs imbriqués visibles et effets sans autorisation refusés. |
| L3 — Modèle standard et traçabilité | L1 + catalogue L2 stabilisé | JSON standard, catalogue/bindings et matrice de traçabilité proposés ; politiques de contrôle existantes ; scénarios de simulation. | Couverture R01–R11, trois modes de travail, chemins de cycle et PR, reports/annulations ; références de ports résolues ; aucun XML obligatoire ; modèle livré consommé par tests, sans copier ses décisions dans un orchestrateur parallèle. |
| L4 — Reprise et événements | L1 + L2 + modèle L3 | Service de reprise proposé ; store/service/host/composition agentiques, garde de démarrage remplacée par une admission de reprise explicite ; contrats de journal/inbox, preuves de propriété et événements GitHub. | Reprise après chaque frontière intention/effet/résultat/attente ; déduplication, réconciliation des inconnus, CAS/concurrence, fermeture de l’ancien hôte et contributions conservées. L’attente existante du réducteur seule ne ferme pas le lot. |
| L5 — Entrées ordinaires | L2 + L3 + L4 | `workflow-run-service`, composition d’instances, CLI/registre/effets/contrats, console ; `workflow-step` comme observation du curseur ; skills et WORKFLOW-KERNEL source ; manifests/catalogues et résolution installée. | Un démarrage normal explicitement autorisé crée ou reprend l’instance du modèle standard livré, sans fournir à la main un modèle de démonstration. Les skills rejoignent cette même instance ; ils ne gardent pas une macro-orchestration concurrente. Lire contexte/JSON n’exécute rien implicitement. Modèles personnalisés et voie historique restent explicites. |
| L6 — Qualification hors ligne | L1–L5 | Nouvelles fixtures standard, reprise et ports ; `package.json`, catalogue de gates et guards associés ; docs TESTING, CLI, SPEC/WORKFLOW et ADR alignés. | Parcours A1–A10 ci-dessous avec vrais ports métier, SQLite réel et Git local jetable ; transport distant simulé identifié. Replay exact et simulation ; mutations attendues vérifiées et absence d’effets du replay. Required gate dédiée, non simple inventaire de tests. |
| L7 — Qualification native bornée | L6 | Scénarios et rapports de qualification versionnés ; configuration, critères, hooks et budgets épinglés. | Travail agentique réel via hôte commun, attente qui ferme les ressources, nouvelle allocation autorisée lors de la reprise, refus/annulation et fermeture prouvés. Contrôles D/H sans appels modèle. Transport GitHub réel uniquement sur sandbox autorisée pour les affirmations correspondantes. |
| L8 — Package installé | L6 + L7 pour les affirmations natives | Packaging/manifests, qualification d’archive et installation jetable, migrations/compatibilité et docs d’upgrade. | Modèle/bindings/skills trouvés depuis l’archive, sans chemins du dépôt source ; parcours standard et reprise via CLI/console installées ; comparaison de replay/simulation. Hash archive/commit et versions retenus. Toute affirmation native sur l’archive exige sa propre preuve sur cette archive. |

Ordre : L0 → L1 → L2/L3 → L4 → L5 → L6 → L7/L8. Une livraison intermédiaire
peut être déclarée « validée hors ligne » ; elle ne ferme pas le livrable complet.
Une modification de règle SPEC, notamment sur incident L3/L4, doit suivre son
autorisation existante et ne se déduit pas de l’approbation de ce plan.

## 7. Preuves d’acceptation du parcours standard

Le scénario nominal sera un projet temporaire installé/activé avec les vraies
procédures du produit, un dépôt Git et un remote local jetable. Tâche minimale :
petite modification vérifiable avec validation et revue. La fixture ne fabriquera
ni admission positive, ni mutation métier, ni fermeture réussie à la place du port.
En hors ligne, seul le transport natif/distant pourra être doublé, avec cette
limite affichée ; les politiques, stores, services et ports métier resteront réels.

| Cas | Oracle obligatoire |
| --- | --- |
| A1 — Nominal COMMITTING | Rechargement → démarrage → mode/cycle/DoR → audits → travail → validation → clôture du cycle → promotion si demandée → résolution des cycles restants et clôture de session → PR/revue/fusion → sync. Les préconditions actuelles fixent le placement exact des mutations. Chaque occurrence relie son appel réel, ses effets, reçus et postconditions. Le modèle est celui du catalogue livré. |
| A2 — THINKING / EXPLORING | THINKING refuse les écritures produit ; EXPLORING peut terminer non retenu ou passer explicitement par conversion/cycle. Pas de promotion ni PR déduite de l’existence d’un fichier. |
| A3 — Refus d’admission | Activation manquante, branche ambiguë, DoR incomplet, backend configuré indisponible, autorisation absente/périmée : effets métier et appels natifs à zéro. Aucun fallback de source canonique. |
| A4 — Attente humaine / revue | Mode ou cycle indécidable, revue en attente, checks manquants : WAITING/BLOCKED durable, zéro polling modèle. Arrêt du processus et reprise après événement authentifié ; aucune re-création de session/cycle ni nouveau push confirmé. |
| A5 — Événements et révisions | Doublon, faux auteur, mauvais scope/PR/head, événement ancien ou hors ordre refusés/dédupliqués. Push d’une correction invalide les approbations et validations liées à l’ancien head ; triage valide/invalide conserve justification et preuve. |
| A6 — Crash et concurrence | Interruptions avant effet, après effet avant reçu, après reçu avant acceptation et après résultat accepté. Deux repreneurs concurrents : un propriétaire valide ; effet inconnu réconcilié, aucun effet confirmé répété. Les observations Git/GitHub doivent prouver la récupération, pas le scénario de test seul. |
| A7 — Dérive / incident | Dérive → CR/nouveau cycle/rollback ou report ; incident L1/L2 distinct de STOP L3/L4. Reprise au checkpoint vérifié ; aucune édition de règle automatiquement autorisée. |
| A8 — Clôtures et issues | DONE avec critères satisfaits ; NO_GO/DROPPED non promouvables ; report distinct ; cancel-close garde session ouverte ; refus/checkpoint/chaîne de contraintes en échec empêchent le succès global ; annulation native ferme les ressources et ne devient pas COMPLETED. |
| A9 — Post-merge | Fusion observée pour les bons head/base, fetch et divergence réelle. Divergence/stratégie ambiguë bloque le prochain cycle jusqu’à décision et réconciliation ; zéro simple écriture `synced: true` en remplacement de l’observation. |
| A10 — Stockage et histoires | files/dual/db-only sur SQLite réel ; PostgreSQL configuré via adaptateur réel et transport simulé hors ligne, puis preuve PostgreSQL réel avant affirmation de ce backend. Projection en panne conservée comme telle. Lecteurs workflow-instance.v1 et agentic-process-instance.v1 préservés, historique non converti. |

Pour chaque exécution : conserver empreintes modèle/bindings/politiques, états
initiaux, événements ordonnés, IDs d’intention et de reçu, autorisations, résultats
authentifiés, mutations métier, compteurs d’appels et preuves de fermeture.

Le **replay** relira le journal accepté sans appeler les ports d’effets ; curseur,
occurrences, issues et hash final doivent correspondre, octet pour octet là où le
contrat le définit. La **simulation** utilisera le même modèle/réducteur et des
événements synthétiques valides ; elle vérifiera les chemins nominaux et négatifs,
sans valoir authentification réelle. Les différences de provenance des événements
seront déclarées ; elles ne doivent pas masquer un écart de contrôle.

## 8. Gates et niveau de preuve

Scripts existants à conserver comme régressions, à sélectionner selon chaque lot :

- `npm run perf:verify-agentic-process` : moteur générique, ne remplace pas A1–A10.
- `npm run perf:verify-workflow-shadow` et `npm run perf:verify-workflow-compilation` : comparaison historique, sans promotion de statut.
- `npm run perf:verify-cli-output-contracts`, `npm run perf:verify-cli-effect-policy`, `npm run perf:verify-cli-no-implicit-write` et `npm run perf:verify-cli-surface-inventory`.
- `npm run perf:verify-source-of-truth-policy`, `npm run perf:verify-metadata-policy`, `npm run perf:verify-governance-runtime-cli` et `npm run perf:verify-state-mode-parity`.
- `npm run perf:verify-pack-topology`, `npm run perf:verify-release-reproducibility` et `npm run perf:verify-doc-references`.

Réutiliser aussi les fixtures réelles d’admission/delivery des sessions, cycles,
clôtures, promotions, hooks et PR, dont les fichiers sont présents sous
`tools/perf/`. Leur succès isolé ne prouve pas leur consommation par le modèle.

Fichiers de tests **proposés, à créer** et rattacher à une gate required de la
famille runtime, avec guards de commande et provenance des échecs :

```text
tools/perf/verify-standard-workflow-model-fixtures.mjs
tools/perf/verify-standard-workflow-ports-fixtures.mjs
tools/perf/verify-standard-workflow-resume-fixtures.mjs
tools/perf/verify-standard-workflow-e2e-fixtures.mjs
tools/verify/qualify-installed-standard-workflow.mjs
```

| Niveau | Preuve minimale à conserver | Limite |
| --- | --- | --- |
| Hors ligne | Vrais ports locaux et stockage/Git, injections de pannes, compteurs D/H = 0 appel modèle, A1–A10 et replay/simulation exacts. Doubles de transport explicitement identifiés. | Ne prouve ni identité native/provider, ni vrai GitHub, ni distribution installée. |
| Natif | Allocation réelle avec budgets et autorisations, corrélation des résultats, contribution/revue, interruption/reprise et fermeture ; journal du même modèle standard. | Un cas borné ne prouve pas tout usage natif ; les anciens benchmarks IR/XML ne suffisent pas. |
| Package installé | Archive exacte, installation jetable, résolution des modèles/ports/skills, exécution et reprise via entrées livrées ; hashes et versions retenus. | Une installation seule ne prouve pas le parcours ; une preuve source ne qualifie pas automatiquement l’archive ni ses dépendances. |

Chaque rapport sépare PASS, FAIL, SKIP et prérequis UNAVAILABLE. Une gate requise
non exécutable reste un échec diagnostiqué ; un scénario manuel natif non autorisé
ou non lancé est NOT_RUN/SKIP et ne devient pas un PASS hors ligne.

## 9. Condition de fin et prochaine action

Le raccordement sera déclaré terminé seulement quand le modèle standard livré
pilote les entrées ordinaires, tous les ports applicables ont leurs preuves, les
attentes/reprises satisfont A1–A10 et les niveaux de qualification revendiqués sont
établis. Modifier une documentation, choisir le moteur par défaut, changer
`reference_only` / `unsupported` ou exécuter un modèle générique ne satisfait pas
cette condition.

**Lot courant : L2**, sur les contrats D/A/H fixés par ADR-0025 et la matrice
initiale des activités ci-dessus. Réaliser une tranche
verticale courte « rechargement → admission → session effective → attente de choix
→ arrêt/reprise » sur projet jetable avant d’étendre le modèle au parcours complet.
Cette tranche fournit une première preuve de raccordement ; elle ne remplace pas
les clôtures, la revue de PR et la synchronisation restant dans le périmètre.

### Avancement de L2 : ports de démarrage locaux

`src/application/runtime/standard-workflow-operations.mjs` fournit trois bindings
déterministes : `context_reload`, `session_admit` et `session_initialize`.
Les deux premiers appellent les use cases existants de rechargement et
d’admission, sans écriture. Le troisième est un composant du skill
`start-session` : il prépare un plan versionné, exige son hash et `write: true`,
revérifie l’admission et les préimages, crée réellement la branche et les deux
artefacts session/état courant, puis vérifie leur utilisation par l’admission.
La session reste en mode `UNKNOWN` avec `session_mode_pending: true` ; ceci
n’atteste pas l’exécution complète du skill, de son choix humain ou de son hook.

`standard-workflow-artifacts.mjs` conserve l’autorité fichiers ou base canonique,
utilise le CAS existant et matérialise les projections requises. Une projection
visible périmée ne remplace jamais la base. Les cinq schémas
`standard-{empty-input,session-initialize-input,session-initialize-plan,operation-output}.v1`
et `process-local-effect-owner.v1` ferment les échanges correspondants. Les
observations métier complètes restent des charges utiles privées du port ; les
futurs reçus authentifiés du réducteur devront les lier par leur hash.

Le concept `process_local_effect_owner` est couvert par les politiques et
diagnostics de gouvernance. Son verrou local exclusif empêche les ports coopérants
de doubler les effets. Un effet inconnu ou un arrêt laisse ce verrou en place,
sans reprise par simple PID ou expiration. Ce mécanisme ne constitue ni un
journal durable des effets, ni une propriété distribuée, ni un protocole de
récupération général. Aucun effacement automatique du verrou n’est livré.

`tools/perf/verify-standard-workflow-ports-fixtures.mjs`, ajouté à la gate requise,
utilise Git, l’installateur des assets d’activation et les ports métier réels,
avec état de fixture et modèle de session du scaffold courant. Les cas couvrent
fichiers, SQLite `dual`/`db-only`, projections périmées, refus avant effets,
concurrence locale et panne réelle injectée dans SQLite après un premier effet.
Cette preuve est **hors ligne, dérivée du scaffold et de fixtures** ; elle ne
qualifie pas une archive installée, PostgreSQL réel ou un hôte natif.

**Reste requis pour fermer L2 puis continuer L3–L5 :** livrer les autres activités du catalogue et
leurs vrais ports, fournir le modèle standard JSON complet et l’attente humaine,
puis l’inbox, étendre le journal et la reprise durable avec authentification et propriété
d’exécution. Les entrées ordinaires ne consomment pas encore ce modèle standard.
La tranche n’est donc pas une preuve A1–A10 du workflow intégré. Les lots L7 et
L8 restent NOT_RUN ; leurs preuves ne sont pas remplacées par ces fixtures.

Validation de cette tranche, exécutée le 2026-11-02 UTC :

- **PASS hors ligne** : gate `perf:verify-agentic-process` complète, dont les
  14 scénarios des ports standard ; la composition native y utilise un transport
  simulé et n’appelle aucun modèle.
- **PASS** : définitions des cinq schémas sous le profil `workflow-definition`,
  politiques de source de vérité et de métadonnées, complétude de gouvernance,
  catalogues de gates/surfaces, références documentaires, sensibilité des fichiers
  suivis et topologie du package sur clients de fixture.
- **NOT_RUN** : workflow standard via hôte natif, concurrence PostgreSQL réelle,
  installation et parcours standard depuis une archive exacte. La vérification
  de topologie ne vaut pas qualification de cette archive.

### Raccordement L2 et fondation partielle de L4 : journal et hôte des opérations

`standard-workflow-operation-host.mjs` consomme désormais les trois bindings
réels par le service/réducteur commun. `process-operation-journal.mjs`, son
adaptateur de stockage et les contrats `standard-operation-preview.v1` /
`process-operation-journal.v1` conservent l’aperçu, l’intention avant effet,
la propriété de dispatch et le résultat authentifié. Ils utilisent le CAS et
les règles de projection existants, sans nouvelle table de coordination.
Le concept `process_operation_journal` est couvert dans les politiques,
métadonnées, diagnostics et la matrice de scope.

La clé est une capacité d’hôte hors projet ; le scope épingle son identité et le
mode de stockage. Le JSON d’un modèle ne peut la sélectionner. Le port de grant
est revérifié avant intention, dispatch et acceptation. Une réouverture vérifie
les résultats antérieurs contre les journaux authentifiés, pas seulement leur
hash de structure. Un reçu durable peut être accepté par un nouveau processus
Node sans reproduire l’effet. Un dispatch sans reçu ne reprend pas son effet
par expiration ou PID. Le résultat d’un effet partiel reste inconnu et interdit
une nouvelle exécution de cette occurrence.

`verify-standard-workflow-host-fixtures.mjs` est ajouté à la gate requise. Son
modèle IR de **fixture de ports** exécute réellement rechargement, admission et
création, atteint une attente durable et retrouve exactement le même curseur en
simulation/rejeu. Les scénarios couvrent fichiers, SQLite dual/db-only,
acceptation dans de nouveaux processus Node, concurrence, faux reçus/historiques,
grant retiré, dispatch arrêté et effet SQLite partiel. Les grants restent des
doubles de capacité ; l’état « dispatch arrêté » est une fixture, pas une preuve
de terminaison d’arbre OS. Ces preuves sont hors ligne.

**La fin de L4 n’est pas revendiquée.** Restent les décisions humaines et leur
inbox authentifiée, les événements GitHub, la réconciliation d’un propriétaire
ambigu avec preuve de cessation, les résultats/contributions natifs, l’hôte
mixte, ses budgets et la protection/provision des clés sur hôte natif. Le modèle
standard complet L3, les entrées ordinaires L5 et la qualification A1–A10 restent
requis. Aucun modèle de fixture ne remplace leur livraison.

L’import d’index protège également les journaux contre une projection visible
périmée : le prédicat commun et les sélections SQLite/PostgreSQL incluent
`workflows/operation-records/`. La sélection SQLite couvre aussi explicitement
`workflows/process-instances/`. `verify-workflow-record-storage-fixtures.mjs`
exerce les producteurs réels sur les quatre namespaces protégés : refus d’une
version périmée, conservation des omissions SQLite et refus des omissions du
remplacement complet PostgreSQL. Le transport PostgreSQL est un double SQL ;
aucune qualification de concurrence PostgreSQL réelle n’en découle.

Prochain raccordement L2 : lier le choix de mode à une décision opérateur
authentifiée, appliquer cette décision aux artefacts canoniques, puis exécuter
le composant final du démarrage par `runSkillHookUseCase` et le hook existant
`start-session-hook.mjs`. Ce hook compose admission, `runWorkflowHookUseCase`,
checkpoint et chaîne de contraintes ; il ne réalise pas lui-même la création
de session. Son code de sortie JSON peut rester zéro sur un refus métier : le
port devra contrôler l’action et le résultat de l’admission, l’exécution réelle
du hook et les résultats imbriqués requis avant d’attester le démarrage complet.
Un choix de cycle attendu conservera son attente ; un checkpoint manquant ou
une chaîne de contraintes échouée ne deviendra pas un succès du skill.

Validation de la fondation de journal et de son raccordement, 2026-11-02 UTC :

- **PASS hors ligne** : `perf:verify-agentic-process` complète à huit suites,
  dont 20 scénarios de l’hôte des opérations et huit cas des producteurs de
  stockage. Les 14 scénarios des ports isolés et les régressions du moteur,
  du compilateur et de l’hôte natif sur transport simulé restent passants.
- **PASS** : définitions des deux nouveaux schémas, source de vérité,
  métadonnées, complétude de gouvernance, catalogues, documentation,
  sensibilité des fichiers suivis et topologie du package.
- **NOT_RUN** : workflow standard complet, autorisation native/opérateur réelle,
  inbox humaine/GitHub, cessation/réconciliation générale des propriétaires,
  PostgreSQL réel et qualification du parcours depuis une archive exacte.
  Le redémarrage de processus Node est une preuve de durabilité de ces reçus
  locaux ; il ne qualifie pas la reprise générale d’un hôte natif.

### Addendum L2/L4 — choix de mode et finalisation du démarrage

Le raccordement ajoute trois bindings internes, en complément des trois ports
de bootstrap :

| Activité | Port réel ou capacité | Résultat et limite |
|---|---|---|
| `mode_decision` | capacité hôte `humanSource.read/verify`, question fermée et inbox canonique | Aucun appel modèle. Absence : attente inchangée. Refus, report et annulation : reçus distincts sans succès implicite. Le canal d'identité reste un double de fixture. |
| `session_mode_apply` | CAS des artefacts session/état, admission réelle, grant explicite et propriétaire local | Le mode provient exclusivement du dernier choix authentifié et accepté de la même instance. Un JSON de mode fourni directement est refusé. |
| `session_start_finalize` | `runSkillHookUseCase` et `start-session-hook.mjs` existants | Exécute le hook, le checkpoint et les contraintes applicables ; contrôle les résultats imbriqués et les preuves. Un effet non confirmé conserve son propriétaire et exige réconciliation. |

Fichiers principaux : `standard-session-mode-operations.mjs`,
`standard-workflow-human-decisions.mjs`, hôte des opérations et contrats fermés
de question, source, inbox, plans et sortie v2. Les formats historiques ne sont
pas élargis. Le champ explicite UNKNOWN reste distinct d’un mode choisi, sans
modifier le lecteur historique qui le normalise à null.

`process_decision_inbox` couvre la source immuable, sa corrélation exacte à la
question, sa déduplication par autorité/type/identifiant externe et
l’acquittement réservé → reçu. Le CAS/projection existant est réutilisé ; les
producteurs d’index protègent ce cinquième namespace contre les projections
périmées. La référence logique `aidn:decision-source/<id>` résout la source
immuable. Le reçu du réducteur référence le document de résultat authentifié,
qui conserve les chemins physiques des preuves du hook.

La reprise de capture humaine en lecture seule n’autorise aucun rejeu des
effets déterministes. Un report exige une nouvelle intention explicite et une
nouvelle réponse authentifiée. Une reprise d’acceptation utilise le reçu retenu,
dans un nouveau processus Node, puis le même modèle/réducteur pour la simulation.

**Constat important sur le corpus db-only :** sa continuité canonique infère
un cycle ouvert dont l’objectif n’est pas défini. Le checkpoint signale
`uncertain_intent` avec une gate `warn`, bien que le hook extérieur retourne
`ok`. Ce parcours reste WAITING avec effet inconnu ; il ne prouve pas un
démarrage réussi. Le contrôle imbriqué est conservé. Les parcours THINKING
fichiers et dual constituent les cas positifs de cette tranche ; le db-only
constitue aussi un cas de refus après exécution du hook.

**Livrable restant explicite :** L3 doit encore livrer le modèle IR standard
distribué, ses décisions de cycle/carryover et ses branches de dérive/incident,
puis les autres parcours prévus par le plan. Aucun modèle de fixture séquentiel
ne constitue ce livrable. Il faut notamment un cas positif db-only sur contexte
cohérent, les modes/cycles applicables, le canal humain natif, les événements
GitHub, la reprise mixte générale et la cessation/réconciliation avant de
qualifier L2/L4 dans leur ensemble. L5 ne doit pas sélectionner cette tranche
partielle comme workflow standard complet. L6–L8 gardent leurs critères A1–A10,
natif et archive installée exacte.

Validation de cet addendum, 2026-11-02 UTC :

- **PASS hors ligne** : `npm run perf:verify-agentic-process`, neuf suites et
  217 contrôles, dont 33 scénarios du raccordement de mode, 20 de l’hôte des
  opérations et dix des producteurs de stockage. Le refus db-only est une
  assertion négative attendue ; aucun succès de démarrage n’en est déduit.
- **PASS** : huit définitions de schéma, source de vérité, métadonnées,
  complétude de gouvernance, catalogues de gates/surfaces, références
  documentaires, sensibilité des fichiers suivis et topologie du package.
  La route du changement est ASSURED.
- **NOT_RUN** : modèle standard complet distribué, démarrage standard positif
  db-only sur contexte cohérent, canal humain natif, Codex réel, PostgreSQL
  réel, reprise mixte générale et parcours depuis une archive installée exacte.
  La topologie sur clients jetables issus des sources ne remplace pas L8.

### Addendum L3 — premier composant IR distribué

Le démarrage d’une nouvelle session dispose maintenant d’un modèle JSON
autonome distribué, sans passage par XML :

```text
package/catalogs/process-models/aidn-standard-startup.v1.json
package/catalogs/standard-workflow-startup.v1.json
docs/architecture/STANDARD_WORKFLOW_IR_TRACEABILITY.md
src/application/runtime/standard-workflow-startup-composition.mjs
```

Le graphe exprime les six opérations de démarrage déjà raccordées. Le catalogue
épingle le modèle, les bindings de code, SPEC et les sources des skills. Le
chargeur fixe vérifie ces identités et crée l’hôte commun ; il ne construit pas
un nouveau graphe ni ne répare les empreintes. Les scénarios de ports réels
consomment ce fichier et choisissent la prochaine occurrence dans son curseur.
Seuls les scénarios isolés du protocole humain gardent un modèle de fixture.

Le descripteur `standard-workflow-model-source.v1` est lié au scope de l’hôte et
conservé dans les aperçus d’opération signés. Le modèle reste embarqué dans
l’instance. Le concept `standard_workflow_model` couvre le catalogue et cette
provenance, sans nouvelle table de coordination. Un hôte générique privé de
cette provenance ne peut adopter l’instance avec le seul graphe et la même clé.
Ces métadonnées ne remplacent ni les admissions ni les autorisations réelles.

`refresh-standard-startup-bindings.mjs` propose une actualisation en lecture
seule. `--write` est nécessaire pour changer les seuls hashes d’implémentation,
avec nouvelle révision explicite du modèle/catalogue. Le graphe reste inchangé.
Un changement de SPEC, de source de skill, de contrat ou de classe d’effet
déclarée exige une modification de source revue ; aucun rafraîchissement
automatique au chargement n’est admis. Les instances historiques ne changent pas.

Le test de modèle contrôle les assets publiés et les refus sur divergence. Le
test de démarrage ajoute un projet db-only vierge installé via les procédures
réelles, SQLite explicite et stub de découverte/login Codex. Le même JSON y
termine le composant de démarrage ; le corpus db-only historique conserve son
refus sur intention de cycle indéfinie. Les décisions humaines et grants
restent des capacités de fixture, avec acceptation dans de nouveaux processus
Node et comparaison exacte du rejeu/simulateur.

**L3 reste incomplet.** `aidn-standard.v1.json` et le catalogue standard complet
restent à livrer. Le composant actuel couvre seulement la création d’une nouvelle
session, le choix/application du mode et le hook associé. Les reprises de session,
cycles/carryover, audit branche/DoR COMMITTING, travail, dérive/incidents,
validation, clôtures, promotion, PR/revue/fusion et sync restent obligatoires.
L5 ne sélectionne pas cette tranche comme workflow standard complet. La preuve
positive de démarrage db-only sur sources ne clôt ni A1–A10 ni L7/L8.

Validation de cette tranche L3 :

- **PASS hors ligne** : `npm run perf:verify-agentic-process`, dix suites,
  248 contrôles. Les 20 contrôles de modèle/catalogue et les 44 scénarios de
  démarrage/décision consomment le composant distribué ou testent explicitement
  le protocole humain isolé. Le projet db-only cohérent est créé par
  l’installateur source réel ; aucun ancien cycle n’est supprimé pour obtenir
  ce cas positif.
- **PASS** : gouvernance du nouveau concept, métadonnées, source de vérité,
  catalogues de gates/surfaces et garde d’omission de la nouvelle suite,
  documentation, sensibilité, topologie et inclusion des assets dans le package.
  Le changement relève de la voie ASSURED.
- **NOT_RUN** : workflow standard complet, canal humain/Codex natif réel,
  événements GitHub réels, reprise mixte générale, PostgreSQL réel et parcours
  métier depuis une archive installée exacte. Les preuves présentes n’en
  tiennent pas lieu.

Le [contrôle des assets depuis une archive extraite](qualification/standard-workflow/startup-assets-2026-11-02.json)
qualifie séparément la distribution du composant au commit `5e915e6` : archive
générée localement, membres contrôlés, import dans un nouveau processus Node et
47 lectures synchrones d’assets limitées au package extrait. Les hashes modèle
et catalogue correspondent aux sources. Ce contrôle n’exécute aucun parcours
métier ou natif et ne clôt pas L8 ; l’archive temporaire est supprimée après
la vérification.


## Addendum — raccordement de la création du squelette de cycle

L2/L3 progresse avec un second composant distribué, distinct du modèle standard
complet : `aidn-standard-cycle-create.v1.json`, son catalogue versionné et
`standard-workflow-cycle-composition.mjs`. L'ordre des cinq occurrences vient de
l'IR : projection canonique avant admission, admissions réelles, création du
squelette et de la branche, audit de rattachement, projection après création.
Quatre bindings déterministes utilisent le journal signé, les grants explicites,
les stores canoniques et le même réducteur. Aucune allocation de modèle.

La création écrit les huit artefacts du cycle ainsi que session, snapshot et
CURRENT-STATE sous CAS. L'état reste OPEN/NOT_READY, scope non gelé et Native write
scope vide. Ce composant ne termine ni DoR ni le skill cycle-create. La sélection
humaine du cycle, R3, planification, admissions d'implémentation et finalisation
restent au périmètre restant L2/L3, avant travail, validation et clôture.

Le diagnostic ciblé de gouvernance confirme une auto-obstruction : admission
positive avant/après le verrou, négative pendant sa possession à cause du seul
fichier effects.lock. La correction bornée étend l'asset d'installation existant
.gitignore.append aux réserves runtime/contrôle. Elle conserve le gate réel de
propreté Git et ne retire aucun fichier déjà suivi. Une fixture doit prouver que
les changements métier restent bloquants et qu'un checkpoint Git externe permet
une nouvelle intention d'admission, sans rejouer les effets précédents.

**Dépendance explicite pour terminer le raccordement** : le hook réel cycle-create
peut produire un checkpoint réussi et un gate warn R05 avec
run_conditional_drift_check. Cette observation impose un parcours IR de dérive et
une attente durable ; elle ne vaut pas réussite du skill. Conserver et authentifier
le résultat du checkpoint, exécuter le contrôle applicable par ses vrais ports,
puis reprendre sans répéter les effets. Ne pas simplement ignorer warn, modifier
un marqueur ou rejouer le hook jusqu'à succès. Ce livrable reste ouvert dans le
modèle standard complet et le dispatcher mixte L3/L4/L5.

Validation attendue de cette tranche : suite cycle hors ligne sur files/dual/db-only,
plus db-only EXPLORING, attente d'admission réelle, grant refusé, entrée hostile,
création canonique, audit réel, refus d'écriture produit en NOT_READY, acceptation
dans un nouveau processus et replay/simulation exacts. Une panne SQLite sur la
dernière écriture doit aussi conserver un résultat incertain authentifié, le verrou
et l'attente après dix artefacts persistés, sans nouvelle intention de dispatch. La suite utilise les vrais
ports métier et des autorités hôtes doublées. Elle ne qualifie ni identité native,
ni PostgreSQL réel, ni exécution depuis le package installé. Les résultats exécutés
sont enregistrés séparément ; L2–L8 et A1–A10 restent ouverts.


Preuve exécutée du composant cycle : **PASS, 38 contrôles hors ligne**, vrais ports
sur projets jetables installés depuis les assets source. Quatre parcours nominaux
(files/dual/db-only COMMITTING et db-only EXPLORING), plus panne partielle db-only.
L'admission sale attend, une nouvelle intention reprend après checkpoint Git
externe, le reçu de création est accepté dans un nouveau processus sans effets
répétés, et replay/simulation reproduisent les hashes. La panne laisse dix
artefacts persistés, un résultat unknown authentifié, le verrou et WAITING ;
une nouvelle intention est refusée. Les six définitions de schéma cycle passent
leur validation. Autorités hôtes doublées ; appels modèle réels : zéro.
Ces PASS ne qualifient ni le skill cycle-create complet ni le workflow standard.

Régression de la tranche : **PASS, `npm run perf:verify-agentic-process`,
11 suites / 286 contrôles**. Les lectures historiques, le défaut moteur, le
compilateur, les reçus, les attentes humaines, les ports réels et les producteurs
de stockage restent vérifiés. Les 51 cas du lanceur utilisent le transport natif
simulé ; PostgreSQL utilise un transport SQL doublé. Contrôles source de vérité,
métadonnées, complétude de gouvernance, catalogues de gates/surfaces, références
documentaires, sensibilité, topologie package, frontière partagée et absence de
mutation CLI implicite : PASS. Route interne du diff préparé : ASSURED.

**NOT_RUN** pour cette tranche : client/canal humain natif réel, PostgreSQL réel,
parcours métier depuis une archive installée exacte, workflow standard complet et
reprise mixte générale. La sélection ordinaire du modèle standard, DoR/travail,
attente de dérive R05, validation, clôture, promotion, PR/revue et synchronisation
après fusion restent au périmètre restant du plan. Aucun marqueur historique
reference_only/unsupported n'a été promu pour produire ces PASS.


## Addendum — reprise authentifiée des attentes externes et humaines

L4 raccorde maintenant le protocole de contrôle existant au même hôte que les
opérations réelles. Nouveaux fichiers : `process-control-{request,source,inbox}.v1`
(schémas), `process-control-inbox.mjs`, son store et
`standard-workflow-control-inbox.mjs`. L'hôte expose préparation en lecture seule,
capture explicite, livraison explicite et lecture du reçu. L'IR conserve seul
le routage ; aucun runner de séquence métier parallèle n'est introduit.

La capture vérifie une capacité hôte read/verify, l'identité d'événement et le
contexte exact (instance/révision/modèle/occurrence/corrélation/événements permis,
branche/head et hash des documents gouvernés). L'inbox signée précède l'événement
canonique ; son acquittement suit cet événement. Une absence de source attend,
un contexte périmé refuse la livraison. Après livraison, une indisponibilité du
fournisseur ne réécrit pas le résultat accepté et n'empêche pas la réparation de
l'acquittement. Le même événement ne peut réveiller une autre attente.

Le concept process_control_inbox déclare autorité, métadonnées, rétention et
projections ; six réserves de records sont protégées des projections de masse.
Aucune conversion d'instance historique et aucun transfert implicite vers le
runtime partagé. L'accès aux résultats d'opérations antérieures reste authentifié.

Preuves ciblées attendues : files/dual/db-only réels, démarrage de session réel
avant attente, nouveau processus entre capture et livraison, reprise sans effets
répétés, duplicata après opérations ultérieures, contexte Git périmé, source brute
ou non vérifiée, tentative de falsification et panne SQLite de l'acquittement
après livraison canonique. Replay/simulation utilisent le même réducteur. Seule
la capacité de source est doublée ; ce n'est pas un test de fournisseur réel.

Ce raccordement ne ferme pas L4 : l'historique d'allocations/résultats natifs,
les fences et preuves de fermeture, contributions/exclusions de revue, budgets
cumulés et la reprise du lanceur mixte restent à implémenter. Restent aussi les
ports DoR/travail/validation/clôture/PR, le modèle standard complet, l'adaptateur
GitHub, l'entrée ordinaire et A1–A10. Une livraison d'événement ne constitue ni
la réalisation d'un contrôle R05 ni une approbation de PR ; leurs vrais ports et
leurs branches de refus doivent encore être raccordés.


Validation exécutée de l'inbox : **PASS, 22 cas d'intégration + 4 cas ciblés** de
bornage/annulation/projection/historique. Régression de l'hôte des opérations :
20 PASS ; catalogue/pins du modèle distribué : 20 PASS ; producteurs SQLite et
PostgreSQL (transport SQL doublé) sur six namespaces : 12 PASS. Total ciblé :
78 contrôles, plus trois définitions de schéma. Source de vérité, métadonnées,
complétude (37 concepts), diagnostics/use case et CLI de gouvernance, catalogues,
références documentaires, sensibilité et topologie package : PASS. Le required
gate agrégé inclut les nouveaux cas et son guard refuse leur omission ; toute
la commande agrégée n'a pas été relancée pour cette tranche ciblée.

La panne d'acquittement a laissé l'événement canonique unique et une capture
reserved. La réouverture l'a acquitté sans fournisseur et sans nouvelle livraison.
La panne de projection dual a rendu reconciliation_required ; une livraison
retenue explicite a réparé la projection sans modifier le checkpoint livré.
Les enregistrements et historiques valides mais falsifiés par simple rehash ont
été refusés. Ce sont des preuves hors ligne sur stores et ports réels avec
capacité source doublée, pas des preuves natives, fournisseur réel ou archive
installée. L4–L8 restent ouverts dans les limites indiquées ci-dessus.


## Addendum — activité native sur le contrat commun v2

Le contrôle du lanceur a confirmé un refus global des modèles v2, même sans
opérations D/H. La composition native accepte maintenant les graphes d'activités
v1/v2 sans nœud operation. Elle conserve le refus des graphes mixtes et refuse
les faits/événements bruts de control_scenario pour v2 avant allocation. Les
contrats/lecteurs v1 et la garde de démarrage restent inchangés.

Quatre contrôles ciblés passent sur la composition de production avec transport
natif doublé : activité v2 avec résultats canoniques et replay exact ; attente
v2 après travail avec ressources fermées ; refus des faits bruts ; refus des
événements bruts. Le test d'attente confirme aussi que la réouverture ne peut pas
requalifier un historique en instance vierge. Cette compatibilité est une
précondition du port natif mixte, pas sa livraison ni la reprise générale.

Prochain raccordement L4 : conserver sous autorité durable les résultats natifs,
identités/contributions/exclusions de revue, fermeture et budgets. Le code
agentic-process-execution-host conserve actuellement resources/observations/
results/prepared en Map et produit une autorité par hôte. Retirer seulement la
garde d'historique ferait perdre ces preuves et ne constitue pas une reprise.
Le dispatcher mixte devra composer cette autorité persistée avec celles des
opérations/inbox, sur la même instance, le même modèle et le même réducteur.


Régression exécutée de cette compatibilité : **PASS, 55 contrôles**, composition
native de production avec transport natif simulé, dont les quatre cas v2.
Les anciens refus d'opérations mixtes, verdicts terminaux, budgets, empreintes,
admissions natives, stockage, revue indépendante et fermeture restent vérifiés.
Le catalogue refuse désormais de substituer le filtre --v2-only à la suite requise.
Références documentaires, catalogues et sensibilité : PASS. Aucun client modèle
réel, aucun arbre natif Windows réel et aucune archive installée qualifiés ici.

Deux raccordements sont nécessaires avant le lanceur mixte : le scope natif actuel
est dérivé de projet/persistance, tandis que le scope de l'hôte d'opérations inclut
clé, source du modèle et protocole d'inbox. Une composition commune doit choisir
et vérifier une même autorité pour la nouvelle instance v2, en conservant les
lecteurs et scopes historiques. Ensuite, résultats, identités/contributions
(y compris après résultat partiel), exclusions de revue, consommations cumulées
et preuves de fermeture doivent provenir d'un journal authentifié durable.
Le superviseur owned fournit une preuve de terminaison de l'arbre ; le simple
native_parent_closure du worker ne remplace pas cette preuve. Une nouvelle
allocation doit avoir une autorisation et des plafonds compatibles avec le cumul,
sans prolonger implicitement l'ancien délai ou effacer un refus. La levée de la
garde d'historique dépend de ces preuves, pas du seul support du contrat v2.


## Addendum — conservation de l'état natif auparavant volatile

L'hôte natif expose maintenant un checkpoint borné native-host-state.v1. Il vérifie
les affectations contre ses observations émises, les résultats contre ses propres
reçus, leurs identités et les empreintes des fichiers de preuve. La composition
réelle le persiste après la tentative de fermeture des clients via le writer
existant, protégé et soumis au budget de stockage. Le résultat worker référence
ces octets ; le snapshot contient instance exacte, ressources/identités,
contributions, résultats, usages natifs observés et fermeture parent. Les hashes
et le nombre des réponses observées ainsi que l'autorisation sont liés à l'enveloppe.
Les prompts/developer instructions et le raisonnement n'y sont pas copiés.

Cette conservation ne prétend pas résoudre l'authentification inter-hôtes :
resume_authority reste explicitement non établie. Les données native_host_state
sont subsumées par l'instance agentique dans le registre de gouvernance. Restent
à composer le journal signé de génération/allocation, le fence, la preuve du
superviseur owned, les plafonds cumulatifs et l'autorisation explicite suivante.
Le lecteur historique et la garde native vierge restent actifs. Un hash de
checkpoint ou parent_closed ne suffit pas pour reprendre.

La qualification ciblée doit couvrir checkpoint nominal, rejet terminal conservé,
contributeur potentiel après interruption sans résultat accepté, identités et
compteurs retenus sans reconstruction depuis des Maps perdues. Les preuves
natives réelles et le parcours standard mixte restent à terminer.


La conservation reprend la limite existante de 262144 octets par preuve et le
quota global de l'allocation. Un dépassement est explicite ; aucune troncature
ou suppression de preuve ne produit un succès. Les limites du modèle standard
complet et la compaction/continuation de son historique restent à mesurer en L6.


Validation finale exécutée : **PASS, 59 contrôles** de la composition native,
transport natif simulé, zéro appel modèle réel. Les quatre cas de checkpoint
couvrent conservation nominale, refus terminal, interruption et corruption d'une
preuve native après fermeture. Les plafonds autorisés sont conservés comme
valeurs numériques en plus de leur empreinte ; leur contrôle cumulatif à la
reprise reste à composer. Les références natives transitives sont revérifiées.
Schéma, gouvernance (subsomption explicite), catalogue/garde des filtres de test,
références documentaires, sensibilité et topologie package : PASS. Route du diff
préparé : ASSURED. Client natif réel, arbre de processus réel et archive installée :
NOT_RUN. Le modèle standard complet, le dispatcher mixte et la reprise native
authentifiée restent incomplets ; aucun de ces PASS ne les clôt.


## Addendum — journal authentifié des allocations natives

Tranche interne de L4 : `journaled-native-allocation.mjs` compose le superviseur
owned réel avec une réservation CAS avant lancement et une observation après
fermeture. La clé hôte externe ne passe ni dans le JSON du modèle ni au worker.
Le journal signé `native-allocation-journal.v1` lie génération, owner, instance,
scope/modèle, configuration, autorisation et plafonds. Il référence les octets du
checkpoint et du footer owned, conserve les empreintes du résultat et de la
preuve d'arbre, ainsi que les identités hashées des réponses et le débit de
stockage observé. La lecture demandée revérifie aussi les références natives
transitives du checkpoint.

Fichiers : composition et store dédiés, contrat/validateur du journal,
`agentic-process-owned-run.mjs`, couverture des pins directs, règles source de
vérité/métadonnées/diagnostics, protection CAS et producteurs d'index SQLite/PG,
ignore des fichiers privés du client et fixtures natives/stockage. Les catalogues
des composants startup et cycle reçoivent une révision explicite de leurs pins
d'implémentation après modification de la protection des artifacts ; aucun
runtime ne répare ses pins ou ne convertit une instance historique.

Une réservation interrompue bloque le prochain lancement. Une fermeture d'arbre
inconnue reste unresolved ; un rejet reste failed. Une panne d'enregistrement
après un worker terminé conserve son résultat observé et produit au niveau de
la composition WAITING_FOR_RECONCILIATION, jamais une réussite implicite. Les
lectures/preview ne réservent rien. Aucun PID ou délai n'autorise une reprise.
Les générations sont bornées à 32, les plafonds et délais initiaux ne peuvent
augmenter implicitement, les consommations connues antérieures sont débitées et
une consommation inconnue bloque. Ces compteurs ne prétendent pas mesurer la
facturation ni la taille physique d'un serveur PostgreSQL.

Cette tranche ne termine pas L4. Restent explicitement : admission authentifiée
d'un historique natif dans le nouvel hôte, restauration des contributions et
exclusions de revue sans réutiliser une ressource fermée, scope commun du
modèle/ports natifs/opérations/inbox, dispatcher mixte, autorité d'une nouvelle
allocation après attente longue et budget de continuation. La garde actuelle
refuse toujours un historique non vierge. Le branchement des entrées ordinaires
CLI/console et le modèle standard complet restent L3/L5 à livrer ; un journal
signé n'en tient pas lieu. A1–A10, fournisseur/humain réel, natif réel et archive
installée exacte restent nécessaires. La composition interne n'est pas encore
le chemin standard par défaut.


Limite comptable explicite : `storage_debit_bytes` reprend le débit du worker
existant, augmenté des footers worker et owned. Le journal d'allocation lui-même
est un artifact canonique borné séparément ; il n'est pas inclus dans ce débit.
Le contrat de continuation L4 doit préciser le quota total de métadonnées et
ses coûts de projection avant d'exposer ce compteur comme budget global du
workflow. Le temps de réservation, lui, est déduit du délai original avant
lancement ; une réservation qui consomme la réserve de fermeture interdit le
lancement et reste à réconcilier.


Validation de cette tranche, hors ligne : la suite native complète a passé ses
72 contrôles avant la correction finale du délai/plafond. Après cette correction,
les 17 contrôles ciblés owned/journal passent, dont attente persistée, refus du
reset de plafond, réserve de fermeture et conservation du résultat observé lors
d'une panne de clôture canonique. Les 14 contrôles des producteurs de stockage
(SQLite réel et transport PostgreSQL doublé), 20 du catalogue/modèle publié et
44 du composant de démarrage passent. Le schéma du journal est validé. Source de
vérité, métadonnées, complétude des 38 concepts, diagnostics de gouvernance et CLI,
catalogue/guard des invocations, références documentaires, sensibilité et
topologie package : PASS. Les rafraîchissements de pins sont ensuite des no-op
sans écriture (startup révision 6, cycle révision 4). Route du diff préparé :
ASSURED. Le gate agentique agrégé et l'ensemble des familles de PR ne sont pas
revendiqués comme exécutés sur cette tranche ciblée. Client/arbre natifs réels,
PostgreSQL réel et parcours standard complet sur archive installée : NOT_RUN.


Régression complémentaire terminée après `dfda1af` : **PASS, 38 contrôles** du
composant cycle distribué, ports réels et stores locaux, capacité d'autorisation
doublée. La panne partielle de CAS conserve owner/unknown, survit à la
réouverture et interdit le rejeu des effets. Cette preuve hors ligne ne qualifie
ni le skill cycle-create complet ni le workflow standard, le natif ou l'archive
installée. Les deux suites de régression complémentaires sont terminées
(démarrage 44, cycle 38) ; aucun test de cette tranche ne reste en cours.


## Addendum — reprise native authentifiée après résultats et événement

La composition interne `createJournaledNativeAllocation` raccorde maintenant
`resume: true` au lanceur owned réel. Avant une nouvelle réservation, elle vérifie
la fermeture prouvée de la génération précédente, son checkpoint et ses preuves
natives transitives. Les événements reçus depuis ce checkpoint doivent correspondre
aux captures d'inbox signées, au préétat du réducteur et au contexte actuel
(configuration, produit, branche et HEAD). Un simple historique bien hashé n'est
pas admis. Une projection requise absente ou périmée bloque avant réservation ;
la réparation explicite d'une livraison retenue peut la rétablir.

Le worker Node fixe et épinglé vérifie séparément la réservation, sa génération,
son owner, la configuration, l'autorisation, le préétat canonique et l'historique.
Évolution explicite de la frontière de confiance : une capacité de vérification
éphémère est transmise à ce worker applicatif privilégié par son canal d'entrée
privé borné. Elle ne figure ni dans le modèle/configuration auteur, ni dans les
processus modèle, prompts, RPC natifs, environnements modèle, artifacts, preuves
ou résultats. Le helper de contrôle de processus transporte ce canal en mémoire ;
aucune distribution publique de clé n'est ajoutée. L'isolation OS et le canal
natif réel demandent toujours leur preuve L7.

L'hôte restauré conserve son identité logique, les résultats acceptés et les
identités/contributions historiques. Les anciennes ressources restent fermées,
sans observation de disponibilité, réutilisation ou nouveau travail. La nouvelle
allocation ouvre de nouvelles sessions ; une revue indépendante reçoit les
exclusions des auteurs précédents. Les dossiers de preuves et snapshots de revue
ont une identité de génération distincte, sans collision avec un autre ID de
processus. Le modèle, l'instance, les événements et le réducteur restent communs
à l'exécution, au replay et à la simulation.

Les plafonds et délais existants restent contraignants. Une attente sans événement
n'alloue aucun worker ni modèle. Un événement accepté ne ré-exécute pas le travail
précédent ; un rejet, une réservation interrompue ou une fermeture incertaine ne
reçoit pas de nouvelle tentative. Le démarrage ordinaire conserve sa garde
vierge : la reprise est un chemin explicite et authentifié. Les lecteurs v1/v2
historiques et les captures d'inbox existantes ne sont pas convertis.

Fichiers principaux : `native-allocation-evidence.mjs`,
`native-allocation-worker-authority.mjs`, `native-allocation-controls.mjs`,
composition/hôte/worker/superviseur agentiques, `journaled-native-allocation.mjs`,
politiques de source de vérité/métadonnées/diagnostics, pins directs, ADR-0025,
matrice de scope runtime et suite native de production.

Les sept premiers contrôles passent hors ligne : provenance refusée pour un
événement auto-hashé sans inbox, HEAD changé avant livraison ou reprise, projection
dual absente, owner de worker altéré et parcours files/dual/db-only avec résultats
antérieurs, attente, événement authentifié, nouvelle revue et replay exact. Le
parcours files reprend dans un nouveau processus Node ; les anciennes Maps ne
participent pas à la preuve. Les transports contrôleur/natif/fournisseur sont
doublés et explicitement déclarés. Ces contrôles n'établissent pas un client
natif réel, un arbre Windows réel ou un fournisseur de PR réel.

Restent L4 : scope commun et dispatcher mixte opérations/activités/inbox,
réconciliation explicite des inconnus et contrat d'une nouvelle allocation après
expiration du délai conservé. Restent également les ports L2 manquants, le modèle
standard complet L3, son branchement ordinaire L5 et A1–A10/L6–L8. La reprise native
sur un modèle de qualification ne ferme aucun de ces livrables. La suite complète
du lanceur est exécutée séparément après cette tranche ciblée ; son résultat est
consigné ci-après lorsqu'il est disponible.


Contrôle supplémentaire du canal privé : **PASS**, entrée worker fixe réellement
exécutée dans un nouveau processus Node, modèle initialement en attente, zéro
client/modèle natif démarré. Le worker authentifie son owner ; une altération le
fait échouer, et la clé ne figure ni dans stdout/stderr ni dans les JSON retenus.
Le contrôleur externe reste doublé : cette preuve ne qualifie pas le Job Windows
ou le confinement modèle. La sélection locale est --worker-only ; la commande
requise complète inclut ce contrôle sans filtre.


Régression de la tranche terminée : **PASS, 81 contrôles** de la suite complète
de composition native (les sept reprises et les régressions antérieures), puis
**PASS, un contrôle supplémentaire** de l'entrée worker réelle ajouté pendant
cette exécution. Le code de production est identique pour ces deux validations ;
la commande requise sans filtre inclut désormais les 82 contrôles. Le gate
agentique agrégé et les 60 gates/familles de PR sélectionnés par le routeur ne
sont pas revendiqués comme tous exécutés localement. Route du diff : ASSURED.
Source de vérité, métadonnées, complétude (38 concepts), diagnostics/CLI de
gouvernance, catalogue/guard, références documentaires, sensibilité et topologie
package : PASS. Les pins des deux composants standard restent exacts sans
rafraîchissement (startup 6, cycle 4). Aucun test de cette tranche ne reste actif.
Client/arbre natifs réels, fournisseur réel et parcours standard complet sur
archive installée : NOT_RUN.

Priorité de raccordement suivante : terminer les ports métier L2 et le modèle
standard L3, avec le dispatcher mixte comme dépendance d'exécution. Le signal
`L2_SIGNAL_TRIGGERED` / `run_conditional_drift_check` du squelette de cycle doit
rejoindre un véritable diagnostic R05. SPEC-R05 et le skill source imposent un
rapport, une qualification de la dérive et une décision de récupération ; les
écritures CR/parking-lot et arbitrages restent explicitement autorisés. La route
actuelle du hook drift-check appelle gating-evaluate avec --complete-drift-check :
elle acquitte une exécution annoncée du diagnostic, elle ne réalise pas son
analyse. La prochaine réalisation ne peut donc ni appeler seulement ce hook,
ni ignorer warn, ni déduire DoR/scope_freeze d'une réussite de checkpoint. Elle
doit relier diagnostic, preuve, décision éventuelle et postconditions aux ports
réels avant de finaliser le cycle et d'autoriser le travail produit.

## Addendum du 2026-11-02 — hôte mixte interne, livraison partielle L4

`standard-workflow-mixed-composition.mjs` raccorde les ports existants à une
seule instance IR v2 et au même réducteur. Le curseur choisit le type de port,
sans branchement métier codé dans le dispatcher. Une opération déterministe et
une attente humaine/externe ne demandent aucun appel modèle. Chaque écriture
conserve son aperçu exact, son intention explicite, son autorisation et son reçu
authentifié. La tranche native se ferme avant la prochaine opération.

`standard-process-authority.mjs` fixe un nouveau scope `standard-mixed.v1`
projet/persistance/modèle/source/clé. La réouverture vérifie tous les journaux
opérations et contrôles, puis les événements natifs couverts par le checkpoint
d'allocation signé. Le worker fixe reconstruit cette autorité avec le protocole
privé v2. Aucun JSON rédigé ne fournit une clé, un scope ou un module exécutable.
Les scopes historiques et les lecteurs existants ne sont pas convertis.

La tranche native prend le même propriétaire local d'effets que les mutations
métier. Une allocation active, interrompue ou incertaine bloque les opérations
concurrentes ; aucune reprise par PID/temps ni nouvelle tentative implicite. Une
fermeture confirmée libère ce propriétaire. La reprise conserve les plafonds et
délais d'origine, crée de nouvelles sessions et transmet les exclusions de
contributeurs à la revue. Aucun contrat d'extension de délai n'est ajouté.

Les empreintes des composants distribués sont révisées explicitement : démarrage
7, squelette de cycle 5. Aucun rafraîchissement silencieux à l'exécution. Le
modèle de qualification mixte emploie les vrais ports de rechargement, admission
et initialisation de session sur un projet jetable installé depuis les sources,
puis une activité native, un événement signé et une revue. Il ne remplace pas
`package/catalogs/process-models/aidn-standard.v1.json`, encore à livrer.

Validation de cette tranche terminée : partitions mixte et native antérieure sur
les mêmes sources de production immuables. Les résultats terminaux sont consignés
ci-dessous. Les transports contrôleur/natif/fournisseur sont doublés ; aucune
preuve de client modèle réel, de Job Windows réel ou de fournisseur PR réel ne
s'en déduit. Le projet installé depuis les sources n'est pas une installation
d'archive exacte.

Restent L2 : diagnostic R05 réel, DoR/scope de travail, clôtures, promotion et
ports de revue/synchronisation. Restent L3/L5 : modèle standard complet traçable
à SPEC et sélection par les entrées ordinaires. Restent L4 : réconciliation
explicite des effets inconnus, canaux humains/fournisseurs réels et continuation
au-delà des délais initiaux. A1–A10/L6–L8 restent à qualifier séparément hors
ligne, en natif et sur package installé exact. Le dispatcher mixte ne clôt aucun
de ces critères à lui seul.

Limite conservatrice de reprise : après le dernier checkpoint natif, le contexte
d'un contrôle signé doit encore correspondre exactement au contexte courant pour
admettre une tranche native. Un changement intermédiaire, même issu d'un port
déterministe, peut donc imposer une nouvelle admission au lieu d'être adopté.
Le traitement contrôlé de ces changements et de la fraîcheur métier d'une revue
reste à qualifier avec le modèle standard complet ; aucune revue ancienne ne
doit être rendue fraîche par une simple mise à jour de contexte.

Point d'entrée métier suivant : le diagnostic R05 doit disposer d'un résultat
structuré authentifié et lié aux entrées courantes avant son port de finalisation.
La réponse native actuelle est fermée à `outcome`/`summary` ; un simple texte
annonçant `completed` ne prouve donc ni le rapport de dérive ni sa qualification.
Prévoir un contrat métier borné pour le rapport, un producteur agentique ou humain
authentifié, puis un consommateur déterministe qui vérifie sa provenance, les
preuves et les autorisations avant d'appeler le hook réel. Les suggestions de
CR/parking-lot et les arbitrages doivent rester distincts des écritures autorisées.
Ce raccordement dépend du présent hôte mixte ; il précède la finalisation de cycle
et l'admission DoR/travail. Il ne doit pas se réduire à renommer un résultat natif.

Preuves de la tranche : **PASS**, cinq cas mixtes (files/dual/db-only, refus
d'autorisation, interruption avec propriétaire conservé), les 82 régressions
natives antérieures et deux cas worker dont un nouveau contrôle v2. Le cas worker
v1 recoupe les 82 régressions : il s'agit de 88 cas distincts, exécutés par
partitions, pas d'une nouvelle exécution de la commande agrégée sans filtre.
Le worker fixe v2 est réellement lancé dans un nouveau processus Node et s'arrête
avant l'opération prête, avec zéro client modèle. La reprise mixte files se fait
également dans un nouveau processus Node ; les trois modes vérifient le replay
et la simulation exacts et les checkpoints. Les régressions de reprise native
antérieures couvrent l'exclusion des anciens contributeurs.

Autres contrôles **PASS** : réducteur/service (38), catalogue standard (20), hôte
d'opérations antérieur (20), défaut moteur (10), console (12), source de vérité
(35 politiques), métadonnées (37), complétude de gouvernance (38 concepts), CLI
de gouvernance, catalogue des gates, contrat Markdown, références, sensibilité et
topologie package. Le contrôle en lecture seule confirme les révisions startup 7
et cycle 5 sans rafraîchissement nécessaire. Route du diff : ASSURED, sans issue.
La commande agentique agrégée et les 60 gates de PR sélectionnés ne sont pas
revendiqués comme tous exécutés localement. Aucun test de cette tranche ne reste
actif. Client/arbre natifs réels, PostgreSQL réel, fournisseur PR réel et parcours
standard complet depuis une archive installée exacte : **NOT_RUN**. Le livrable
standard complet reste ouvert.

## Addendum — résultat métier R05 avant finalisation

Le contrat `standard-drift-report.v1` et le mapping interne `activity_outputs`
relient une activité portant le skill source exact à une sortie métier bornée.
L'hôte observe les documents canoniques, le but de session ou du brief de cycle,
le diff/statut Git et les fichiers produit contrôlés après admission réelle
`drift-check`. Le rapport porte le hash de ce contexte, les objectifs comparés,
la dérive, les éléments keep/discard, les recommandations de séparation et les
preuves observées. `changes` désigne les écarts diagnostiqués ; le diff observé
constitue une entrée distincte. Un résultat failed/rejected conserve une sortie
nulle ; un simple summary ne peut devenir un rapport completed.

Le binding déterministe `drift_report_evaluate` ne reçoit que l'identité de
l'occurrence productrice. Il authentifie son résultat accepté et ses références
via le checkpoint d'allocation, réobserve admission/contexte/preuves et publie
des faits de routage. Aucun appel modèle supplémentaire, aucune écriture métier
de récupération et aucun acquittement du hook R05. Le rapport est une preuve
d'activité protégée et son évaluation demeure dans le journal d'opérations ;
`native_activity_output` est explicitement subsumé sous l'instance de processus.

Le futur catalogue standard L3 doit distribuer les bindings de sortie native et
leur mapping vers les activités, avec les pins SPEC/skill/code ; la présence de
ces mécanismes dans l'hôte n'en tient pas lieu. Restent L2 : canal humain de
récupération/arbitrage, écritures autorisées du rapport/CR/parking-lot, véritable
finalisation R05, cycle/DoR/travail/clôtures/promotion/PR/synchronisation. Restent
aussi le modèle complet, son entrée ordinaire et toutes les preuves A1–A10,
natives et sur archive installée exacte. Les résultats ciblés sont consignés
ci-dessous ; ils ne qualifient pas la réalisation complète de R05.

La livraison de données au diagnostic est bornée : seul le diff des fichiers
produit configurés est transmis en clair ; les autres changements restent des
empreintes/comptages. Les racines privées interdisent aussi la livraison des
documents de diagnostic. Une couverture partielle publie
`drift_context_complete: false` et impose le routage de récupération, même si le
rapport ne constate pas de dérive dans son contexte observé. Un cycle terminal
qui possède encore la branche est refusé explicitement : son contexte de
diagnostic après transition reste à raccorder avec la finalisation R05.

Preuves finales ciblées : **PASS**, deux contrôles rapides (contrat/sémantique
structurelle et frontière Git privée), trois parcours de production files/dual/
db-only sur projets jetables installés depuis les sources, puis les quatre
régressions natives v2 sans sortie métier. Le parcours files contient réellement
une modification privée protégée : son contenu est absent du contexte natif et
le rapport none conduit à l'attente de récupération. Les trois parcours vérifient
une seule session native doublée, l'évaluation déterministe sans nouvel appel
modèle, l'attente et le replay/simulation exacts. Les références inventées,
contexte périmé, sortie manquante/incohérente, mapping de schéma arbitraire et
preuves natives modifiées sont refusés.

Régressions complémentaires **PASS** : 83 contrôles natifs antérieurs sur la
candidate avant le dernier raffinement de couverture privée et de prévalidation,
20 contrôles de l'hôte d'opérations et 38 du réducteur/service. Les régressions v2
et les cinq contrôles R05 ci-dessus portent sur le code final de la tranche ;
ces ensembles ne sont pas revendiqués comme une exécution agrégée sans filtre.
Le catalogue final passe ses 20 contrôles et les pins startup 12/cycle 10 sont
exacts sans réparation à l'exécution. Source de vérité, métadonnées, complétude
(38 concepts gouvernés, sortie typée subsumée), CLI de gouvernance, catalogue de
gates, contrat Markdown, références, sensibilité et topologie package : PASS.
Une annotation non prise en charge a été corrigée en title ; la prévalidation
du schéma précède désormais l'allocation native. Aucun test de cette tranche ne
reste actif. Route ASSURED sans issue ; les 60 gates de PR sélectionnés ne sont
pas tous exécutés ici. Modèle natif réel, confinement/Job Windows réel,
PostgreSQL/fournisseur PR réels, workflow standard complet et archive installée
exacte : **NOT_RUN**.

Prochaine étape L2 : consommer cette évaluation authentifiée pour persister le
rapport métier et finaliser le vrai hook R05, seulement après contexte courant,
autorisation d'effets et récupération/arbitrage humain requis. Couvrir le cas
sans dérive, les refus/reports/annulations, les effets inconnus et le diagnostic
après transition du cycle. Les ports DoR/travail/clôture/promotion/PR/sync et le
modèle standard complet restent ensuite explicitement ouverts.

Raccord de données L3/L5 à livrer explicitement : le modèle/catalogue standard
doit déclarer comment les paramètres de démarrage, observations canoniques et
résultats antérieurs alimentent chaque entrée d'opération. Le pilote de
qualification initial fournissait explicitement `report_occurrence_id` et
`evaluation_operation_id` ; cela ne prouvait pas une résolution générale par le
modèle. L'addendum des raccords déclaratifs ci-dessous décrit l'infrastructure
suivante ; ses mappings dans le modèle standard restent à livrer. Prévoir un résolveur commun
borné, sans code/JSONPath arbitraire, avec corrélation d'instance et de portée de
boucle/appel. Les entrées effectivement résolues restent liées aux intentions,
aperçus et reçus authentifiés. L'acceptation du workflow standard doit montrer
ce raccord sans ordre de nœuds ni routage métier recodés dans un pilote ad hoc.

## Addendum — conservation du diagnostic et vrai hook R05 sans dérive

Cette tranche L2 ajoute `drift_check_finalize` au registre interne déterministe.
Elle consomme seulement l'identité de l'évaluation déjà acceptée, authentifie
son journal, son reçu et son producteur natif, puis réévalue son applicabilité
au contexte courant. Un changement de configuration productrice refuse la
nouvelle consommation sans empêcher la lecture de l'historique. Un rapport
partiel, une dérive ou une récupération encore requise interdit la finalisation.
L'authentification prouve la provenance du diagnostic, pas sa justesse sémantique.

La préparation appelle le vrai port de gating sans émettre d'événement. Elle
conserve les contrôles de périmètre, d'intégrité, de réparation et d'intention ;
seul l'âge du contrôle que le hook réalise peut être acquitté par sa réalisation
effective. Le port n'invente ni décision de reload, ni seuil moins strict, ni
approbation de récupération. Le mode du hook reste COMMITTING comme dans le
routage existant du skill. Aucun modèle n'est appelé par cette opération.

Sous aperçu exact, autorisation explicite recontrôlée et propriétaire local
d'effets, le port persiste une copie diagnostique canonique immuable par le CAS
d'artefacts existant. La projection de `workflows/drift-reports/<op>.md` suit
files/dual/db-only. La règle ignore doit être effectivement installée ; le port
ne répare pas implicitement un ancien client. Cette copie reste une preuve
rattachée à l'instance, sans nouvel état de workflow ni nouvelle permission.

Le port invoque ensuite réellement le hook fixe `drift-check`. L'identité de run
est générée par l'application et ne peut être injectée dans un autre routage.
Un résultat favorable seul ne suffit pas : il faut son unique événement propre
nouvellement ajouté, sa branche, son mode et son horodatage, avec position et
hash conservés. Révision du processus, contexte et autorisation sont recontrôlés
aux frontières d'effets. Le reçu confirmé publie `drift_check_completed: true`.
Après effet possible sans observation suffisante, aucun fait de réussite n'est
produit : réconciliation durable, propriétaire conservé et aucune réexécution
automatique. Une reprise après reçu confirmé conserve le résultat du hook.

Fichiers : `standard-drift-finalization.mjs`,
`standard-process-authority.mjs`, `standard-workflow-operation-host.mjs`,
`standard-workflow-operations.mjs`, `skill-hook-use-case.mjs`, contrats
`standard-drift-followup-input.v1`, `standard-drift-finalize-plan.v1` et
`standard-drift-output.v1`, pins d'implémentation et catalogues des composants,
ignore du scaffold et corpus `verify-agentic-process-execution-fixtures.mjs`.
ADR-0025, guide d'exécution, périmètre runtime et relation de subsomption de la
preuve diagnostique décrivent cette frontière sans ajouter de table partagée.

Validation finale ciblée **PASS** : six nouveaux cas sélectionnés par
`--drift-finalize-contract-only`, les trois `--drift-finalize-mode` et les deux
`--drift-finalize-case`. Le contrat fermé, le routage fixe et les refus des
préconditions dérive/couverture/récupération sont hors ligne avec dépendances
doublées. Les trois modes ont exécuté le vrai stockage et le vrai hook sur
projet jetable installé depuis les sources ; deuxième dispatch sans répétition
et simulation/rejeu exacts de la même IR/réducteur. Files refuse aussi une
configuration productrice changée et un refus explicite d'effets. La révocation
au verrou avant premier effet produit un reçu bloqué/no_effect ; la perte
d'observation après hook produit unknown sans fait de succès et sans relance.
Le diagnostic agentique utilise un transport natif substitué.

Régressions ciblées **PASS** : contrats de rapport et Git contrôlé (deux cas),
quatre contrôles v2 natifs sur transport substitué, 20 de l'hôte d'opérations,
38 du réducteur/service, 20 du catalogue, hooks dual/db-only, 12 exemples de
contexte de skills, namespace et couverture des skills. Source de vérité (35),
métadonnées (37), complétude (38 concepts gouvernés), CLI de gouvernance,
catalogue des gates, contrat Markdown, références documentaires, sensibilité et
topologie package passent. Les révisions startup 17/cycle 15 sont exactes ; la
vérification sans write ne répare rien. Suite agentique complète non filtrée :
**NON_REJOUÉE** ; ces sélections ne la remplacent pas et les gates de PR de la
route ASSURED ne sont pas toutes exécutées. Aucun test de la tranche ne reste actif.

Deux erreurs de développement ont été corrigées : mauvais dossier du script
reload lors de la première préparation et point de révocation trop tôt dans le
test. Ce dernier cible désormais le verrou d'effets, sans dépendre d'un compteur
d'appels. Le vérificateur historique des exemples a aussi été aligné sur les
noms publics actuels et l'admission en lecture seule de context-reload, en
conservant les onze autres exemples de hooks. Aucun changement des règles des
skills n'a été nécessaire pour ces corrections.

Preuves natives réelles (modèle, confinement/Job Windows, PostgreSQL et
fournisseur PR), parcours standard complet et qualification sur archive
installée exacte : **NOT_RUN**. La topologie package vérifiée ne constitue pas
une qualification du workflow standard sur cette archive.

Reste explicitement L2/R05 : décision humaine durable et ports de récupération,
refus/report/annulation sans réussite implicite, réévaluation après récupération,
contexte propriétaire après transition du cycle, et réconciliation explicite
d'un effet inconnu. La finalisation sans dérive ne clôt pas ces travaux.
Restent ensuite DoR/travail/clôtures/promotion/PR/synchronisation, modèle complet
`aidn-standard.v1.json`, raccords de données déclaratifs L3/L5 et sélection par
les entrées ordinaires. L6 conserve A1–A10 par les vrais ports sur projet jetable,
rejeu/simulation et lecture historique ; L7 les preuves natives et fournisseurs
réels ; L8 la qualification de l'archive installée exacte. Aucun de ces lots
n'est remplacé par le choix du moteur par défaut ou les composants catalogués.

## Addendum — contexte R05 du propriétaire terminal

La tranche précédente laissait explicitement ouvert le diagnostic après
transition. Le lecteur de contexte consulte désormais le vrai port
`runCycleCloseAdmitUseCase`. Sur branche de cycle/intermédiaire, ce port doit
identifier un propriétaire canonique unique ; le lecteur recoupe son état et
les ancres session/cycle. Un propriétaire terminal admis fournit son brief,
statut, plan et change-requests, même lorsque `active_cycle` vaut none. Le corps
et l'évaluation signée distinguent `session`, `active_cycle` et
`cycle_completion`, avec l'état canonique du cycle. La sélection reste une
lecture : ni réactivation, ni permission de travail, ni acquittement de R05.

Un propriétaire absent/ambigu, une matrice d'usage bloquée, une ancre d'un autre
cycle ou un cycle ouvert sans ancre ne peuvent fournir un objectif de repli.
Le contexte relu lors de l'évaluation/finalisation doit rester identique ; un
brief changé impose un nouveau diagnostic. L'autorité commune attend cette
lecture asynchrone avant tout appel natif. Les implémentations des admissions
et du gating font partie des pins explicites ; les catalogues sont rafraîchis
par révision, sans réparation à l'exécution ni conversion d'instances anciennes.

Fichiers : `standard-drift-report.mjs`, `standard-process-authority.mjs`, clôture
des pins dans `standard-workflow-operations.mjs` et
`agentic-process-implementation-pins.mjs`, catalogues des composants,
`verify-agentic-process-execution-fixtures.mjs`, ADR-0025 et guides associés.
Dépendance : diagnostic typé et finalisation propre livrés par `65fec23` et
`28422eb`. Acceptation ciblée : vrai objectif du propriétaire, refus des contextes
invalides, vrai hook, statut terminal/ancre inchangés, dispatch conservé et
simulation/rejeu exacts avec le même modèle/réducteur dans les trois modes.

La préparation des tests emploie les vrais ports de bootstrap, mode et création
de cycle ; l'état terminal est ensuite posé comme **précondition de fixture**.
Elle ne prouve pas les ports de validation et de transition terminale encore à
livrer. Le transport natif reste substitué.

Validation finale ciblée **PASS** : les trois sélections
`--drift-completion-mode=files|dual|db-only`, avec DONE/NO_GO/DROPPED et branche
intermédiaire. L'état actif est aussi lu avant la précondition terminale. Les
objectifs cycle/session restent distincts ; le vrai hook aboutit, le reçu est
conservé, le cycle n'est pas réactivé et le replay/simulateur retrouve le même
hash. Files refuse matrice incomplète, propriétaire absent/ambigu, ancre ouverte
manquante, autre cycle actif et brief changé. Db-only utilise son brief canonique
malgré la projection visible erronée. Le parcours antérieur
`--drift-finalize-mode=files` passe également, ainsi que les deux sélections de
contrats de rapport/finalisation, 38 contrôles du réducteur et 20 du catalogue.

Source de vérité (35), métadonnées (37), complétude (38 concepts gouvernés), CLI
de gouvernance, catalogue des gates, Markdown, références, sensibilité et
topologie package : **PASS**. Les pins startup 20/cycle 18 sont vérifiés sans
écriture ni réparation. Les premiers essais ont corrigé deux préconditions de
fixture : checkpoint explicite après projection du digest et checkpoint vide
autorisé en db-only, où le choix de mode ne modifie aucun fichier projeté.
Aucune règle d'admission produit n'a été abaissée pour ces essais.

Suite agentique complète non filtrée et ensemble des gates de PR :
**NON_REJOUÉS** dans cette tranche. Modèle/confinement/Job Windows/fournisseurs
réels, parcours standard complet et archive installée exacte : **NOT_RUN**.
La topologie package vérifiée ne qualifie pas son exécution du workflow standard.

Restent explicitement L2 : récupération humaine R05 et ses écritures autorisées,
réévaluation après récupération, réconciliation explicite des effets inconnus,
DoR/travail/validation/transitions/clôtures/promotion/PR/synchronisation. L3/L5
doivent encore livrer le modèle standard complet et ses raccords de données
déclaratifs puis ses entrées ordinaires. Les pilotes de cette tranche fournissaient
les identités de résultats à la main ; l'addendum suivant traite cette limite. L6–L8
conservent les parcours A1–A10, attentes/refus/reprises, preuves natives réelles,
lecteurs historiques et qualification de l'archive installée exacte.

La capture d'un choix humain seule ne terminera pas la récupération R05 :
prévoir conservation des constats, choix authentifié, véritable port de
récupération sous son autorisation, puis réévaluation et hook. Les écritures
connues de conservation modifient elles-mêmes le contexte Git/canonique : leur
chaîne de reçus et leurs hashes avant/après doivent distinguer ces effets
attendus d'un changement externe, sans désactiver la fraîcheur générale ni
demander au modèle de recopier une preuve déjà conservée. Une couverture
partielle ne devient pas complète par simple approbation humaine.

## Addendum — raccords de données déclaratifs L3/L5

Les pilotes précédents fournissaient eux-mêmes les identités de diagnostic et
d'évaluation. Cette tranche ajoute l'infrastructure permettant au modèle de les
déclarer : `data_bindings` optionnel en IR v2, contrat
`process-data-bindings.v1`, paramètres immuables `initial_parameters` dans le hash
d'instance, et `process-resolved-input.v1` dans l'aperçu signé. Sans cette option,
les formats et hashes historiques restent inchangés ; aucun paramètre vide n'est
ajouté silencieusement. Les paramètres n'initialisent aucun fait d'approbation.

Chaque opération du modèle optant pour ce contrat déclare ses champs d'entrée.
Le résolveur commun sélectionne des littéraux/paramètres, identités complétées,
entrées/sorties de journaux acceptés et item courant de multi-instance. Chemins
de clés bornés, ordre structurel garanti et portée d'activation sont validés.
Une autre itération/item/appel ne peut fournir une valeur implicitement. Les
exports composés, agrégations et dépendances non garanties sont explicitement
refusés par cette première version ; les livrer par contrat si le graphe standard
en a besoin, sans contourner les refus dans un pilote.

L'hôte authentifie l'historique et fournit son lecteur fixe de journal MAC avant
de sélectionner les valeurs. Il conserve leurs références/hashes, normalise par
le contrat applicatif existant et résout de nouveau au stage. Un appel de step
ne peut remplacer ces entrées. Admissions, grants explicites et authentification
des résultats restent indépendants des données. Les reconstructions natives,
préfixes de contrôle et simulateur conservent les paramètres.

Fichiers : contrats de modèle/instance v2 et d'aperçu, nouveaux contrats de
données/résolution, `process-data-contracts.mjs`, `process-input-resolution.mjs`,
`standard-process-inputs.mjs`, réducteur/service/simulation, hôtes standard,
reconstruction d'allocation/contrôle natifs, normalisation des contrats standard,
pins/catalogues et corpus de qualification. Les paramètres/références restent
subsumés sous l'instance et le journal existants, sans nouvelle table partagée.

Acceptation ciblée : vrais ports bootstrap et R05, identités entièrement résolues
par l'IR sans entrée manuelle du pilote, refus d'un remplacement, attente humaine
issue de valeurs de journal, ressources natives fermées, résultat conservé et
rejeu/simulation identiques sur trois modes. Les contrôles purs couvrent aussi
les portées de boucle/collection/appel et données altérées. Un contrôle de
livraison durable traverse un nouveau processus Node et une source devenue
indisponible.

Validation finale ciblée **PASS** : les trois sélections
`--dataflow-mode=files|dual|db-only` emploient un pilote générique qui suit le
curseur, sans ordre métier ni identités de résultats fournis par le pilote.
Elles passent par les vrais ports bootstrap/R05, conservent l'attente humaine
issue du journal authentifié, ferment les ressources natives substituées et
retrouvent le même hash au rejeu et en simulation avec les paramètres initiaux.
Les 48 contrôles du réducteur incluent dix nouveaux contrôles de données ; les
27 contrôles des opérations préservent notamment les hashes v1 historiques,
les 20 du catalogue passent. Les 12 contrôles de contrôle durable incluent la
livraison dans un nouveau processus Node avec paramètres, puis l'acquittement
conservé malgré une source indisponible. Les schémas affectés sont validés.

Les essais ont aussi conduit à vérifier le hash de l'entrée de journal et sa
forme avant sélection, à refuser les accesseurs sans les appeler, à comparer
exactement les clés déclarées et à stabiliser l'ordre des champs résolus. Une
collision de clés contenant une virgule et des ordres JSON équivalents sont
couverts. Deux erreurs de préparation des contrôles ont été corrigées : lecture
d'un champ inexistant du curseur et invocation du validateur dans le mauvais
espace de contrats. Aucune règle d'admission ou d'autorisation n'a été abaissée.

Les 20 contrôles de l'hôte et quatre du profil natif v2 ont passé sur le candidat
avant les derniers durcissements du lecteur de données ; ils ne constituent pas
une nouvelle exécution finale de ces suites. Leurs parcours historiques
n'emploient pas les nouveaux raccords. Source de vérité (35), métadonnées (37),
complétude (38), catalogue des gates, Markdown, références et sensibilité passent
sur l'état final ; gouvernance CLI et topologie package ont passé sur le
candidat avant ces derniers durcissements. Le routage final
du diff est ASSURED sans anomalie ; les pins finaux startup 23/cycle 21 sont
vérifiés sans écriture ni réparation. La suite agentique complète non filtrée
et l'ensemble des gates de PR restent **NON_REJOUÉS** dans cette tranche.

Ces preuves sont **hors ligne sur sources**, avec transport natif substitué et
zéro appel au modèle. Modèle natif réel, confinement/Job Windows, fournisseurs
réels, parcours standard complet et archive installée exacte : **NOT_RUN**.
La topologie package ne qualifie pas l'exécution d'une archive installée.

Cette infrastructure ne livre pas le graphe standard complet : restent le modèle
`aidn-standard.v1.json`, ses mappings distribués vers tous les vrais ports,
paramètres/attentes aux entrées CLI/console ordinaires, récupération humaine et
ports L2 restants, puis A1–A10 et qualifications L6–L8. Les nouveaux modèles des
tests sont des IR de qualification ; ils ne deviennent pas le modèle standard
par leur seul succès. Preuves hors ligne sur sources, natives réelles et sur
archive installée exacte restent distinctes.

## Addendum — entrées des composants publiés dans l'IR

Dépendance : infrastructure de données `28bb901`, ports L2 de démarrage/mode et
de squelette de cycle. Les nouvelles révisions startup 24/cycle 22 déclarent leurs
entrées dans l'IR distribuée. Le démarrage reçoit un paramètre `session`, puis
résout l'identité du choix humain accepté et les références session depuis le
journal de l'initialisation. Le squelette reçoit un paramètre `cycle` portant la
session et la demande de cycle ; son initialisation conserve l'identité de
session du premier rafraîchissement accepté et consomme la règle de continuité
et la branche de base du résultat d'admission authentifié. Un autre contexte
actif doit refuser au lieu de réaffecter silencieusement la demande de cycle.
Audit et rafraîchissement final consomment l'entrée de l'initialisation acceptée.

La continuité est de nouveau vérifiée par le véritable port juste avant l'effet.
Un reçu d'admission antérieur ne devient ni autorisation ni exemption de fraîcheur.
Le pilote ne transmet plus d'entrées aux opérations de ces composants. Les
paramètres restent immuables ; les remplacements par le pilote sont refusés.
Le chargeur fixe, les admissions, les grants, le journal signé et le réducteur
restent les mêmes. Aucune entrée CLI/console ordinaire n'est ajoutée ici ; aucune
instance antérieure n'est convertie ni son modèle incorporé remplacé.

Fichiers : les deux IR sous `package/catalogs/process-models/`, leurs catalogues
de provenance, `verify-standard-workflow-model-fixtures.mjs`, les suites de mode
et de cycle, ADR-0025, guide de processus et guide de tests. Aucun nouveau concept,
store, table ou contrat de sortie public. Le contrat de paramètres reste celui
de l'instance v2 optionnelle, les valeurs résolues celui de l'aperçu signé.

Acceptation : les suites doivent utiliser ces assets publiés, des paramètres
initialisés une fois et le curseur commun, sans entrée métier fournie aux
opérations. Démarrage : attente humaine, report/reprise avec nouveau choix,
application de la bonne identité, hook réel et refus de sa postcondition conservé.
Cycle : admission bloquée, résolution externe explicite, création/audit réels,
état OPEN/NOT_READY et refus d'écriture produit, effet partiel non rejoué. Les
réouvertures en nouveau processus, résultats conservés et simulations avec les
paramètres initiaux doivent retrouver le même état.

Validation ciblée finale **PASS** : 22 contrôles du catalogue, puis les 45
contrôles de la suite de mode non filtrée. Elle utilise l'IR distribuée sur
files/dual/db-only et un projet db-only neuf. Ce dernier reporte le choix dans
le modèle publié, conserve l'attente sans activer l'application du mode, accepte
un nouveau choix dans une autre intention puis utilise sa bonne identité.
Les sources sont authentifiées par une capacité de fixture ; chaque acceptation
est relue dans un nouveau processus Node. Le corpus db-only historique conserve
la postcondition de hook refusée et l'incertitude malgré sa sortie zéro.

Les cinq sélections finales `--case=files|dual|db-only|exploring|partial` de la
suite de cycle passent : neuf contrôles pour chacun des quatre parcours normaux,
six pour l'effet partiel, avec le contrôle du catalogue répété dans chaque
sélection. Elles couvrent la matrice gardée par le script non filtré. Les ports
réels vérifient les entrées résolues, le refus d'une autre identité de session,
l'admission bloquée puis reprise après checkpoint externe explicite, la vraie
branche, l'état OPEN/NOT_READY, le refus de patch produit, les reçus conservés
et la simulation exacte avec paramètres. L'effet partiel garde son propriétaire,
ne produit aucun fait de réussite et ne peut être redispatché.

La première matrice de cycle passait déjà avant le dernier ajustement de
l'ancrage de session ; les cinq sélections ci-dessus ont été rejouées après cet
ajustement. La règle/base proviennent de l'admission fraîche, mais la demande
ne change plus implicitement de session. Un ancien contrôle de catalogue qui
inversait toute la séquence a été séparé : cette inversion viole désormais
d'abord les dépendances de données ; une permutation structurellement valide
prouve toujours le refus du hash de catalogue conservé. Aucune admission n'a
été abaissée pour obtenir ces résultats.

Source de vérité (35), métadonnées (37), complétude (38), Markdown, références,
sensibilité et topologie package (cinq clients jetables) : **PASS**. Routage du
diff : ASSURED sans anomalie. Les contrôles de pins sont **PASS** sans écriture
ni réparation, startup 24/cycle 22. Les suites agentique complète et gates de PR
non concernés restent **NON_REJOUÉS**.

Ces preuves sont **hors ligne sur sources**, avec grants et canal humain de
fixture, et sans modèle natif. Canal humain natif réel, fournisseur externe,
confinement/Job Windows, parcours standard complet et workflow sur archive
installée exacte : **NOT_RUN**. La topologie vérifiée ne prouve pas l'exécution
du workflow depuis une archive installée.

Les modèles restent des **composants**. L3/L5 conservent `aidn-standard.v1.json`,
ses appels/raccords à tous les ports, le choix/reprise de session et de cycle, et
les entrées ordinaires. L2 conserve récupération R05, DoR/travail/validation,
transitions/clôtures/promotion/PR/synchronisation ; L4 les inconnus et expirations ;
L6–L8 les parcours A1–A10, preuves natives réelles et archive installée exacte.

## Addendum — revue R05 et conservation causale des constats

Tranche L2/L4 en cours, dépendante du diagnostic/évaluation authentifiés et des
raccords de données `28bb901`/`843ec2f`. Deux activités sont ajoutées au registre
fixe : `drift_recovery_decision` consomme une évaluation complète avec dérive
confirmée ; `drift_recovery_record` consomme son choix humain accepté. Le premier
lie contexte/évaluation, options applicables et écritures proposées. Refus,
report et annulation gardent leurs issues propres. Les nouvelles captures sont
explicitement en inbox v2 ; les captures de mode restent v1, sans conversion.

Le second conserve les constats et options dans le parking lot canonique et
actualise uniquement le résumé de prochaine action/date dans CURRENT-STATE,
sous aperçu exact, grant vivant, propriétaire local et CAS/projection existants.
Il conserve une transition causale avant/après, vérifie les post-images et la
stabilité des autres documents/Git, ainsi que l'index des deux chemins concernés.
Aucun paramètre ne choisit de chemin exclu. Parking-lot entre aussi dans les
observations diagnostiques suivantes. Toute nouvelle évaluation remet le fait
R05-completed à false sans supprimer les anciens événements ou reçus de hook.

Fichiers concernés : nouveaux contrats de plan/question/source/sortie/entrée et
inbox v2, `process-decision-inbox.mjs`, hôte humain, registre/contrats d'opération,
`standard-drift-recovery.mjs`, contexte/autorité mixte, pins/catalogues, politiques
de provenance, ADR-0025 et guides. `verify-drift-recovery-fixtures.mjs` entre dans
le gate agentique existant ; les sélections `--drift-recovery-mode=files|dual|db-only`
du corpus de production utilisent une IR qui résout les identités sans pilote.

Les premiers essais intégrés ont révélé la copie inutile des documents de
contexte dans le plan signé : SPEC dépasse la limite existante par chaîne.
Le plan conserve désormais leurs empreintes et les deltas proposés ; le texte
est découpé en fragments bornés, sans relever les limites du JSON. Les 11
contrôles dédiés passent hors ligne : source/inbox doublées, frontière Git réelle,
long texte, ports canoniques réels, autorisation refusée, contexte périmé et
écriture SQLite partielle avec incertitude/propriétaire conservés. Le réducteur
(48), contrats d'opérations (27), catalogue (22) et contrat de diagnostic ciblé
passent sur les candidats indiqués par les journaux de cette tranche.

Les essais intégrés suivants ont atteint la revue authentifiée dans les trois
modes, puis exposé une lacune de reprise du dispatcher mixte : il ne sélectionnait
pas les opérations WAITING avec reçu blocked/deferred pour préparer une nouvelle
intention explicite. Cette sélection est ajoutée, sans retry d'effet inconnu.
Un contrôle réel de métadonnées a aussi démontré que le CAS de contenu historique
réinitialisait famille/subtype/annotations du parking lot. Le nouveau port conserve
les métadonnées du store canonique, lie leur préimage dans le CAS verrouillé et
vérifie/retient leur empreinte après écriture. Douze contrôles dédiés passent,
dont conservation et refus après changement de seules métadonnées.

Validation ciblée finale **PASS** : 15 contrôles dédiés sans SKIP, et les trois
sélections `--drift-recovery-mode=files|dual|db-only` sur les derniers raccords.
Les contrôles dédiés couvrent aussi les six choix/contre-choix typés, la perte
silencieuse d'une projection dual et une jonction Windows refusée avant
évaluation/écriture. Les parcours intégrés utilisent la vraie autorité mixte,
son diagnostic natif protégé sur transport substitué et les vrais ports
canoniques. Ils attendent, refusent sources/choix invalides, reportent puis
acceptent un nouveau choix. L'IR résout les identités sans intervention du pilote.
Après disparition de la source humaine, files conserve les constats dans un
nouveau processus Node sans allocation native ; dual/db-only rouvrent les hôtes.
Les reçus empêchent une nouvelle exécution et le même modèle/réducteur retrouve
le même hash en replay/simulation. L'instance reste en attente de l'action réelle,
avec récupération requise et R05 incomplet. Ces preuves finales remplacent les
premiers essais interrompus pour ces raccordements.

Réducteur (48), contrats d'opérations (27), catalogue (22), six schémas nouveaux,
contrat de diagnostic ciblé, source de vérité (35), métadonnées (37), complétude
(38), références, Markdown, sensibilité et topologie package : **PASS** dans
cette tranche. Mode v1/démarrage neuf (12) et finalisation propre avec vrai hook
passent sur les candidats avant les derniers gardes de projection R05 ; leurs
chemins n'emploient pas ces gardes. Le gate conserve son placement et ses anciens
contrôles ; son nouveau contrôle dédié est ajouté aussi à la commande immuable
de la politique de validation. Le catalogue des gates passe. Un sélecteur de mode
invalide refuse avant de créer une fixture. Routage du diff final : ASSURED sans
anomalie. Pins finaux startup 30/cycle 28 vérifiés sans écriture ni réparation.

La suite agentique complète non filtrée et l'ensemble des gates de PR restent
**NON_REJOUÉS**. Preuves natives réelles, canal humain/fournisseur réel,
confinement/Job Windows, parcours standard complet et archive installée exacte :
**NOT_RUN**. Les preuves ci-dessus sont hors ligne sur sources, avec transport
natif et capacité humaine de fixture, et ne valent pas qualification de l'archive.

Cette tranche ne livre pas l'exécution de la récupération choisie. Restent
explicitement les véritables ports CR/requirements delta, choix/création de cycle,
rollback autorisé, leurs propres chaînes causales, puis nouvelle analyse native,
réévaluation et hook. Le modèle de qualification reste en attente de cette
action ; il n'est pas le modèle standard complet. L3/L5 (graphe et entrées
ordinaires), inconnus/expirations L4, parcours A1–A10 et preuves natives/archive
installée L6–L8 restent ouverts. Aucun succès de revue ou de documentation ne
vaut réalisation de ces livrables.

Dans les lots restants, étendre la qualification de métadonnées/projections aux
autres mutations L2 : le CAS historique général n'est pas corrigé globalement
par ce port R05. Les attentes devenues périmées demandent aussi une voie explicite
d'annulation/invalidation et de reprise, sans inventer une décision humaine ni
réessayer un effet inconnu. Ces points accompagnent le raccordement L4/L5 complet.
