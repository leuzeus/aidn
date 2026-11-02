# Raccordement du workflow standard AIDN à l’IR de processus

Date : 2026-11-01. État : **PLAN ENREGISTRÉ — INTÉGRATION STANDARD À RÉALISER**.
Référence inspectée : commit `dd1dbaba9ae7123c157dd35f8a6f42f34f32d3fa`.
Catégorie : architecture et intégration runtime ; voie prévue pour la réalisation :
**ASSURED**, compte tenu des effets, contrats, autorités et persistances concernés.
La version initiale du plan (`6886132`) enregistrait le diagnostic et le travail
restant. L’avancement ci-dessous ne vaut pas livraison du modèle standard ni
qualification de son parcours complet.

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
- L2/L4 : en cours. Ports réels de bootstrap, journal de dispatch signé et
  raccordement du choix de mode/hook décrits dans les addenda ci-dessous.
- L3 et L5 à L8 : à réaliser. Le modèle standard, le dispatcher mixte, la reprise
  générale du lanceur et les preuves natives/package installé restent ouverts.
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
