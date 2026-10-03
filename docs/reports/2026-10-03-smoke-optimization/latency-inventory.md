# Inventaire des mesures de latence, tokens et frictions natives

**Métadonnées natives vérifiées.** Les scores, la validité de la comparaison et
les conclusions sont traités dans le rapport principal. Les deux premières tentatives corrigées
sont terminées, cleanup PASS, modèle exact `gpt-6.1-sol`, effort medium, deux
threads par bras et zéro reroute. Les gardes réelles `/proc` avant/après trouvent
zéro runner/transport/app-server candidat vivant. Les 18 inputs restent identiques
par SHA256 ; clocks, ordinals et digests concordent. Cette analyse ne donne aucun
score, gain causal ou conclusion AID’N/GFD. Cet inventaire repose uniquement sur les traces et les preuves metadata : aucun
fichier produit n’a été ouvert par cette analyse et aucun fichier source,
package, campagne ou harness n’a été modifié.

## Temps et tokens

| Mesure corrigée | A avec AID’N | B baseline |
| --- | ---: | ---: |
| Chrono phases (s) | 2 010,985186 | 992,314165 |
| Phases 1 / 2 / 3 (s) | 890,737 / 673,219 / 447,029 | 445,656 / 368,760 / 177,898 |
| Entrée totale | 7 222 449 | 945 767 |
| Dont cache entrée | 6 987 520 | 823 424 |
| Entrée neuve | 234 929 | 122 343 |
| Sortie totale | 49 948 | 26 602 |
| Dont raisonnement | 6 089 | 3 551 |
| Total entrée+sortie | 7 272 397 | 972 369 |
| Proxy entrée neuve+sortie | 284 877 | 148 945 |
| Cache / entrée | 96,747239 % | 87,064150 % |
| Cache-write explicitement émis | 0 | 0 |

Le dernier cumul est pris une fois par thread distinct ; les phases 1/2 du même
thread ne sont pas doublées. Cache ⊂ entrée et raisonnement ⊂ sortie. Les
dénominateurs exigences/qualité restent null. Total des deux bras : 8 244 766
tokens, dont 433 822 entrée neuve+sortie, hors préparation/confiance/préflights
et tokens auxiliaires non exposés. Il ne s’agit pas d’une facture monétaire.

A/B descriptif : chrono 2,026561 ; total tokens 7,479051 ; neuf+sortie 1,912632.
Ces ratios ne démontrent ni une cause ni une qualité relative. Aucun padding
après fin. Fixture phase 1 : PASS, 0,251011 / 0,263015 s, hors chrono productif.

A reçoit 88 snapshots d’usage ; B 33. B reçoit au **raw line 753** un cumul
inchangé dont `tokenUsage.last` répète le snapshot précédent. Sommer les receipts
last surcompterait B de 46 256 tokens totaux : 44 779 entrée, 41 216 cache,
1 477 sortie et 242 raisonnement. Son total primaire reste **972 369**. Les
distributions de snapshots conservent ce receipt ; leurs counts ne sont pas
des counts de requêtes fournisseur.

## Intervalles et premières réponses

| Mesure (s) | A | B |
| --- | ---: | ---: |
| Fenêtres natives de turn terminé | 2 010,845789 | 992,163250 |
| Union visible tools/hooks/reviews | 307,786502 | 53,861686 |
| Résidu hors union visible | 1 703,059287 | 938,301565 |
| Union commandes | 299,957381 | 52,985482 |
| Union reviews automatiques | 221,920618 | 47,485241 |
| Union hooks | 7,088411 | 0 |
| Union fileChange | 0,741824 | 0,876204 |
| Somme native durée commandes | 68,175 | 3,838 |
| Somme native durée hooks | 6,896 | 0 |
| Somme native durée reviews | 221,879 | 47,477 |

Les catégories se chevauchent : 221,921730 s A et 47,485241 s B seraient comptées
deux fois si elles étaient additionnées. Presque toute l’intersection est
review+commande. Les durées natives sont séparées du temps mural. Le détail
ancré à la première wall clock et l’agrégat monotone direct diffèrent de seulement
0,45 à 2,45 microsecondes par arrondi ; l’union globale ci-dessus vient de l’agrégat.

Écart d’union visible A−B : 253,924816 s. Écart d’union des reviews : 174,435376 s,
des commandes : 246,971899 s. Ils se chevauchent et ne sont pas des coûts
supplémentaires indépendants. Les shell batches mêlent lectures, gouvernance,
environnement et produit ; ils n’isolent pas SQL, cache ou sous-appels.
Le résidu mêle calcul, attente fournisseur, transport et travail non instrumenté.
Il n’est pas un « temps modèle » ; aucune soustraction ne mesure le TTFT fournisseur.

| Phase | Ack submit A/B (ms) | Premier texte visible depuis submit A/B (s) |
| --- | ---: | ---: |
| 1 | 11,789 / 10,529 | 4,419511 / 3,517344 |
| 2 | 8,034 / 4,348 | 2,484703 / 1,662761 |
| 3 | 12,893 / 12,417 | 4,683733 / 2,720060 |

Flush client : 49–141 µs. Ack signifie soumission, pas réponse modèle. Première
sortie de commande depuis submit : A 34,571 / 15,478 / 13,240 s ; B
125,623 / 141,589 / 16,957 s. Ce dernier délai inclut l’attente avant appel,
pas seulement la commande ; les premières sorties visibles ne sont pas le TTFT.

## Counts et volumes

| Observation | A | B |
| --- | ---: | ---: |
| Commandes completed distinctes | 111 | 45 |
| Dont status failed | 12 | 6 |
| Reviews distinctes, toutes approved | 62 | 15 |
| Hooks completed | 121 | 0 |
| Hooks sessionStart / preToolUse | 2 / 119 | 0 / 0 |
| Output agrégé, octets UTF8 | 651 408 | 115 098 |
| Output streaming séparé, octets UTF8 | 240 947 | 17 307 |
| Duplicates exacts agrégés, octets supplémentaires | 12 522 | 257 |
| Contexte hooks, octets / entrées | 6 892 / 10 | 0 / 0 |
| last.inputTokens médiane / max | 81 021 / 139 639 | 30 326 / 51 164 |

Les représentations streaming/agrégées ne sont pas sommées comme contexte
unique ; les octets ne sont pas convertis en tokens. Catégories heuristiques des
batches A : 70 Aidn CLI, 17 gouvernance/contexte, 18 autres/mixtes, 6 vérifications
produit ; B : 30 autres/mixtes, 15 vérifications. Aucun batch n’est un timer SQL.

Les `guardianWarning` sont les avis approved des mêmes 62/15 reviews, pas des
erreurs supplémentaires. Deux warnings symétriques/bras concernent la feature
`respect_system_proxy`. Aucune erreur native, compaction ou reroute observée.
MCP codex_apps fait starting→ready pour les deux threads/bras (4 notifications).
Ready ne prouve ni catalogue identique ni identité de compte.

## Frictions observées, par item distinct

**Infrastructure A :** quatre commandes portent ACTIVATION_GIT_RESOLUTION_FAILED,
admissions lines 54/3269 et diagnostics 70/3280. Deux probes completed lines
82/3288 rapportent chacun trois Git EPERM : deux commandes, six sous-probes,
pas six incidents indépendants. Un shell completed/exit 0 peut rapporter
payload ok:false ou spawnSync EPERM ; ces statuts sont séparés.
Deux reprises read-only du même appel après reviews approuvées réussissent
admission ok:true lines 157/3350. Reviews ciblées 4,480 / 4,150 s ; spans réception
initiale→succès 24,819731 / 21,789095 s, mêlés à diagnostics et décisions modèle.

**Infrastructure B :** deux exécutions directes de la suite API failed lines
157/1114 montrent bind HTTP EPERM. Des vérifications via l’entrée publique reviewed/approved suivent et
completed/exit 0 lines 187/1152, sans fileChange entre échec socket et suivi.
Les commandes littérales diffèrent : deux reprises de famille de vérification,
sans preuve d’appel identique. Reviews 3,192 / 4,335 s ; spans 7,434028 /
8,844360 s. Deux mentions EPERM dans des lectures sont exclues du count d’erreurs.
Les vérifications génériques failed des mêmes séquences ne prouvent pas deux causes
supplémentaires. Aucun Git EPERM AID’N n’est observé dans B.

**Refus gouvernés A :** huit commandes distinctes portent un refus, dont les
quatre activations infra ci-dessus. Les quatre autres sont :

- Lines 629/721 : wrapper d’agent relayant blocking reasons de création de cycle,
  freshness/repair status inconnus en DB-backed et/ou Git non propre avec assets
  workflow non suivis. Refus d’admission observé, pas erreur de syntaxe du wrapper.
- Line 2032 : result stop, START_SESSION_CANONICAL_RUNTIME_INVALID ; session
  déclarée active mais fermée dans les lignes canoniques. Le shell finit exit 0
  en affichant le refus : ce n’est pas un succès d’admission.
- Line 3586 : batch avec branch-cycle audit ok:true, aide CLI puis handoff
  admitted:false/rejected, route reanchor avec stop_required:false. Son échec
  shell ne transforme pas l’audit réussi en échec ; route de reprise et défaut
  produit restent des observations distinctes.

Aucun START_SESSION_BRANCH_NOT_AIDN de la paire invalide antérieure n’est observé
dans les commandes corrigées. Trois start-session réussis ont reason_codes
MISSING_CACHE ou changements branche/HEAD/artefacts + DIGEST_MISS : ce sont des
raisons de recomputation avec result ok, pas des refus ni preuve de cache cassé.
Les reason_code:null de ces sorties sans blocage sont des valeurs de succès.

| Classe des commandes status failed | A | B |
| --- | ---: | ---: |
| Diagnostic activation Git | 2 | 0 |
| Probe de chemin absent | 3 | 0 |
| Admission cycle relayée par wrapper | 2 | 0 |
| Recherche sans match | 1 | 0 |
| Vérification produit native nonzero, sans attribution qualité | 2 | 2 |
| Handoff rejected dans batch mixte | 1 | 0 |
| Argument CLI inconnu + parsing wrapper | 1 | 0 |
| Probe d’absence attendue d’assets baseline | 0 | 1 |
| Bind socket EPERM | 0 | 2 |
| Assertion de contrôle CLI par l’agent | 0 | 1 |
| **Total d’appels failed distincts** | **12** | **6** |

Option CLI non supportée utilisée par le développeur : `--next-agent-role`, line 4026, puis JSONDecodeError du wrapper.
Probes de paths et recherche sans match ne démontrent pas un défaut produit.
Root évalue séparément avec l’oracle gelé et sa revue. Les counts utilisent ids
completed/review/hook uniques ; JSON normalized/summary, streaming et messages
d’agent ne sont pas des erreurs supplémentaires.

## C1 → corrigé : comparaison descriptive

| Mesure | A différence / ratio corrigé:C1 | B différence / ratio corrigé:C1 |
| --- | ---: | ---: |
| Chrono (s) | −153,069091 / 0,929267 | −198,227658 / 0,833498 |
| Tokens entrée+sortie | −745 198 / 0,907055 | −724 505 / 0,573035 |
| Entrée neuve+sortie | −27 886 / 0,910840 | +8 423 / 1,059941 |
| Union visible (s) | +27,252146 / 1,097144 | −215,954885 / 0,199623 |

Ancien timing : receipt wall clock ; corrigé : sidecars monotones. Node/shell de
phase 3 A et capture de fixture corrigés, instrumentation additive, ordre A puis
B, N=1 par bras, infrastructure/réponses fournisseur temporelles. Ces deltas
n’isolent pas l’effet des seuls lots AID’N, du cache ou de GFD. Aucun gain causal.

Paire invalide de préparation **distincte** : A 242,227080 s / 855 593 tokens ;
B 1 240,219146 s / 1 509 605 tokens. Ses 2 365 198 tokens restent un coût retenu ;
aucun ratio principal ne repose sur cette paire.

## Limites et preuves

TTFT fournisseur, queue/transport séparés, SQL/pool/transactions/cache AID’N,
tokens reviewers, coûts exhaustifs de préparation/expérimentateur et facturation
sont UNAVAILABLE. GFD n’a aucun bras isolé. Les dénominateurs qualité restent null.

Les preuves intégrales sont conservées séparément : agrégat JSON de tokens,
clocks, unions et RPC ; audit JSON des items distincts ; inventaires CSV de
commandes, hooks, reviews et timeline ; comparaison JSON C1/corrigé/invalide ;
empreintes d’intégrité et qualification finale. L’inventaire des frictions
regroupe 25 items avec tags multiples, sans inflation, et identifie les mentions
textuelles exclues. Une vérification indépendante en lecture seule confirme les
calculs. Ces preuves ne constituent ni un score ni une attribution causale.

Deux refus d’analyse sont retenus séparément des produits : garde /proc initiale
trop large sur processus hôtes sans rapport avec le smoke ; assertion héritée de
somme de snapshots. Corrections uniquement des copies d’analyse hors campagne,
après fermeture. Les deux refus initiaux et la correction de méthode restent dans les preuves
d’analyse, distincts des résultats des produits. Aucun nouveau smoke,
réparation produit, trust ou modèle n’a été exécuté.

La préparation, les tokens auxiliaires et les timings fournisseur non exposés
restent indisponibles ; ils ne sont jamais remplacés par zéro.
