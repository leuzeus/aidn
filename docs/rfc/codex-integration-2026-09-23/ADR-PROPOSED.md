# ADR proposée — intégration Codex, autorité AIDN unique

Statut : **Proposed / non acceptée**, 2026-09-23. Proposition dans le dossier RFC ;
aucun numéro d'ADR active réservé et aucune décision existante remplacée.
Promotion éventuelle dans `docs/ADR/` lors de la décision du propriétaire et du
lot ASSURED qui aligne code, politiques, contrats, tests et documentation.

Preuves : [audit](AUDIT.md), [capacités](CAPABILITIES.md), [plan](PLAN.md).
Règles inchangées : ADR-0004/0005 contrats/effets, ADR-0006 information,
ADR-0007/0008 local-first/coordination, ADR-0009 provenance, ADR-0010 lanes.

## Problème et décision proposée

AIDN sait déjà installer son workflow, admettre une action, hydrater un contexte,
valider et clôturer. Sa jonction à Codex mélange présence d'assets, découverte,
guidance et contrôle exécuté. La conservation des configurations client et le
lancement Windows doivent être fiabilisés avant d'ajouter un transport.

Adopter **A pour le MVP** : AGENTS + skills existants + hooks natifs compatibles
appelant les cas d'usage AIDN par le chemin local le plus court. Les admissions
critiques utilisent le core/CLI local, sans dépendre de l'initialisation MCP.
Le raccord ne sera qualifié de bloquant que pour chaque événement/outil/client
ayant une preuve de refus dans une session approuvée. La reprise automatique
reste distincte d'une transition métier.

**B est différé** : adaptateur MCP mince seulement si les mesures montrent une
valeur d'accès structuré ou d'intégration multi-client, à coût acceptable. Aucun
MCP de production dans ce spike. **C est une option de distribution**, pas le
prérequis de l'installation nominale. **Runner/app-server est séparé**, uniquement
pour une exécution explicitement déléguée ; aucune prise de contrôle d'un chat
existant ni fork de Codex.

## Comparaison des options

| Critère | A : CLI + skills/hooks | B : A + MCP mince | C : packaging plugin | Runner/app-server |
|---|---|---|---|---|
| Fiabilité | Moins d'étapes pour admission ; hooks non approuvés/erreurs restent limites | Ajoute transport, startup, timeout ; pas intrinsèquement plus bloquant | Dépend du runtime A/B et de confiance hook | Peut maîtriser sa propre boucle si conçue/testée |
| Contrôles | Core AIDN + outils natifs couverts vérifiés | Ne contrôle que ses appels ; hooks MCP ont pannes laissant continuer | N'ajoute aucune autorité ni interception | Ne contrôle pas automatiquement chats extérieurs |
| Installation | Étendre bootstrap existant | Même bootstrap, config projet et processus supplémentaire | Support disponible dans docs/runtime ; installation AIDN plugin non testée | Parcours avancé séparé |
| Clients/maturité | Skills détectés 0.146/0.155 ; hooks command schéma présent | `mcp_tool` accepté 0.155, fichier rejeté 0.146 | Schéma/distribution évolutifs ; pas de compatibilité déduite du seul main | Protocole réel initialize/skills/hooks interrogé ; orchestration métier non testée |
| Reprise | Backend + cache compact dérivé ; événements qualifiés | Même sources, pas d'état parallèle | Même moteur, migration sans doublons nécessaire | Session gérée par son client, scope explicite |
| Latence | Baseline locale mesurée, overhead hook/process à réduire si pertinent | Latence/amortissement non mesurés ; aucune promesse | Pas de gain runtime établi | Coût continu et intégration supplémentaire |
| Tokens | Métadonnées skills puis méthode à la demande, réponse compacte | Inventaire outils et enveloppes ajoutent du contexte ; gain à mesurer | Packaging ne garantit pas moins de contexte | Budget à instrumenter par run |
| Dépendances | Node/Git/AIDN + client déjà utilisé | Serveur local stdio optionnel, aucun service distant/clé nouvelle | Distribution, versions et cache plugin | Service/process contrôlé uniquement sur besoin |
| Maintenance | Réutilise install, policies, core et fixtures | Mapping étroit + contrats protocole à entretenir | Risque double installation/source de hooks | Plus haut coût, surface de sécurité/exploitation |
| Réversibilité | Revert code + retrait conditionnel des objets gérés | Désactiver transport sans perdre workflow A | Revenir au pack classique sans doubler assets | Arrêter runner, conserver preuves/état AIDN |

## Répartition des responsabilités

- AGENTS : invariants, préséance et routage minimal. Les phrases cache/canonique
  sont alignées ; aucun inventaire exhaustif ni logs de session dans AGENTS.
- Skills : méthode chargée à la demande, exemptions/lanes conservées. Aucun spike
  obligatoire pour une correction triviale.
- Hooks : événements natifs effectivement supportés, lancement, traduction des
  refus et contexte compact. Les règles métier restent dans core/use-cases.
- CLI/MCP éventuel : mêmes cas d'usage, même résolution projet/worktree, mêmes
  politiques d'effets ; validation de sortie entière et diagnostics séparés.
- Bootstrap : distribution, comparaison des assets, conflits/migration, réparation
  explicite ; ne modifie ni confiance, ni sandbox, ni `~/.codex` silencieusement.
- Plugin : paquet de ces mêmes assets, identité install exclusive/dédupliquée.
- CI : admission de livraison, distincte du contrôle de l'édition locale.

## Contrat MCP éventuel, proposition conditionnelle

Pas de noms de commandes CLI réputés existants. Les noms ci-dessous seraient
**de nouveaux outils**, pas l'export de toutes les fonctions internes.

| Outil candidat | Réemploi | Effet / limite |
|---|---|---|
| `aidn_context` | `project-runtime-state --json`, `state-reanchor --json`, descripteur artifact-fetch | Non mutatif : lecture/preview selon opération, effect_class sous-jacent conservé ; résumé + références ; pas de hydrate implicite |
| `aidn_admit` | pre-write-admit + coordinator-next-action | Read-only ; périmètre exact, raisons et prochaine action ; refus ne bloque pas les autres outils |
| `aidn_checkpoint` | use-case checkpoint existant, adaptateur interne à formaliser | Mutation explicite ; pas exposé avant contrat/DoR et idempotence |
| `aidn_transition` | moteur transition/session/cycle existant | Mutation explicite ciblée ; pas de transition générique sur chaîne arbitraire ni acceptation d'un booléen de preuve |

Enveloppe proposée versionnée : version transport + référence du contrat CLI
réutilisé, effect_class, identité résolue, révision AIDN/policy, résultat, erreurs
structurées, preuves et identifiant de corrélation. Distinguer refus métier,
arguments invalides, contexte périmé, conflit concurrent et infrastructure
indisponible. Préserver les champs `issues`/`errors` existants ; nouvelle version
si rupture plutôt que renommer v1. Parse JSON intégral, jamais extraction d'une
sous-chaîne. Réponses bornées et redaction des valeurs de connexion.

L'identité vient du resolver existant (project/workspace/worktree/runtime_scope),
pas d'un chemin choisi librement par le modèle. Les effets mutatifs vérifient
scope autorisé, état attendu, pré-image/contenu, version de règles, preuve et
concurrence avant application. Clef d'idempotence liée à l'action et au scope ;
même clef + payload différent = conflit. Échec de backend canonique = refus,
pas fallback caché. Aucun nouveau journal, DB ou automate MCP : étendre les
concepts/ports existants seulement après audit de couverture gouvernance.

`files`, `dual`, `db-only` restent distincts. SQLite local reste possible,
PostgreSQL optionnel, synchronization partagée uniquement avec intention explicite.
Le cache de reprise expose état compact, prochaine action, anomalies, scope et
preuves manquantes, mais ne peut attester un test qu'il n'a pas observé.

## Contrôles et pannes

Pour un futur PreToolUse local : capturer entrée réelle du client, valider son
schéma, résoudre le scope, appeler admission read-only, et traduire un refus vers
le protocole natif vérifié. Un exit 1 AIDN ne doit jamais être supposé égal à un
blocage Codex ; wrapper vivant peut convertir panne/timeout en refus explicite,
mais wrapper absent/non approuvé/crashé ne garantit plus ce refus. Éviter shell
arbitraire, réseau et récursion ; délai borné, diagnostic court, pas d'effet métier.

Un hook MCP ajoute dépendance à un serveur prêt et à un outil chargé ; SessionStart
ne constitue pas un point d'attente fiable pour lui. Les appels parallèles et
répétitions ne doivent pas provoquer deux transitions. Pas d'ordre causal entre
hooks concurrents supposé : prérequis dépendants restent dans un seul use-case.

La preuve d'une validation comprend commande, code/signal, contenu réellement
testé, branche/commit + empreinte des modifications pertinentes, identité
worktree, policy/règles, timestamp et artefacts. Changement pertinent invalide
l'admission ; revalider avant transition. Ne pas assimiler bundle_revision à
empreinte de tests, ni données du modèle à approbation humaine. Risque TOCTOU
résiduel explicite pour écriture native non encapsulée.

## Conditions d'acceptation et rollback

Acceptation proposée : premier lot sans perte des hooks/config tiers ; baseline
et diagnostic avec états distincts ; preuves client du refus sur chemins couverts ;
tests négatifs en panne ; aucune annonce de blocage universel. MCP exige en plus
un bénéfice mesuré sur scénarios identiques et la fermeture des risques concurrence.

Rejetées : nouveau moteur MCP, daemon/DB/clé LLM obligatoire, téléchargement flottant
par session, trust automatique, wrapper universel d'internes, runner supposé piloter
le chat courant. Si A ne suffit pas à un besoin mesuré, réouvrir B ou runner avec
preuves, sans promettre un durcissement absent du client.

Rollback : rétablir version précédente par les services install existants étendus
avec comparaison pré/post-images ; conserver tout fichier modifié ensuite et
rapporter conflit. Retirer seulement objets gérés reconnus. Aucune restauration
aveugle d'une ancienne sauvegarde, aucune suppression d'historique utilisateur.
