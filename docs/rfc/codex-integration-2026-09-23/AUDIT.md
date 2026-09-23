# AIDN × Codex — audit ciblé et spike

Date : 2026-09-23 UTC (session commencée le 22 septembre, America/Toronto).
Statut : exploration locale, décision proposée, aucune livraison produit autorisée.

Le résultat utile est de consolider l'installation et les contrôles existants avant
MCP. Deux défauts sont reproduits : perte des hooks tiers lors de l'installation et
échec du lanceur Windows distribué sur un chemin accentué dans le contexte testé.
La découverte des 13 skills est démontrée par deux binaires Codex ; l'exécution
native des hooks approuvés dans l'application reste à qualifier.

- [Capacités externes et limites de preuve](CAPABILITIES.md)
- [ADR proposée : autorité unique et intégration native](ADR-PROPOSED.md)
- [Plan, backlog, installation, acceptation et capsule](PLAN.md)
- [Harness reproductible](spike.mjs) et [résultat observé](spike-results.json)
- [Probe coexistence reproductible](install-preservation-spike.mjs) et [résultat](install-preservation-results.json)
- [Preuves Codex normalisées](codex-evidence.json)

## Frontière du chantier

Ce dépôt est le **produit AIDN (package source), pas une installation cliente**.
Les évolutions proposées concernent son code et ses assets distribuables.
Scaffold = sources ; fixtures = corpus ; installation = cible temporaire seulement.
Aucun cycle, session, état client ou bootstrap n'est créé à la racine du produit.

## Ancrage et autorités

Base locale : `dev`, `cb18abbd01691fb632cc5889882aa01f6efd8d93`, AIDN 0.7.1.
État initial propre. Branche de chantier : `codex/codex-integration-audit-spike`.
La référence locale `origin/dev` vaut `7554468d60242d1f26234df172162e818101bb92`,
deux commits plus loin. Le diff observé contient la publication 0.7.2 et sa
synchronisation (17 fichiers, versions/docs/manifests), pas de modification des
implémentations auditées. Aucun fetch/pull, push, configuration globale ou projet
client réel modifié. Ce rapport ne prétend pas décrire un HEAD distant plus récent.

Profil `TARGETED`, contexte `personal_agent_driven` déclaré par ADR-0010. Parcours
retenus : D (CLI/intégration publique), E (installation/ownership/persistance),
F (confiance, effets, pannes). Exploration `EXPLORE`; futures modifications
installation/contrats/effets/sécurité `ASSURED`. Le resolver interne exécuté sur
la base, sans diff, renvoie `EXPLORE_ONLY` avec `--draft true`. Une première
invocation avec `--requested-lane EXPLORE` a été rejetée `INVALID_REQUESTED_LANE` :
`EXPLORE` est un état draft, pas une valeur admise de cette option. Erreur
opérateur corrigée, pas échec du produit. La classification finale de livraison
reste celle du diff réel au moment de la PR ; cette session ne prouve pas la
readiness de livraison.

Autorités lues : AGENTS, operating model, architecture exécutable, effets CLI,
gouvernance informationnelle, contrats JSON, runtime local-first, DoD/TESTING,
inventaire CLI, politiques d'effets/source-of-truth/métadonnées, matrice runtime,
ADR-0007/0008/0009/0010 et index ADR/RFC. Le registre CLI et les politiques
précèdent leur inventaire documentaire. Les plans/backlogs sont des intentions ou
historiques, les fixtures des corpus, le bundle hydraté un cache, les schémas
Codex générés une preuve de capacité du binaire interrogé. Aucun ZIP historique
ni rapport Deep Research supposé n'a servi de référence.

## Parcours réel et diagnostic

Références de code relatives à la racine du dépôt, lignes de la base figée.

| Étape | Fonctions/fichiers déterminants | Effets et autorité | Diagnostic / preuve |
|---|---|---|---|
| Bootstrap | `tools/bootstrap.mjs:140-223,263-282` compose install/config/migration/vérification | `bootstrap` mutatif ; `--dry-run` preview ; `--json` format seul | **Conserver**, compléter preview : aujourd'hui liste de commandes, pas préflight/conflits |
| Installation | `tools/install.mjs:133-144`; `src/application/install/install-use-case.mjs:156` | Manifests + services copy/merge/ownership ; écrit la cible explicite | **Conserver**, suites bootstrap/idempotence PASS sur temp |
| Assets Codex | `packs/core/manifest.yaml:11-20`; `packs/codex-integration/manifest.yaml:7-17` | `.agents/skills`, `.codex/agents`, hooks ; `.aidn/codex/skills.yaml` inventaire AIDN | **Compléter** ownership et déduplication ; inventaire YAML distinct de découverte native |
| Découverte | `tools/verify/codex-discovery-lib.mjs:52-205`; `scaffold/codex_hooks/scripts/aidn-session-start.mjs:37-63` | `skills/list` réel contre fixture ; hook ne vérifie que trois chemins | **Conserver** 13 skills détectés ; **non vérifié** activation rôles/model/account |
| Démarrage/reprise | `scaffold/root/AGENTS.md:61-85`; `src/core/skills/skill-policy.mjs:5-18` | Guidance context-reload puis start-session ; SessionStart injecte texte | **Compléter**, pas d'hydratation/admission native automatique aujourd'hui |
| Admission | `tools/runtime/pre-write-admit.mjs:635-643,816-831,1056-1057`; use-case `:560-577` | Read-only, backend canonique/identité/fraîcheur ; exit nonzero sur refus seulement avec strict | **Conserver**, interpréter JSON ; pas de permis atomique sur shell/édition |
| Activité | `tools/codex/workflow-step.mjs:243-334,481-482`; `src/application/codex/run-json-hook-use-case.mjs:263-366` | workflow-step projector ; admission puis cache même si refus ; run-json-hook interne exécute les skills | **Conserver**, ne pas exposer l'interne arbitrairement en MCP |
| Hydratation | `src/application/codex/hydrate-context-use-case.mjs:558-575,594-635,731-836` | Sélection/budget/hash et fetch déjà présents ; cache écrit, projections selon mode/options, explicites en db-only ; workflow-step désactive les projections visibles | **Conserver**, cache ≠ preuve de tests ni source canonique |
| Validation | [scaffold/codex/drift-check/SKILL.md](https://github.com/leuzeus/aidn/blob/70173d0cab9c991dc83d6f4a6774ffeed978a67f/scaffold/codex/drift-check/SKILL.md); `tools/perf/gating-evaluate.mjs` | Contrôles AIDN et CI existants, dépendants du chemin emprunté | **Compléter** liaison preuve-contenu ; ne pas accepter un booléen de modèle |
| Clôture | `src/application/runtime/workflow-transition-lib.mjs:279-345`; [scaffold/codex/close-session/SKILL.md:20-106](https://github.com/leuzeus/aidn/blob/70173d0cab9c991dc83d6f4a6774ffeed978a67f/scaffold/codex/close-session/SKILL.md#L20-L106) | Refus de clôture sans session/décisions/cycles résolus ; checkpoint existant | **Conserver** moteur ; preuve d'origine humaine des décisions à renforcer |

`src/core/cli/command-registry.mjs` demeure la source des commandes. Les contrats
`bootstrap.v1`, `bootstrap-preview.v1`, `runtime-pre-write-admit.v1`,
`codex-hydrate-context.v1`, `codex-workflow-step.v1` existent sous
`src/core/contracts/cli-output/`. `run-json-hook` est interne. `hydrate-context`
et `workflow-step` ne doivent pas recevoir un attribut MCP read-only par erreur.

## Constats priorisés

| ID / catégorie | Preuve, risque et coût | Disposition principale / action |
|---|---|---|
| F1 `validation_debt` — haute confiance | Probe coexistence : install exit 0 remplace SessionStart/Stop tiers. Manifest copy + `template-copy-service.mjs:131-150`. Perte de contrôles client ; coexistence probable lors d'upgrade, fréquence non mesurée | **Corriger** / `replace_with_executable_test` : fixture de conservation et fusion structurée |
| F2 `false_block_risk` — haute pour ce contexte | Lanceur `commandWindows` : ASCII avec espace exit 0, accent exit 1 MODULE_NOT_FOUND, direct Node accent exit 0. PowerShell/Git transforme le chemin. Coût observé ~0,8 s avant erreur ; environnement Codex complet non testé | **Corriger** / `replace_with_executable_test` : Unicode de bout en bout, racine/sous-dossier |
| F3 `manual_but_automatable` — haute | SessionStart ne fait que présence + texte, aucune pre-admission native. Coût du hook direct ~165 ms médiane, pas coût session | **Compléter** / `automate` après preuve client, réutiliser core |
| F4 `insufficient_evidence` — haute | Codes retour 0 malgré admission blocked ; scripts documentés plus bas. Un simple succès processus accepterait un refus métier | **Conserver avec raccord correct** / `add_compensating_control` : parser JSON et traduire le refus selon protocole Codex, jamais exit 1 supposé bloquant |
| F5 `temporal_authority_conflict` — haute | `scaffold/root/AGENTS.md:46` dit backend + bundle canonique, `:49` cache ; matrice runtime `:46` dit cache jamais canonique | **Corriger** / `reduce_required_context` : backend canonique, reprise cache dérivée |
| F6 `insufficient_evidence` — moyenne | `src/adapters/codex/context-store.mjs:54-126` read/append/write sans verrou/CAS ; noms au milliseconde. Course/perte inférées, non reproduites | **Compléter** / `requires_more_measurement` avant mutation MCP/multi-agent |
| F7 `unsafe_to_relax` — haute | `tools/install.mjs:30`, install-use-case `:478-499`, `src/adapters/codex/codex-migrate-custom.mjs:18-29,58-87` : migration custom activée par défaut, peut lancer `codex exec --full-auto`; bootstrap ne relaie pas opt-out | **Déprécier le défaut implicite** / `deprecate` ; chemin explicite de secours conservé, aucun LLM lancé ici |
| F8 `validation_debt` — haute | `compatibility-policy.mjs:15-98,199-239` exige CLI PATH/auth ; ne distingue version/app seule/trust. Codex 0.146 rejette un fichier contenant mcp_tool, 0.155 le parse | **Compléter** / `replace_with_executable_test` : capacités réelles par client avant configuration |
| F9 `necessary_but_expensive` — moyenne | AGENTS fixture 9 820 octets ; workflow-step 58 831 octets stdout pour deux skills bloqués. Tokens, usage réel et gains inconnus | **Conserver, mesurer** / `requires_more_measurement` ; budget cache/fetch déjà implémenté |

Pas d'assouplissement d'invariant proposé. Chapeaux cumulables : technical owner
pour les corrections, evidence operator pour les essais, project owner pour la
décision proposée. Pas de nouvelle approbation organisationnelle. Le statu quo
conserve les pertes de config et les garanties ambiguës ; ajouter MCP seul ne les
corrige pas. Le rollback et les conditions d'escalade figurent dans le plan.

## Matrice règles, chemins, contrôles et pannes

| Règle | Chemin et contrôle | Périmètre réellement bloqué | Contournement / panne | Preuve |
|---|---|---|---|---|
| Lire les invariants avant agir | AGENTS/skills : guidance modèle | Aucun blocage outil prouvé | Instructions omises/contexte perdu | Source scaffold |
| Démarrer/reprendre proprement | SessionStart distribué : présence et contexte | Aucun | Non approuvé/désactivé/erreur : ne prétendre aucune admission ; absence assets = exit 0 | Spike direct + inventaire hooks, E2E SKIP |
| Ne pas écrire sans prérequis | pre-write-admit : refus métier AIDN | Appelant qui respecte résultat | Shell/édition indépendant ; exit 0 sans strict | Fixtures admission + spike |
| N'appliquer que transition légale | moteur transition + skill hook | Opération AIDN routée/stricte | Écriture native directe hors moteur ; origine approval non prouvée | start-session 11 cas ; close lecture statique |
| Bloquer un outil Codex couvert | futur PreToolUse local vers core, refus explicite | Invocation couverte après trust, à qualifier | write_stdin réutilise session ; outils spécialisés/hosted ; erreur hook peut continuer | Upstream/capacités ; blocage E2E SKIP |
| Bloquer via MCP | futur outil MCP admission | Appels passant dans cet outil seulement | Shell/édition hors MCP ; serveur absent/timeout/exception hooks MCP peuvent continuer | Docs/code upstream ; panne E2E SKIP |
| Préserver le client | install copy/merge actuel | Conserve AGENTS/config et noms tiers distincts | hooks tiers remplacés, skill AIDN modifié écrasé | Probe coexistence FAIL exigence |
| Réancrer depuis autorité correcte | backend + cache/bundle | AIDN peut refuser source ambiguë | Cache historique n'atteste pas contenu testé | Politique + fixtures files/db-only |
| Détecter après action | futur PostToolUse / drift-check existant | Suite du workflow, pas annulation de l'effet passé | Effet déjà produit ; preuve stale | Source ; hooks E2E SKIP |
| Refuser livraison incohérente | CI Governance Admission | Livraison via voie Git/CI configurée | Ne protège pas toute édition locale | `.github/workflows/governance-admission.yml`, ADR-0010 ; CI non exécutée ici |

Une gouvernance locale n'est pas inviolable face à un acteur autorisé à modifier
ses contrôles. Les permissions Codex, la confiance humaine et les gates restent
des frontières distinctes ; MCP ne les remplace pas.

## Exécutions et résultats

| Vérification réellement lancée | État | Portée / interprétation |
|---|---|---|
| `node tools/perf/verify-bootstrap-fixtures.mjs` | PASS, 13 checks, 6,74 s | Fixtures temp, prérequis Codex stub, pas LLM |
| `node tools/perf/verify-install-idempotence-fixtures.mjs` | PASS, 17 checks, 2,76 s | Docs/baseline/snapshot ; import volontairement désactivé = SKIP |
| `node tools/perf/verify-codex-workflow-step-fixtures.mjs --json` | PASS, 8 checks, 1,914 s wall outil | sample.ok=false : 2 admissions bloquées et cache écrit, aucune projection visible modifiée |
| `node tools/perf/verify-pre-write-admit-fixtures.mjs --json` | PASS, 17 scénarios | Ready/block/warn, files/db-only SQLite, worktree/Git/locator ; cleanup injecté négatif attendu |
| `node tools/perf/verify-start-session-admission-fixtures.mjs --json` | PASS, 11 cas | 51 processus retournés, 11 corpus nettoyés ; reprise/create/choose/stop ; pas E2E client |
| Probe coexistence, deux installs | FAIL exigence de préservation | Install exit 0 deux fois ; hooks tiers perdus, skill AIDN modifié écrasé ; AGENTS/config.toml/skill et rôle tiers conservés |
| `node docs/rfc/codex-integration-2026-09-23/spike.mjs` | Exécuté, observations ci-dessous | Harness exit 0 = collecte terminée, **pas verdict PASS global** |
| `node tools/verify/verify-doc-references.mjs` | PASS | Liens, chemins, scripts et sondes négatives, artefacts du dossier inclus |
| `node tools/verify/verify-tracked-sensitivity.mjs` | PASS | Arbre indexé du produit ; zéro violation ; sondes négatives PASS |
| `npm run perf:verify-tracked-sensitivity` | UNAVAILABLE via npm, exit 1 avant gate | Lanceur npm hôte cassé (module npm-cli.js absent) ; même gate exécuté directement par Node, sans modifier npm |
| `skills/list` via app-server 0.155 et 0.146 | PASS | 13 skills chaque, zéro erreur ; copies fixture ; pas client installé depuis tarball |
| `hooks/list`, projet non trusted / CODEX_HOME temp | Observations réelles | Projet ignoré ; hooks user temp untrusted ; aucune approbation modifiée |
| Native shell/edit hors MCP avec hooks approuvés, refus/timeout/exception, compaction, fin de tour, sous-agent | SKIP | Nécessite session client/trust humain ; protocole dans CAPABILITIES et PLAN |
| Installation pack tarball + UI Windows/IDE, Unix/macOS/WSL, PostgreSQL live, concurrence, interruption/rollback/uninstall | SKIP | Pas d'infrastructure ou de scénario autorisé/exécuté correspondant ; plan d'acceptation explicite |

Les cinq suites n'ont pas modifié le checkout selon les relevés avant/après des
agents. Les durations pré-admission/start-session n'ayant pas de chronomètre
dédié ne sont pas utilisées comme benchmark. Tous les corpus de ces suites et
du harness principal ont été nettoyés.

### Spike borné : questions et mesures

Le harness copie une fixture dans un dossier temporaire avec espaces et accent,
crée un Git local, appelle la commande du hook distribué, puis les mêmes lectures
par Node direct et les vrais entrypoints CLI. Il ne lance aucun LLM, n'approuve
aucun hook et ne modifie aucune configuration globale. Empreintes des cinq
sources critiques et détail des invocations dans `spike-results.json`.

- Témoin ASCII commandWindows : exit 0 ; chemin accentué : exit 1,
  MODULE_NOT_FOUND ; Node direct sur le même chemin : exit 0. **FAIL** portabilité
  du lanceur dans ce contexte. Première tentative 01:12:42 UTC identique, puis
  témoin ajouté pour lever l'incertitude ; résultat final conservé séparément.
- Hook direct : aucune mutation ; assets incomplets signalés dans JSON mais
  exit 0 ; JSON stdin malformé exit 1. Ce sont les comportements du programme
  hook, pas la réaction du runtime Codex à ces codes.
- Admission : `blocked`, `ok:false`, exit 0 ; `--strict` exit 1 ; aucun fichier
  modifié. Cette interface diagnostic est conservée ; adaptateur doit interpréter.
- workflow-step : deux refus, cinq steps, deux hydratations, prochaine action ;
  cache caché écrit même avec strict. Aucune exécution de skill n'est prouvée.
- Mesures finales, trois échantillons séquentiels : hook Node médiane 165,49 ms
  (162,20–173,09), 478 octets stdout ; admission 827,27 ms (818,17–827,53),
  17 305 octets ; workflow-step 884,05 ms (877,83–885,81), 58 831 octets.
- Fixture : AGENTS 9 820 octets, skill context-reload 3 781, bundle final 665.
  Bundle minime issu d'un contexte bloqué, non représentatif d'un projet actif.
  Un processus racine lancé par mesure, descendants Git/Node non instrumentés.
  Zéro appel LLM ; appels outils d'une vraie conversation et tokens non mesurés.
  Aucune promesse chiffrée d'amélioration.

Critère de sortie atteint pour le choix initial : faisabilité découverte native,
défauts d'installation et différence effets/refus démontrés ; MCP non nécessaire
au MVP. Garantie de blocage native **non établie**. Essais de panne approuvés,
inter-clients et concurrency restent des préconditions des lots correspondants.

### Reproduire le probe de coexistence

Créer un corpus temporaire avec AGENTS personnalisé, config.toml, skill/rôle tiers,
un skill AIDN modifié et hooks tiers SessionStart/Stop. Installer deux fois depuis
la source : `node tools/install.mjs --target <temp> --pack core --init-defaults
--project-name fixture --source-branch dev --skip-artifact-import
--no-codex-migrate-custom`. Stub local `codex login status` seulement pour le
prérequis install, jamais présenté comme preuve Codex. Comparer bytes et clés des
hooks à chaque étape ; vérifier chemin de nettoyage sous temp puis supprimer.
Les fichiers tiers nommés différemment restent ; hooks.json et skill AIDN sont
remplacés. Installation ≠ préservation ≠ opérationnalité.

## Limites de l'audit

Qualité suffisante pour choisir le premier lot, partielle pour la sécurité native
et le cycle de vie complet. Friction qualitative moyenne : plusieurs autorités
existantes utiles et deux dialectes Codex installés ; coût tokens inconnu. Les
risques concurrence, preuve fraîche, migration LLM et désinstallation viennent de
lecture de code, pas de scénarios de panne exécutés. Aucun gate produit raté n'a
été réparé ou assoupli. Aucune autorité acceptée, politique, source runtime,
scaffold, contrat public ou configuration de client réel n'a été réformé.
