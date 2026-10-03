# Inventaire des diagnostics — paire avec erreur de préparation

Cette paire fermée est classée **INVALID_PREPARATION** pour une comparaison du fonctionnement ordinaire d’AIDN. Le client A est sur `main`, alors que sa configuration observée indique `workflow.sourceBranch: dev`. Les trois appels `start-session` refusent avec `START_SESSION_BRANCH_NOT_AIDN`. Cet inventaire décrit les diagnostics observés; il ne mesure pas l’effet normal d’AIDN, ni une amélioration de qualité, de tokens, de cache, de GFD ou de latence.

Les trois tours natifs de chaque bras sont `completed`, sans erreur native de tour. Ce statut décrit la fin de l’exécution native, pas la livraison d’une application. La raison de refus AIDN reste présente lorsque l’enveloppe native se termine normalement.

## Périmètre et unités de compte

Les deux traces JSONL complètes ont été lues après fermeture des clients et runners. Leurs empreintes sont conservées et inchangées. Les valeurs JSON `null`, les chaînes vides, les tableaux vides, les objets vides et les chemins absents sont comptés séparément. Une absence est calculée parmi les documents de la même famille; elle ne prouve aucune obligation de remplir ce champ. Les chaînes sentinelles comme `none`, `disabled` ou `not_requested`, les nombres `0` et les booléens `false` ne sont pas des valeurs JSON nulles. Les clés de tokens/effort `reasoning*` sont exclues.

Les tableaux comptent des observations. Les champs répétés dans racine/normalized/summary et les contenus identiques ne deviennent pas de nouvelles décisions. Un identifiant de hook peut être réutilisé dans une autre thread : les 35 exécutions A sont distinctes sur le tuple thread/tour/hook, même si les chaînes d’identifiant n’ont que 34 valeurs distinctes.

| Observation | AIDN | Baseline |
| --- | ---: | ---: |
| Commandes terminées / IDs de commande distincts | 32 / 32 | 49 / 49 |
| Hooks natifs commencés / terminés | 35 / 35 | 0 / 0 |
| SessionStart avec résumé JSON AIDN | 2 | 0 |
| PreToolUse terminé sans entrée | 33 | 0 |
| Revues automatiques commencées / terminées | 10 / 10 | 18 / 18 |
| Revues finales approuvées, avec rationale non vide | 10 | 18 |
| JSON terminaux de réponse AIDN | 15 | 0 |
| JSON AIDN dans les entrées de hooks | 2 | 0 |
| Lectures JSON de configuration AIDN, preuve secondaire | 2 | 0 |
| JSON de diagnostic Git, producteur expérimental distinct | 1 | 0 |
| Candidats JSON relus et classés | 15 | 70 |
| Erreurs de lecture des traces JSONL | 0 | 0 |

## Qualification des motifs et des producteurs

Les 15 réponses terminales AIDN et les deux résumés de hooks ne contiennent **aucun champ de motif reconnu avec une valeur JSON null**. Cette constatation est limitée aux sorties de cette paire : elle ne prouve pas que toutes les branches du produit ont été exercées. Les motifs effectifs des refus ne sont pas vides.

| Cas observé | Qualification |
| --- | --- |
| Trois refus start-session, lignes A 270, 485, 992 | `ok:false`, `result:stop`, exit 1; `reason_code` vaut `START_SESSION_BRANCH_NOT_AIDN` en racine, normalized et summary. Les blocking_reasons restent présents en racine et normalized. |
| `reason_codes:[]`, trois occurrences en racine et trois dans normalized | Tableau vide, pas null. La normalisation traite séparément les codes de niveaux et le code primaire d’admission. Le code primaire du refus est conservé. |
| `summary.reason_codes`, `summary.blocking_reasons` | Absents dans les trois résumés, pas null. Le producteur de summary expose un sous-ensemble; la réponse complète compacte conserve les blocking_reasons ailleurs. |
| `error:null`, `normalized.error:null`, `db_sync.error:null` | Trois occurrences de chaque chemin. Refus structuré sans exception de lancement; synchronisation désactivée avec `db_sync.reason:disabled`, daemon non demandé avec `daemon.reason:not_requested`. |
| `repair_layer_status:clean` pendant le refus | Le wrapper expose également count 0 et blocking false. Santé des réparations et permission de démarrer la session sont deux axes distincts; clean ne transforme pas le refus en admission. Les raw payloads et les lignes DB ne sont pas requalifiés par cet inventaire. |
| Sept pre-write admissions | Deux refus d’activation, cinq admissions génériques. Les cinq blocking_reasons vides sont des succès génériques, pas des autorisations universelles d’écriture. |
| Deux résumés SessionStart identiques | Admission générique d’orientation, blocking_reasons vide et `write_authorization:false`; aucun refus natif couvert observé dans ces deux résumés. |
| `rationale:null` au début des revues | Dix A et dix-huit B. Toutes les revues finales sont approuvées et leur rationale est non vide. Aucun motif final nul observé. |
| `statusMessage:null` dans hooks started/completed | 35 dans chaque phase native A. Champ du protocole natif; les deux contenus AIDN sont dans les entrées. Les 33 autres hooks n’ont aucune entrée JSON à qualifier comme décision AIDN. |
| MCP `failureReason:null` et `error:null` | Quatre de chaque chemin par bras, sur deux états starting puis deux ready; aucun état failed observé. |
| Erreurs natives de tour nulles | Trois started et trois completed par bras, avec trois réponses RPC de lancement contenant également error:null. Les trois autres réponses RPC n’ont pas ce chemin. |
| `result:null` dans workflow-action help | Placeholder d’une réponse d’aide, pas un motif d’échec perdu. |

Les douze réponses publiques observées passent le validateur JSON Schema : sept pre-write-admit, deux bootstrap-diagnostics, deux workflow-inspect help et un workflow-action help. Le registre marque run-json-hook comme commande interne; sa projection est qualifiée à partir de ses producteurs, sans inventer un schéma public absent. Huit fichiers producteurs/contrats ont des octets identiques entre source et package installé, source `6a79e0dd983bb8d16769017d2ac9cbb011de2b05`.

Références productrices : `src/application/runtime/start-session-admit-use-case.mjs:151` (refus de branche et code), `src/core/workflow/workflow-output-factory.mjs:154` (summary), `src/application/codex/normalize-hook-payload.mjs:187` (codes de niveaux et code primaire), `src/application/codex/run-json-hook-use-case.mjs:342` (sync disabled, error nullable), `src/core/cli/command-registry.mjs:208` (commande interne), `scaffold/codex_hooks/scripts/aidn-hook-runtime.mjs:253` (résumé natif, sans permission d’écriture). Les champs natifs de Codex ne relèvent pas des schémas publics JSON AIDN.

## Activation Git et changement de contexte de sandbox

Les lignes A 59 et 700 rendent une admission générique bloquée avec `AIDN_PROJECT_DEGRADED` et `ACTIVATION_GIT_RESOLUTION_FAILED`, tout en conservant l’exit générique 0. Les diagnostics bootstrap A 71 et 713 rendent la même erreur avec exit 1. Le diagnostic séparé A 83 observe `spawnSync git EPERM`; il expose aussi status 0. Le code de statut seul ne suffit donc pas à constater la réussite de ce sous-processus. Le producteur d’activation refuse lorsqu’il observe error, signal ou statut non nul (`project-activation-service.mjs:105`).

Les retries de consultation en dehors du sandbox natif sont approuvés par le contrôle automatique natif. Les réponses A 145/160, 469 et 779/794 retrouvent une activation active et une admission générique. L’approbation native du retry ne supprime pas la règle AIDN : les appels start-session ultérieurs refusent encore explicitement la topologie de branche. Les cinq admissions génériques sont des consultations observées dans un autre contexte d’exécution. Les wrappers run-json-hook ont leur propre enregistrement de diagnostic local; ils ne sont pas reclassés comme commandes read-only par cet inventaire. Aucune correction de produit ni requalification d’autorisation n’est déduite de ce diagnostic.

## Inventaire exhaustif des chemins observés

### AIDN

#### Protocole natif/provider

**response** — 6 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.result.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 3 |

**warning** — 2 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**mcpServer/startupStatus/updated** — 4 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.failureReason` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `$.params.error` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |

**turn/started** — 3 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

**hook/started** — 35 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.run.statusMessage` | 35 | 35 | 0 | 0 | 0 | 0 | 0 |

**hook/completed** — 35 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.run.statusMessage` | 35 | 35 | 0 | 0 | 0 | 0 | 0 |

**item/autoApprovalReview/started** — 10 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 10 | 10 | 0 | 0 | 0 | 0 | 0 |

**guardianWarning** — 10 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 10 | 0 | 0 | 0 | 0 | 10 | 0 |

**item/autoApprovalReview/completed** — 10 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 10 | 0 | 0 | 0 | 0 | 10 | 0 |

**turn/completed** — 3 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

#### JSON terminal AIDN

**pre-write-admit/full** — 7 documents; 4 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.activation.errors` | 7 | 0 | 0 | 5 | 0 | 2 | 0 |
| `$.blocking_reasons` | 7 | 0 | 0 | 5 | 0 | 2 | 0 |
| `$.warnings` | 7 | 0 | 0 | 5 | 0 | 2 | 0 |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.shared_state_backend.runtime_backend.connection.message` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.shared_runtime_validation.warnings` | 5 | 0 | 0 | 5 | 0 | 0 | 2 |
| `$.context.usage_matrix_rationale` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.context.source_of_truth_reason_codes` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.checks.source_of_truth_policy_resolved.reason_code` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.checks.source_of_truth_state_mode_alignment.reason_code` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |
| `$.checks.source_of_truth_db_only_source_alignment.reason_code` | 5 | 0 | 0 | 0 | 0 | 5 | 2 |

**bootstrap-diagnostics.v1** — 2 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.assets.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.assets.warnings` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.activation.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.capabilities.warnings` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.warnings` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**runtime-workflow-inspect.v1 [help]** — 2 documents; 1 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.errors` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.warnings` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |

**run-json-hook/start-session/compact** — 3 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.reason_codes` | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| `$.reason_code` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.blocking_reasons` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.repair_layer_advice` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.repair_primary_reason` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.reason` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.db_sync.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| `$.normalized.reason_code` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.normalized.blocking_reasons` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.normalized.repair_layer_advice` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.normalized.repair_primary_reason` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.normalized.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.reason_code` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.summary.repair_layer_advice` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.summary.repair_primary_reason` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| `$.daemon.reason` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |

**runtime-workflow-action.v1 [help]** — 1 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.errors` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |

#### JSON des entrées de hooks AIDN

**native-hook/admission-summary** — 2 documents; 1 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.blocking_reasons` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.omissions.blocking_reasons` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

### baseline

#### Protocole natif/provider

**response** — 6 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.result.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 3 |

**warning** — 2 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**mcpServer/startupStatus/updated** — 4 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.failureReason` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `$.params.error` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |

**turn/started** — 3 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

**item/autoApprovalReview/started** — 18 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 18 | 18 | 0 | 0 | 0 | 0 | 0 |

**guardianWarning** — 18 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 18 | 0 | 0 | 0 | 0 | 18 | 0 |

**item/autoApprovalReview/completed** — 18 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 18 | 0 | 0 | 0 | 0 | 18 | 0 |

**turn/completed** — 3 documents; 0 répétitions exactes de contenu.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

#### JSON terminal AIDN

#### JSON des entrées de hooks AIDN

## Candidats JSON, lectures et métadonnées secondaires

Les 85 candidats initialement non reconnus ont tous été revus. A comprend un diagnostic Git et deux configurations AIDN, gardés séparément des réponses d’admission; onze fragments proviennent de lectures de brief/manifeste ou d’exemples; un fragment appartient à la commande de démarrage du produit. B comprend 69 fragments de produit/brief/manifeste/source et une copie de métadonnées de contrôle dans des arguments de processus. Les deux objets `{error:...}` repérés dans B sont des exemples/source relus, pas des erreurs AIDN ni des réponses finales natives. Aucun candidat non résolu ne reste.

Les deux configurations AIDN n’ont aucun chemin de motif reconnu. Le diagnostic Git possède un error non vide, aucun motif nul. Ces trois observations ne sont pas ajoutées au nombre de décisions AIDN. Les chaînes textuelles contenant null/None/undefined restent une preuve de texte, jamais une preuve suffisante de présence d’un champ JSON nul.

Les fichiers JSON et JSONL de métadonnées de chaque bras ont aussi été examinés séparément. `measurement-availability.json` contient cinq motifs non vides par bras pour les métriques indisponibles; les entrées disponibles n’ont pas besoin de ce motif. `phase1-upgrade-record.json` contient un motif non vide dans A. Aucun autre chemin de diagnostic reconnu n’est observé dans ces métadonnées. Les clocks sont des index des mêmes événements, pas des événements supplémentaires.

Les logs natifs stderr ne contiennent aucun fragment JSON complet reconnu par le parseur strict; leur texte n’est pas converti en nouveaux champs nuls. Le log auxiliaire de seed A contient un fragment non reconnu sans diagnostic. L’agrégat local conserve la couverture et les empreintes de chaque fichier examiné.

## Limites et conservation

Les absences des tableaux utilisent le document comme dénominateur; les occurrences au sein d’un tableau peuvent être supérieures au nombre de documents. Les JSON identiques produits à plusieurs moments restent des observations distinctes, sans estimer des décisions indépendantes. La lecture de fragments et la classification ont été qualifiées par leurs contextes; les textes et sources du produit ne deviennent pas des réponses AIDN.

Cette paire exerce des refus de préparation, une panne de sandbox et des aides CLI. Elle ne requalifie pas toutes les branches de workflow, l’état réel des réparations en DB ou une livraison produit. Les raw payloads référencés hors du dossier d’évidence ne sont pas lus. Aucune trace future active n’est lue, aucun projet, source, package, input, harness ou contrôle n’est modifié par cet audit. Le Markdown ne contient ni commandes brutes, ni corps de réponses, ni secrets, ni chemins absolus des projets. Les agrégats machine et empreintes restent locaux.
