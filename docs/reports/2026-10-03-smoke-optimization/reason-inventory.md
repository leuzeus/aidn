# Inventaire des diagnostics — campagne aidn-smoke-optimization-corrected

Cet inventaire décrit les deux traces finales de la campagne `aidn-smoke-optimization-corrected`, A = AIDN et B = baseline. Les citations A:L et B:L désignent les lignes des fichiers native-events.jsonl respectifs. Il distingue les motifs AIDN, le protocole natif Codex, les contrôles automatiques et les observations de fichiers. Il ne produit pas de score produit, de comparaison de qualité, de conclusion causale sur GFD, ni d’estimation de tokens ou de latence. Les trois tours natifs de chaque bras sont terminés sans erreur native ; cette terminaison ne constitue pas une preuve de livraison produit.

## Périmètre et unités

Les clients et runners étaient fermés avant lecture, la qualification finale racine est PASS et les inputs scellés sont inchangés. La source et le package installé sont liés au commit `6a79e0dd983bb8d16769017d2ac9cbb011de2b05`. Les deux modèles demandés sont GPT 6.1, effort medium. Cet audit ne lance aucun acteur de développement, aucune commande de projet, aucun appel AIDN ou DB, et ne modifie ni source, package, projet, inputs, harness ni contrôles.

Le scan parcourt toutes les clés imbriquées correspondant à reason/raison/explanation/rationale/justification/cause, sans tenir compte de la casse, ainsi que les companions error(s), failure(s), message(s), errorMessage, statusMessage, warnings, issues, details et repair_layer_advice. Les champs de tokens et d’effort `reasoning*` sont exclus. Les valeurs JSON nulles, chaînes vides, tableaux vides, objets vides et chemins absents sont distincts. `none`, `disabled`, `not_requested`, `false` et `0` ne sont pas des valeurs JSON nulles.

Les tableaux comptent des observations, pas des décisions indépendantes. Racine, normalized, summary, niveaux de contrôle et contexte de hook peuvent répéter un même diagnostic. Le dénominateur d’une absence est la famille de documents observée ; une absence ne prouve aucune obligation de remplir ce champ. Pour les sorties tronquées, il décrit seulement les sous-objets récupérés, jamais le parent incomplet.

| Observation | AIDN | Baseline |
| --- | ---: | ---: |
| Événements de trace JSONL | 4 406 | 1 566 |
| Commandes terminées / IDs distincts | 111 / 111 | 45 / 45 |
| Exit des groupes de commandes : 0 / 1 / 2 | 99 / 9 / 3 | 39 / 6 / 0 |
| Hooks natifs commencés / terminés | 121 / 121 | 0 / 0 |
| Tuples thread/tour/hook distincts / chaînes hook ID distinctes | 121 / 120 | 0 / 0 |
| SessionStart / PreToolUse avec JSON AIDN | 2 / 8 | 0 / 0 |
| Hooks terminés sans entrée | 111 | 0 |
| Revues automatiques commencées / terminées | 62 / 62 | 15 / 15 |
| Revues finales approuvées avec rationale non vide | 62 | 15 |
| JSON terminaux AIDN complets, y compris lectures de raw persistés | 22 | 0 |
| Projections/lectures d’observateur AIDN supplémentaires | 3 | 0 |
| Sous-objets AIDN récupérés dans deux sorties tronquées | 8 | 0 |
| JSON de contexte de hook | 10 | 0 |
| Candidats JSON initialement inconnus, tous classifiés | 140 | 61 |
| Erreurs de lecture JSONL / candidats non résolus | 0 / 0 | 0 / 0 |

## Motifs nuls et vides : qualification complète

Les réponses AIDN complètes et leurs projections observées contiennent **22 occurrences de motifs JSON nulls**, réparties entre huit usages de champs. Elles ne représentent pas 22 décisions. Une chaîne de motif vide supplémentaire apparaît dans un aperçu sans écriture. Aucun motif de refus identifié dans les sorties JSON complètes n’est perdu : les avertissements de dérive portent `L2_SIGNAL_TRIGGERED`, les refus d’activation et de handoff conservent leurs raisons. Cette conclusion couvre les branches exercées dans ces traces.

| Chemin / contexte | Occurrences | Qualification |
| --- | ---: | --- |
| reason_code racine, normalized et summary : start-session A:L366/A:L3570, cycle-create A:L491, branch-cycle-audit A:L3586 | 12 | Quatre succès result:ok, command_status:0, sans motif primaire de refus. Les reason_codes L1/cache restent présents séparément ; leur absence dans summary est une projection contractuelle. |
| artifact.classification_reason : A:L479, deux documents A:L3693 | 3 | Le classificateur initialise ce champ à null pour ces kinds connus. La persistance peut réussir avec des constats Markdown non conformes ; ceux-ci sont présents dans contract_findings et metadata_findings. |
| artifact.canonical.derived_runtime_context.repair_primary_reason : CURRENT-STATE A:L3693 | 1 | Le texte canonique possède repair_layer_status:clean mais ne possède pas de clé repair_primary_reason. Le parseur retourne null pour une donnée absente ; il ne fabrique pas de justification. |
| payload.levels.level3.reason : drift-check A:L865 ; payload.checkpoint.gate.levels.level3.reason : handoff-close A:L2900 | 2 | level3.required:false, pas de signal bloquant L3, pas de réparation bloquante et compte récent de fallback 0. Le motif primaire du warning L2 reste non nul. |
| payload.checkpoint.gate.skip_reason : A:L2900 | 1 | gate.skipped:false : contrôle exécuté, aucune raison de saut applicable. |
| payload.checkpoint.index_sync_check.skip_reason : A:L2900 | 1 | enabled:false, skipped:false ; état par défaut d’un contrôle optionnel non demandé. L’index distinct est bien skipped:true avec postgres_canonical_backend non vide. |
| db_sync.reason : cycle-create A:L491 | 1 | Wrapper de sync enabled:true, skipped:false, error:null. Le payload effectif est skipped:true et conserve reason:postgres_canonical_backend. L’enveloppe de lancement n’est pas le résultat du travail de synchronisation. |
| db_sync.payload.fallback_full_reason : A:L491 | 1 | fallback_full_used:false : aucune raison de fallback complet applicable. |
| canonical_write.reason chaîne vide : state-reanchor preview A:L2064 | 1 vide | attempted:false et written:false. Le plan est needs_review avec plan.reason non vide ; aucun write refusé dont la raison aurait été perdue. |

Les companions `error:null`, `normalized.error:null` et `db_sync.error:null` distinguent une absence d’exception de transport d’un résultat domaine. Le warning de drift-check, dont ok:false et result:warn, garde par exemple error:null dans sa lecture normalisée. Les tableaux vides de blocking_reasons et warnings sont comptés comme vides, pas comme nulls. Aucun objet vide de motif/companion n’est observé dans les réponses AIDN qualifiées.

Références productrices : [src/application/codex/normalize-hook-payload.mjs:187](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/codex/normalize-hook-payload.mjs#L187) (codes L1) et `:211` (code primaire) ; [src/core/workflow/workflow-output-factory.mjs:154](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/core/workflow/workflow-output-factory.mjs#L154) (summary), [src/application/codex/run-json-hook-use-case.mjs:233](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/codex/run-json-hook-use-case.mjs#L233) (sync compact), [src/core/gating/gating-signal-policy.mjs:126](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/core/gating/gating-signal-policy.mjs#L126) (L3), [src/application/runtime/checkpoint-use-case.mjs:265](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/runtime/checkpoint-use-case.mjs#L265) (gate skip), [src/adapters/runtime/artifact-projector-adapter.mjs:257](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/adapters/runtime/artifact-projector-adapter.mjs#L257) (classification), [src/lib/workflow/structured-artifact-parser-lib.mjs:393](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/lib/workflow/structured-artifact-parser-lib.mjs#L393) (raison de réparation), [tools/runtime/state-reanchor.mjs:174](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/state-reanchor.mjs#L174) (raison d’écriture initialement vide).

## Diagnostics natifs : succès, démarrage et absences

| Champ natif | AIDN | Baseline | Qualification |
| --- | ---: | ---: | --- |
| Review started rationale:null | 62 | 15 | Décision finale pas encore reçue. |
| Review completed rationale non vide, approved | 62 | 15 | Aucun motif final nul, vide ou absent. |
| Hook started statusMessage:null / completed statusMessage:null | 121 / 121 | 0 / 0 | Champ natif optionnel ; les dix diagnostics AIDN sont dans entries, pas dans statusMessage. |
| Hook error absent, à chaque étape | 121 | 0 | Aucun champ error observé ; tous les hooks terminés sont completed. Une absence ne devient pas error:null. |
| MCP failureReason:null et error:null, chacun | 4 | 4 | Deux starting puis deux ready ; aucun failed observé. |
| Turn started error:null / completed error:null | 3 / 3 | 3 / 3 | Trois completed par bras, sans erreur de tour native. |
| response.result.turn.error:null / absent | 3 / 3 | 3 / 3 | Réponses RPC de lancement et autres réponses ; duplication des mêmes tours, pas six tours. |
| response.error absent | 6 | 6 | Aucun error de réponse RPC observé. |
| guardianWarning.message non vide | 62 | 15 | Répète exactement la rationale finale suivante avec son préfixe ; pas une décision supplémentaire. |
| warning.message non vide | 2 | 2 | Avertissements de protocole, distincts des refus AIDN. |

Exemples de revue start/guardian/completed : A:L152/153/154 et B:L164/165/166. Dix hooks contiennent un résumé JSON : neuf admitted et un admitted_with_warnings (SessionStart A:L3218). Tous conservent blocking_reasons:[] et omissions.blocking_reasons:0 ; ce zéro signifie aucun motif bloquant omis. Les résumés omettent 45 autres champs de contexte : ils ne prétendent pas contenir toutes les warnings. SessionStart affiche write_authorization:false et constitue une orientation, pas une permission universelle d’écrire.

## Familles terminales et axes de résultat

| Famille | Documents | Contexte observé |
| --- | ---: | --- |
| pre-write-admit/full | 6 | 2 activation blocked, 2 admitted, 2 admitted_with_warnings ; generic, tous groupes shell exit0. |
| bootstrap-diagnostics.v1 | 2 | ok:false, activation Git dégradée, groupes exit1. |
| runtime-workflow-action.v1 help | 2 | Aide ; result et action nuls sont des placeholders, pas des motifs. |
| run-json-hook/start-session/compact | 2 | create_session_allowed puis resume_current_session, result:ok, status interne0. |
| run-json-hook/cycle-create/compact | 1 | proceed_r2_session_base_with_import, result:ok, status interne0. |
| run-json-hook/branch-cycle-audit/compact | 1 | audit_session_branch, result:ok, status interne0 ; le groupe shell finit à1 à cause du handoff suivant. |
| db-first-artifact | 3 | Deux sessions et un current-state persistés ; diagnostics Markdown non conformes conservés. |
| skill-hook/drift-check | 1 | Lecture d’un raw persisté : ok:false, result:warn, L2_SIGNAL_TRIGGERED, objective_delta. |
| skill-hook/handoff-close | 1 | Lecture d’un raw persisté : ok:true, result:warn, L2_SIGNAL_TRIGGERED, time_since_last_drift_check. |
| state-reanchor/preview | 1 | ok:true, needs_review, aucune écriture ; plan.reason non vide. |
| handoff-admit/full | 1 | rejected, issues non vides, route.reason non vide ; sources file. |
| project-handoff-packet/full | 1 | written:true, consistency.pass:true, sources postgres ; défaut de schéma décrit ci-dessous. |
| Projections et lectures AIDN supplémentaires | 3 | Sous-ensemble pre-write A:L642, normalisé drift-check A:L865, rapport de seuil A:L4128. |

Le drift-check et le handoff-close utilisent deux axes d’agrégation différents pour warn. Le checkpoint ramène tout gate.result autre que stop à summary.result:ok ([workflow-output-factory.mjs:107](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/core/workflow/workflow-output-factory.mjs#L107)), puis calcule checkpoint.ok sur ce résumé ([checkpoint-use-case.mjs:294](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/runtime/checkpoint-use-case.mjs#L294)). Handoff-close propage checkpoint.ok tout en conservant gate.result:warn et son reason_code ([handoff-close-hook.mjs:173](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/perf/handoff-close-hook.mjs#L173)). La normalisation garde un ok explicite. Cette différence de lecture est vérifiable ; le motif L2 n’est pas perdu.

Dans les trois artefacts persistés, canonical.contract_status est non_conformant avec respectivement 7, 5 et 4 contract_findings. Les metadata_findings sont 6, 5 et 3 ; les statuts metadata sont incomplete, incomplete et legacy_tolerated. Tous les messages de constat sont non vides. Le succès de persistance ne signifie donc pas conformité du contenu Markdown ; cette différence d’axes ne doit pas être lue comme une réparation clean prouvant toute la gouvernance.

## Contrats publics : 15 PASS, 1 FAIL

Les 16 réponses publiques complètes ont été validées, sans invocation produit, par `validateJsonSchema(value,schema)` exporté par [src/core/contracts/json-schema-validator.mjs](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/core/contracts/json-schema-validator.mjs), sous Node 22. Le registre marque run-json-hook interne ; ces hooks sont qualifiés par leurs producteurs, sans inventer de schéma public.

| Contrat | Documents | Verdict |
| --- | ---: | --- |
| runtime-pre-write-admit.v1 | 6 | PASS |
| bootstrap-diagnostics.v1 | 2 | PASS |
| runtime-workflow-action.v1, aide | 2 | PASS |
| runtime-db-first-artifact.v1 | 3 | PASS |
| runtime-state-reanchor.v1 | 1 | PASS |
| runtime-handoff-admit.v1 | 1 | PASS |
| runtime-project-handoff-packet.v1 | 1 | FAIL : six propriétés requises absentes |

Le document A:L4040, offset0, est un JSON complet imprimé sans tronquage : 13 clés racine, written:true, consistency.pass:true, source:postgres. Son propre schéma public exige les six chemins suivants, absents dans la réponse :

- `$.shared_state_backend.sqlite_file`
- `$.consistency.ts`
- `$.consistency.target_root`
- `$.consistency.audit_root`
- `$.consistency.missing_files`
- `$.consistency.snapshot`

La propriété sqlite_file est requise inconditionnellement même pour PostgreSQL ; son type autorise string ou null, mais pas son absence ([runtime-project-handoff-packet.v1.schema.json:68](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/core/contracts/cli-output/runtime-project-handoff-packet.v1.schema.json#L68)). Les cinq propriétés de consistency sont elles aussi requises sans branche de backend (`:284`). Le projecteur choisit pour PostgreSQL `buildVirtualCurrentStateConsistency` ([project-handoff-packet.mjs:479](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/project-handoff-packet.mjs#L479)) ; ce helper retourne pass/source/current_state/checks ([db-first-runtime-view-lib.mjs:569](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/db-first-runtime-view-lib.mjs#L569)). Le backend canonique ne décrit pas sqlite_file ([runtime-canonical-shared-state-backend.mjs:14](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/adapters/runtime/runtime-canonical-shared-state-backend.mjs#L14)). Il s’agit d’une incompatibilité entre forme productrice et contrat public, distincte d’un motif nul, d’une panne DB ou d’un cache stale. Aucune correction n’a été faite pendant l’audit.

Les 28 fichiers producteurs, helpers, validateur et schémas examinés ont des SHA-256 identiques dans la source et le package installé pin6a79. L’agrégat local conserve la liste complète et les hashes ; le défaut ne provient pas d’une différence de bytes entre ces deux copies.

## Sources canoniques et observations de cache

Les quatre pre-write complets dont l’activation est active rapportent current_state_source et runtime_state_source postgres ; les deux refus d’activation affichent not-read. Les sources session/cycle/plan manquantes dans ces consultations génériques sont conservées comme missing, pas changées en files. Le cycle-create A:L491 rend postgres_canonical_backend pour le sync et la décision de fast-path, avec sqlite_decision_source:not_used. Ces marqueurs prouvent les sources rapportées par ces réponses, pas le nombre de requêtes SQL exécutées.

Handoff-admit A:L3586 rapporte current-state, runtime-state et packet en file, puis rejette trois contrôles de cohérence : session_branch_consistent, committing_requires_cycle et committing_requires_first_plan_step. Le helper partagé préfère un fichier existant quand preferDb:false ([db-first-runtime-view-lib.mjs:244](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/db-first-runtime-view-lib.mjs#L244)) et handoff-admit ne passe pas preferDb ([handoff-admit.mjs:124](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/handoff-admit.mjs#L124)). Project-handoff-packet choisit au contraire preferDb pour postgres ([project-handoff-packet.mjs:423](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/tools/runtime/project-handoff-packet.mjs#L423)). La projection A:L4040 rapporte postgres et pass après plusieurs mises à jour canoniques et écritures intermédiaires, dont A:L3693. La différence de préférence est statique et observable ; ces deux moments ne prouvent ni divergence simultanée, ni cache stale.

Les codes L1/cache non primaires sont présents : MISSING_CACHE au premier start-session ; puis BRANCH_CHANGED, HEAD_CHANGED, ARTIFACTS_CHANGED, ACTIVE_CYCLES_CHANGED et DIGEST_MISS selon les hooks. Ils expliquent des reloads complets/fallbacks ; ils ne remplacent pas le motif primaire de gate et ne sont pas des mesures de hit SQL. Le seul cache_hit explicitement observable est false dans le sous-objet workspace.cache_diagnostic récupéré de A:L2048, cache kind workspace-resolution. Sa portée est ce résolveur, pas tous les caches AIDN ([workspace-resolution-service.mjs:463](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/runtime/workspace-resolution-service.mjs#L463) et `:573`). Les timings SQL/connexion/pool/cache AIDN sont déclarés indisponibles dans les métadonnées. Les tokens d’input caché du provider ne permettent aucune attribution à un cache AIDN.

## Pannes de sandbox et groupes shell

Deux pre-write génériques (A:L54/A:L3269) rendent ok:false, activation:degraded, AIDN_PROJECT_DEGRADED et ACTIVATION_GIT_RESOLUTION_FAILED, tout en conservant le comportement générique exit0. Les deux bootstrap diagnostics A:L70/A:L3280 rendent les erreurs avec exit1. Les trois observations Git A:L82 exposent error:spawnSync git EPERM malgré status0 et stdout renseigné. L’activation refuse aussi sur error, pas uniquement sur status ([project-activation-service.mjs:105](https://github.com/leuzeus/aidn/blob/6a79e0dd983bb8d16769017d2ac9cbb011de2b05/src/application/install/project-activation-service.mjs#L105)). Les retries de consultation hors sandbox sont approuvés nativement puis rendent activation active ; l’inventaire conserve ce changement de contexte sans le confondre avec une autorisation universelle ou une correction produit.

Le code de sortie d’un groupe shell ne résume pas toutes ses commandes internes. Les cas suivants conservent l’échec interne alors que le dernier sous-processus du groupe rend0 :

| Groupe | Diagnostic interne conservé | Exit externe |
| --- | --- | ---: |
| A:L3078 | L’helper enregistre CURRENT-STATE puis refuse l’étape suivante : active session is missing et active session file is missing. Le commit et une vérification finale continuent. | 0 |
| A:L4117 | constraint-loop strict retourne1, assertion Python échoue ; la lecture suivante A:L4128 expose CONSTRAINT_CONTROL_SHARE_MAX, 1.0 > 0.7, overall_status:fail et blocking:1. Les commandes Git suivantes continuent. | 0 |
| A:L4205 | Le reporting ordinaire retourne0, puis une assertion d’admission échoue avant les étapes suivantes ; Git status termine le groupe. | 0 |

A:L3586 contient un branch-cycle-audit réussi (command_status0) puis un handoff rejeté qui termine le groupe à1. A:L4026 garde le message Unknown argument: --next-agent-role, puis le parseur Python échoue sur la sortie d’usage non JSON ; le groupe termine à1. Les erreurs de syntaxe/API du caller, les assertions de ses helpers et les commandes natives terminées restent distinctes de failed natif ou de résultat des tests du produit.

## Revue exhaustive des candidats et sorties partielles

Les 201 candidats initialement inconnus ont tous été revus dans leur contexte de commande, et aucun candidat non résolu ne reste.

| Classe de candidat | AIDN | Baseline |
| --- | ---: | ---: |
| Exemples, sources, brief ou manifeste relus | 86 | 60 |
| Fragments JSON dans représentations textuelles Python/JS | 36 | 0 |
| Sous-objets récupérés de JSON parents volontairement tronqués | 8 | 0 |
| Diagnostics Git de l’observateur | 3 | 0 |
| Tableaux de refus extraits d’un Error de helper | 2 | 0 |
| Projections JSON d’observateur AIDN | 2 | 0 |
| Rapport de seuil AIDN relu | 1 | 0 |
| Configuration AIDN relue | 1 | 0 |
| Réponse project-handoff-packet complète reconnue après revue | 1 | 0 |
| Réponse de health produit observée, hors AIDN | 0 | 1 |

Le runtime-state A:L2048 est volontairement découpé aux 5 000 premiers caractères ; trois sous-objets complets sont récupérables. Le handoff A:L2891 est volontairement découpé aux 6 500 derniers caractères ; cinq sous-objets complets sont récupérables. Aucun de ces huit objets n’est requalifié comme réponse parent complète ni validé artificiellement contre son schéma public. Les deux tableaux de refus A:L629/A:L3078 proviennent d’un helper qui sérialise les blocking_reasons ; ils corroborent un diagnostic secondaire, sans inventer un JSON complet ni une décision supplémentaire.

Les apparitions None dans les dictionnaires Python imprimés utilisent souvent d.get(k) sur une clé absente. Elles ne prouvent pas que le producteur avait émis k:null. Les tableaux vides et objets récupérés dans les sources/exemples ne sont pas des réponses runtime. Les objets error dans les README/source de A:L3436, B:L584 et B:L1079 sont des exemples, pas des erreurs AIDN ou natives. La configuration A:L3478 indique sourceBranch:main et backend postgres ; elle ne contient aucun motif nul.

## Inventaire de tous les chemins observés

Chaque tableau est borné à sa famille. Observations = occurrences de champs ; Sans chemin = documents de cette famille où ce chemin n’est pas présent. Plusieurs entrées de tableau peuvent porter le même chemin [] dans un document. Les champs summary.reason_codes et summary.blocking_reasons sont suivis explicitement comme absents dans les quatre réponses compactes ; ils ne sont pas signalés comme nulls. Les champs natifs absents contrôlés indépendamment sont documentés dans le tableau natif plus haut.

### AIDN

#### Protocole natif/provider

**response** — 6 documents ; 0 répétitions exactes. Lignes 1, 3, 7, 1887, 3209, 3213.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.result.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 3 |

**warning** — 2 documents ; 0 répétitions exactes. Lignes 5, 3211.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**mcpServer/startupStatus/updated** — 4 documents ; 0 répétitions exactes. Lignes 6, 11, 3212, 3216.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.failureReason` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `$.params.error` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |

**turn/started** — 3 documents ; 0 répétitions exactes. Lignes 9, 1889, 3215.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

**hook/started** — 121 documents ; 0 répétitions exactes. Lignes 12, 51, 55, 59, 67, 71, 79, 149, 160, 164, 168, 253….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.run.statusMessage` | 121 | 121 | 0 | 0 | 0 | 0 | 0 |

**hook/completed** — 121 documents ; 0 répétitions exactes. Lignes 13, 52, 56, 60, 68, 72, 80, 150, 161, 165, 169, 254….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.run.statusMessage` | 121 | 121 | 0 | 0 | 0 | 0 | 0 |

**item/autoApprovalReview/started** — 62 documents ; 0 répétitions exactes. Lignes 152, 171, 362, 466, 474, 487, 625, 637, 715, 729, 751, 852….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 62 | 62 | 0 | 0 | 0 | 0 | 0 |

**guardianWarning** — 62 documents ; 0 répétitions exactes. Lignes 153, 172, 363, 467, 475, 488, 626, 638, 716, 730, 752, 853….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 62 | 0 | 0 | 0 | 0 | 62 | 0 |

**item/autoApprovalReview/completed** — 62 documents ; 0 répétitions exactes. Lignes 154, 173, 364, 468, 476, 489, 627, 639, 717, 731, 753, 854….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 62 | 0 | 0 | 0 | 0 | 62 | 0 |

**turn/completed** — 3 documents ; 0 répétitions exactes. Lignes 1886, 3208, 4406.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

#### JSON terminal AIDN complet

**pre-write-admit/full** — 6 documents ; 1 répétitions exactes. Lignes 54, 157, 176, 3269, 3350, 3445.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.activation.errors` | 6 | 0 | 0 | 4 | 0 | 2 | 0 |
| `$.source_of_truth.issues` | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| `$.blocking_reasons` | 6 | 0 | 0 | 4 | 0 | 2 | 0 |
| `$.warnings` | 6 | 0 | 0 | 2 | 0 | 4 | 0 |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_state_backend.runtime_backend.connection.message` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_runtime_validation.issues` | 4 | 0 | 0 | 4 | 0 | 0 | 2 |
| `$.shared_runtime_validation.warnings` | 4 | 0 | 0 | 4 | 0 | 0 | 2 |
| `$.shared_runtime_validation.checks.shared_runtime_contract_complete.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_runtime_validation.checks.shared_runtime_root_is_trusted.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_runtime_validation.checks.locator_project_identity_consistent.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_runtime_validation.checks.locator_workspace_identity_consistent.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.shared_runtime_validation.checks.nested_project_locator_topology_clear.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.context.usage_matrix_rationale` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.context.source_of_truth_reason_codes` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.current_state_exists.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.current_state_consistency.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.mode_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.branch_kind_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.active_session_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.active_cycle_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.session_file_exists.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.cycle_status_exists.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.first_plan_step_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.dor_ready_or_override.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.usage_matrix_close_or_promotion_ready.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.runtime_state_exists.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_policy_resolved.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_policy_resolved.reason_code` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_state_mode_alignment.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_state_mode_alignment.reason_code` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_db_only_source_alignment.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.source_of_truth_db_only_source_alignment.reason_code` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.runtime_repair_status_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.current_state_freshness_known.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |
| `$.checks.shared_planning_scope_selected.details` | 4 | 0 | 0 | 0 | 0 | 4 | 2 |

**bootstrap-diagnostics.v1** — 2 documents ; 0 répétitions exactes. Lignes 70, 3280.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.assets.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.assets.warnings` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.activation.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.capabilities.warnings` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.errors` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.warnings` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**runtime-workflow-action.v1 [help]** — 2 documents ; 1 répétitions exactes. Lignes 272, 3470.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.errors` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.warnings` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |

**run-json-hook/start-session/compact** — 2 documents ; 0 répétitions exactes. Lignes 366, 3570.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.summary.reason_codes` | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| `$.summary.blocking_reasons` | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| `$.reason_codes` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.reason_code` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.blocking_reasons` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.repair_layer_advice` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.repair_primary_reason` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.error` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.reason` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.db_sync.error` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.normalized.reason_code` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.blocking_reasons` | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| `$.normalized.repair_layer_advice` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.normalized.repair_primary_reason` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.normalized.error` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.reason_code` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.repair_layer_advice` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.summary.repair_primary_reason` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| `$.daemon.reason` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**db-first-artifact** — 3 documents ; 0 répétitions exactes. Lignes 479, 3693, 3693.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.artifact.classification_reason` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| `$.artifact.canonical.contract_findings[].message` | 16 | 0 | 0 | 0 | 0 | 16 | 0 |
| `$.artifact.canonical.metadata_findings[].message` | 14 | 0 | 0 | 0 | 0 | 14 | 0 |
| `$.artifact.canonical.derived_runtime_context.repair_primary_reason` | 1 | 1 | 0 | 0 | 0 | 0 | 2 |

**run-json-hook/cycle-create/compact** — 1 documents ; 0 répétitions exactes. Lignes 491.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.summary.reason_codes` | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `$.summary.blocking_reasons` | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `$.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.payload.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.db_sync.payload.fallback_full_reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.payload.fast_path.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.db_sync.payload.repair_layer_result.skip_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.db_sync.payload.repair_layer_triage_result.skip_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.normalized.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.summary.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.daemon.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**skill-hook/drift-check** — 1 documents ; 0 répétitions exactes. Lignes 865.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.levels.level1.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.levels.level3.reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.summary.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.summary.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**state-reanchor/preview** — 1 documents ; 0 répétitions exactes. Lignes 2064.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.backend.connection.driver.rationale` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.backend.connection.message` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.plan.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.canonical_write.reason` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |

**skill-hook/handoff-close** — 1 documents ; 0 répétitions exactes. Lignes 2900.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.summary.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.summary.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.summary.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.payload.summary.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**run-json-hook/branch-cycle-audit/compact** — 1 documents ; 0 répétitions exactes. Lignes 3586.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.summary.reason_codes` | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `$.summary.blocking_reasons` | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `$.reason_codes` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.db_sync.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.db_sync.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.normalized.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.normalized.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.normalized.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.normalized.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.reason_code` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `$.summary.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.summary.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.daemon.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**handoff-admit/full** — 1 documents ; 0 répétitions exactes. Lignes 3586.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.route.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.status.issues` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.status.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.shared_planning_gate_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_state_backend.runtime_backend.connection.message` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.issues` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.shared_runtime_validation.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.shared_runtime_validation.checks.shared_runtime_contract_complete.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.shared_runtime_root_is_trusted.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.locator_project_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.locator_workspace_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.nested_project_locator_topology_clear.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.shared_planning_gate_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.transition_policy_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.transition_policy.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_parseable.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.session_branch_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.cycle_branch_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.branch_kind_known_when_active.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.committing_requires_cycle.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.committing_requires_dor.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.committing_requires_first_plan_step.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.active_session_file_exists.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.session_branch_matches_session_file.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.branch_kind_matches_session_file.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.mode_matches_session_file.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.cycle_branch_matches_session_file.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.active_cycle_matches_session_tracking.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.active_cycle_status_exists.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.cycle_branch_matches_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.dor_state_matches_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.session_owner_matches_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_not_older_than_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_not_older_than_dor_check.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.snapshot_session_aligned.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.snapshot_cycle_aligned.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.issues` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.packet_resolution.selection_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**project-handoff-packet/full** — 1 documents ; 0 répétitions exactes. Lignes 4040.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_state_backend.runtime_backend.connection.message` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_coordination_backend.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_coordination_sync.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_coordination_sync.backend.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.issues` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.shared_runtime_validation.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.shared_runtime_validation.checks.shared_runtime_contract_complete.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.shared_runtime_root_is_trusted.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.locator_project_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.locator_workspace_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.shared_runtime_validation.checks.nested_project_locator_topology_clear.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.shared_planning_gate_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.packet.transition_policy_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_parseable.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.active_cycle_status_exists.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_not_older_than_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.consistency.checks.updated_at_not_older_than_dor_check.details` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

#### Projections, lectures et diagnostics d’observateur

**git-spawn/diagnostic-observer** — 3 documents ; 0 répétitions exactes. Lignes 82, 82, 82.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.error` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |

**pre-write-admit/observer-denial-array** — 2 documents ; 0 répétitions exactes. Lignes 629, 3078.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aucun diagnostic reconnu observé | 0 | 0 | 0 | 0 | 0 | 0 | Sans attente universelle |

**pre-write-admit/observer-projection-subset** — 1 documents ; 0 répétitions exactes. Lignes 642.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.context.usage_matrix_rationale` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.context.source_of_truth_reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.source_of_truth.issues` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |

**normalized-hook/drift-check/readback** — 1 documents ; 0 répétitions exactes. Lignes 865.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.reason_codes` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.blocking_reasons` | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `$.repair_layer_advice` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `$.error` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |

**aidn-config/readback** — 1 documents ; 0 répétitions exactes. Lignes 3478.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aucun diagnostic reconnu observé | 0 | 0 | 0 | 0 | 0 | 0 | Sans attente universelle |

**perf-constraint-thresholds/readback** — 1 documents ; 0 répétitions exactes. Lignes 4128.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.checks[].message` | 3 | 0 | 0 | 0 | 0 | 3 | 0 |

#### Sous-objets de sorties tronquées

**project-runtime-state/truncated-child** — 3 documents ; 0 répétitions exactes. Lignes 2048, 2048, 2048.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.runtime_backend.connection.driver.rationale` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.runtime_backend.connection.message` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.issues` | 1 | 0 | 0 | 1 | 0 | 0 | 2 |
| `$.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 2 |
| `$.checks.shared_runtime_contract_complete.details` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.checks.shared_runtime_root_is_trusted.details` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.checks.locator_project_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.checks.locator_workspace_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| `$.checks.nested_project_locator_topology_clear.details` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |

**project-handoff-packet/truncated-child** — 5 documents ; 0 répétitions exactes. Lignes 2891, 2891, 2891, 2891, 2891.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.reason` | 2 | 0 | 0 | 0 | 0 | 2 | 3 |
| `$.backend.reason` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.issues` | 1 | 0 | 0 | 1 | 0 | 0 | 4 |
| `$.warnings` | 1 | 0 | 0 | 1 | 0 | 0 | 4 |
| `$.checks.shared_runtime_contract_complete.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.shared_runtime_root_is_trusted.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.locator_project_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.locator_workspace_identity_consistent.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.nested_project_locator_topology_clear.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.shared_planning_gate_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.transition_policy_reason` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.updated_at_parseable.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.active_cycle_status_exists.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.updated_at_not_older_than_status.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| `$.checks.updated_at_not_older_than_dor_check.details` | 1 | 0 | 0 | 0 | 0 | 1 | 4 |

#### JSON des entrées de hooks

**native-hook/admission-summary** — 10 documents ; 6 répétitions exactes. Lignes 13, 939, 1049, 1229, 1479, 2365, 2382, 2509, 2655, 3218.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.blocking_reasons` | 10 | 0 | 0 | 10 | 0 | 0 | 0 |
| `$.omissions.blocking_reasons` | 10 | 0 | 0 | 0 | 0 | 10 | 0 |

### baseline

#### Protocole natif/provider

**response** — 6 documents ; 0 répétitions exactes. Lignes 1, 3, 7, 540, 1027, 1031.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.result.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 3 |

**warning** — 2 documents ; 0 répétitions exactes. Lignes 5, 1029.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 2 | 0 | 0 | 0 | 0 | 2 | 0 |

**mcpServer/startupStatus/updated** — 4 documents ; 0 répétitions exactes. Lignes 6, 11, 1030, 1034.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.failureReason` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `$.params.error` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |

**turn/started** — 3 documents ; 0 répétitions exactes. Lignes 9, 542, 1033.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

**item/autoApprovalReview/started** — 15 documents ; 0 répétitions exactes. Lignes 164, 272, 285, 318, 399, 603, 710, 758, 777, 869, 1120, 1243….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 15 | 15 | 0 | 0 | 0 | 0 | 0 |

**guardianWarning** — 15 documents ; 0 répétitions exactes. Lignes 165, 273, 286, 319, 400, 604, 711, 759, 778, 870, 1121, 1244….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.message` | 15 | 0 | 0 | 0 | 0 | 15 | 0 |

**item/autoApprovalReview/completed** — 15 documents ; 0 répétitions exactes. Lignes 166, 274, 287, 320, 401, 605, 712, 760, 779, 871, 1122, 1245….

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.review.rationale` | 15 | 0 | 0 | 0 | 0 | 15 | 0 |

**turn/completed** — 3 documents ; 0 répétitions exactes. Lignes 539, 1026, 1566.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `$.params.turn.error` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

#### Projections, lectures et diagnostics d’observateur

**product-health/observer-response** — 1 documents ; 0 répétitions exactes. Lignes 322.

| Chemin | Observations | Null | Chaîne vide | Tableau vide | Objet vide | Non vide | Sans chemin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aucun diagnostic reconnu observé | 0 | 0 | 0 | 0 | 0 | 0 | Sans attente universelle |

## Preuves secondaires, doublons et conservation

Les neuf fichiers JSON/JSONL secondaires de chaque bras ont été parsés séparément : mesure de disponibilité, clocks, RPC timing, usage, phase timing, snapshots phase1/phase3, upgrade et résumé de run. Seul measurement-availability contient des champs de motif reconnus : cinq reasons non vides par bras, liés aux métriques indisponibles. Aucun autre motif nul reconnu n’est observé dans ces métadonnées. Les snapshots phase1/phase3 sont exactement les response.result déjà capturés (A:L3/A:L3209, B:L3/B:L1027), avec turns:[] : ce ne sont pas des décisions supplémentaires.

Les clocks correspondent aux 4 406/1 566 événements par ordinal et méthode, sans mismatch ; ils ne contiennent pas les raisons. Le crosscheck natif trouve huit paires d’événements exactement identiques dans A et une dans B, uniquement des deltas de messages agent. Aucun doublon de review/hook/error n’est identifié. Les contextes JSON de hooks ont dix observations, quatre contenus distincts et six répétitions ; ces répétitions ne créent pas de nouvelles décisions indépendantes.

Les logs stderr sont composés de 55 600/18 246 lignes INFO, sans WARN/ERROR ni match de diagnostic reason/parse/argument/hook ; leurs 20/7 paires de lignes répétées ne deviennent pas des incidents. L’inventaire garde les empreintes des fichiers auxiliaires de seed et de la copie SQLite sans exécuter cette copie. La lecture des projets ou DB produit hors traces n’est pas nécessaire à ce constat diagnostique.

Les hashes suivants identifient les entrées principales ; toutes les empreintes d’évidence et les 28 bindings source/package sont conservés localement :

| Entrée | SHA-256 |
| --- | --- |
| Trace AIDN | `09348af9b4e8d149b3845ef4158948ad2b408d24d49b0f2094185f6522da4cbd` |
| Trace baseline | `7e110f5fe501123eea750d75766b15fef61c82ba2f1084cb32ee63f30a14e0ce` |
| Qualification BOTH_FINAL racine | `dfeb6f91d1f3d29619b1ceb41fdb908c4d566f8297e6b89fcc24a555b1d313fd` |

Les campagnes précédentes restent distinctes et immuables. Aucune trace future active n’a été lue. Les agrégats JSON locaux comprennent classifications, contextes, absences, hashes et limites ; les corps de réponses, commandes brutes, chemins absolus des projets, secrets et code du produit restent exclus de ce Markdown publiable. Le seul défaut de schéma constaté et les différences de sources/axes restent documentés sans correction ni requalification de livraison.
