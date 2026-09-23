# Plan et backlog — installation fiable AIDN × Codex

Statut : proposé, prêt pour décision de lancement ; **lots produit non commencés**.
Date : 2026-09-23. [Audit](AUDIT.md) · [Capacités](CAPABILITIES.md) ·
[ADR proposée](ADR-PROPOSED.md).

Ce plan est un backlog local de chantier, pas une autorité concurrente au core,
aux politiques ni au catalogue des gates. Pas d'issue/PR créée ou publiée.

## Frontière produit

Tous les lots modifient le **produit AIDN**, ses installateurs et ses assets source.
Le parcours utilisateur spécifie le résultat attendu dans une future cible cliente ;
il ne transforme jamais ce dépôt source en client AIDN. Tests sur copies temporaires,
scaffold et fixtures clairement étiquetés ; aucune installation à la racine.

## MVP et séquence

MVP : installer/mettre à jour par bootstrap en préservant la configuration du
projet, expliquer les validations humaines, détecter les skills/rôles/hooks réels,
reprendre un contexte compact et conserver les refus métier AIDN. Un contrôle
natif annoncé n'est activé comme garantie qu'après preuve sur le client ciblé.
Pas de MCP, plugin, daemon, PostgreSQL ou clé LLM supplémentaire requis.

Ordre recommandé : **L1a → L1b et L3 → L4**. L2 reste conditionnel ; plugin/runner
ultérieurs. La conservation des hooks est une valeur autonome qui ne dépend pas
de la preuve d'interception native. La partie lifecycle de L3 ne retarde pas ce
correctif. La preuve fraîche et la concurrence précèdent tout MCP mutatif.

## Tests d'acceptation définis avant les lots

Les suites existantes sont sélectionnées par l'intention de `docs/TESTING.md`.
Chaque scénario capture arbre/empreintes avant/après, source SHA, versions et
codes retour. Un PASS fixture ne devient jamais un PASS UI/client réel.

| ID | Scénario / oracle observable | État dans cette session | Preuve nécessaire pour livraison |
|---|---|---|---|
| T01 | Installation vierge puis upgrade ; versions/assets exacts, prérequis honnêtes | PASS fixtures bootstrap | Client isolé installé depuis tarball ; pas de téléchargement flottant ni LLM implicite |
| T02 | Deuxième install sans doublons ni modifications injustifiées | PASS idempotence existante ; FAIL conservation tiers au premier install | Hashes stables + un seul handler AIDN par identité/version |
| T03 | AGENTS personnalisé, hooks/MCP/config/skills/rôles tiers et assets AIDN modifiés | AGENTS/config/noms tiers conservés ; hooks tiers perdus ; skill AIDN écrasé | Corpus adversarial : fusion ciblée, conflit sans perte, aucun global write |
| T04 | Nouvelle conversation, start/resume/clear, compaction supportée | Skills/list PASS ; hook lancé directement ; lifecycle natif SKIP | Traces du client approuvé, contexte compact correct et aucune transition implicite |
| T05 | Transition sans prérequis refusée ; preuve valide acceptée | PASS pre-write/start-session ; clôture statique | Moteur transition + contrat positif/négatif ; preuve liée au contenu, pas booléen libre |
| T06 | Édition et shell natifs hors MCP, puis write_stdin | SKIP natif | Marqueur innocent absent sur refus couvert ; contournement/périmètre résiduel explicites |
| T07 | Serveur absent, hook untrusted/disabled, timeout, exception, JSON invalide | Trust exclusion et incompatibilité parse démontrées ; exécution pannes SKIP | Matrice runtime explicite ; aucune panne assimilée à refus natif |
| T08 | Doubles appels, hooks concurrents, changement branche/worktree/contenu, admission périmée | Identité/conditions Git PASS fixture ; course/CAS SKIP | Revalidation, conflit déterministe, une seule mutation autorisée |
| T09 | Interruption à chaque étape install, repair, rollback, uninstall | SKIP ; atomicité par fichier seulement lue | Reprise sans double effet ; post-image divergente préservée ; historique intact |
| T10 | Windows natif + Unix ; espaces/accents et sous-dossier ; WSL séparé | Windows install PASS ; lanceur accent FAIL ; Unix/macOS/WSL SKIP | Smoke natif Windows et au moins Linux/macOS ; aucune extrapolation WSL |
| T11 | CLI/JSON/effets et files/dual/db-only | PASS ciblés files/db-only SQLite ; parité complète non exécutée | Suites pertinentes modes/contrats ; PostgreSQL live séparé si concerné |
| T12 | Distinction scaffold/fixture/tarball/UI/pilot | Respectée dans résultats | Étiquette obligatoire par preuve ; aucun projet client réel nécessaire au nominal |

Sans LLM : T01–03, partie moteur T05/T08/T09/T11, schémas/discovery T04/T07,
smokes install T10. Avec vraie session Codex et validations humaines : exécution
native T04/T06/T07, sous-agents et compaction, aspects runtime T08/T10. Un faux
serveur/test double peut vérifier l'adaptateur ; il ne prouve pas le client.

Suites à réutiliser selon diff, sans lancer toute CI maintenant :
`perf:verify-bootstrap`, `perf:verify-install-import`, `perf:verify-project-config`,
`perf:verify-install-idempotence`, `perf:verify-codex-client-install`,
`perf:verify-codex-client-discovery`, `perf:verify-pre-write-admit`,
`perf:verify-start-session-admission`, `perf:verify-codex-workflow-step`,
`perf:verify-cli-effect-policy`, `perf:verify-cli-no-implicit-write`,
`perf:verify-cli-output-contracts`, `perf:verify-cli-surface-inventory`,
`perf:verify-state-mode-parity`, `perf:verify-doc-references`.
Vérifier noms/parseurs au SHA de réalisation. En PR ASSURED, le resolver sélectionne
les obligations requises du catalogue ; les tests locaux ciblés ne s'y substituent
pas. PostgreSQL manuel se rapporte séparément PASS/SKIP/UNAVAILABLE.

## Lots et backlog exécutable

Chaque lot produit suit ASSURED, revue sur diff réel et branche dédiée issue de
dev actualisée explicitement au lancement. Effort relatif S/M/L, pas estimation
calendaire. DoR commune : besoin autorisé, source et client ciblés figés, panne
reproductible, pas de config globale, contrats/effets identifiés. DoD commune :
oracles ci-dessus, docs/politiques/contrats/fixtures alignés, gates routés PASS,
SKIP séparés, rollback testé et aucune promesse au-delà du périmètre couvert.

### L0 — audit, spike et proposition (réalisé dans cette session)

- Objectif : choisir une architecture fondée sur l'existant et isoler les écarts.
- Existant : core/CLI/install/tests. Nouveau : ce dossier RFC et harness éphémère.
- DoR : demande présente, base propre, gouvernance lue. DoD : diagnostic sourcé,
  versions identifiées, résultats et limites, ADR proposée, backlog/priorités.
- Résultat : choix A recommandé, L2 différé ; T07 natif/Unix restent SKIP avec
  protocole. Aucun verdict de merge-readiness. Rollback : retirer uniquement
  le dossier de proposition et son lien d'index.

### L1a — préserver l'installation Codex (première PR recommandée, M)

Objectif : une installation AIDN ne supprime plus les hooks tiers et ne masque pas
les conflits sur ses assets ; traiter le lanceur Unicode dans ce même périmètre
si le correctif reste borné, sinon L1b sans retarder la protection des données.

- Backlog **CX-01** : fusion structurée par identité AIDN, ordre/événements/champs
  tiers conservés, suppression d'ancienne entrée AIDN seulement si reconnue.
- **CX-02** : conflits pour assets AIDN personnalisés ; décision explicite avant
  remplacement ; AGENTS client conservé, mise à jour de son bloc géré séparée.
- **CX-02b** : rendre la migration LLM custom explicitement opt-in dès ce lot,
  relayer le choix via bootstrap, conserver le chemin de secours documenté.
  Tester absence de lancement Codex/LLM dans le parcours nominal.
- Modules existants : bootstrap/install et adaptateur de migration, manifests core/codex-integration,
  `src/application/install/{install-use-case,install-ownership-policy,template-copy-service,template-merge-service}.mjs`,
  `scaffold/codex_hooks/*`, fixtures install/bootstrap. Nouvelles données minimales
  d'ownership si nécessaires ; pas d'installateur neuf.
- Dépendances : L0 ; aucune MCP. DoR spécifique : transformer probe T03 en test
  qui échoue avant correction ; format hooks cible réellement parsable.
- DoD : T01–03 verts, preview sans mutation, deux installations sans doublon,
  préservation vérifiée byte-for-byte hors objets gérés ; diagnostic conflit
  observable. Docs INSTALL/UPGRADE et contrats bootstrap si sortie évolue.
- Risques : confusion d'identité ancien hook/tiers, double copie pack core,
  écrasement custom. Stop si ownership incertain ; pas de déduction par substring.
- Rollback L1a borné : sauvegarder les seules pré-images des fichiers/objets
  touchés et leur empreinte post-écriture dans la preuve locale du lot ; reprise
  manuelle assistée avec comparaison avant restauration. Si modification ultérieure,
  conserver et signaler conflit. Revert du code séparé. Le registre durable et
  la reprise automatique transactionnelle complète restent en CX-09.
- Valeur autonome : sécurité de mise à jour ; **ne garantit pas** blocage natif.

### L1b — reprise et contrôles natifs qualifiés (M–L)

- **CX-03** : lanceur Windows espaces/accents/sous-dossier, diagnostic précis ;
  réutiliser root resolver, éviter divergence PowerShell/codepage.
- **CX-04** : distinguer installé/détecté/approuvé/opérationnel et capacité par
  client ; app présente sans CLI PATH n'est pas erreur opaque.
- **CX-05** : état compact de reprise via use-case/budget/fetch existants ; corriger
  cache/canonique et modèle de rôles non vérifié ; pas de deuxième état.
- **CX-06** : wrapper d'admission local read-only, mapping tool→scope/action
  déclaré. Traduction explicite de refus ; erreurs/codes 1 ne valent pas deny.
- **CX-06b** : rattacher les validations aux contenus/contextes réellement testés
  et revalider avant transition ; couverture au core même si L2 reste reporté.
- Modules : `scaffold/{root,codex,codex_agents,codex_hooks}`, use-cases/adapters
  Codex, pre-write-admit, discovery verifier, contrats pertinents, docs CLI/INSTALL.
- Dépendances : fusion sûre L1a pour distribuer ; préparation tests E2E en parallèle.
- DoR : version/support précis, humain disponible pour trust du corpus ; définir
  actions réellement couvertes, aucune tentative d'inférer toute sémantique shell.
- DoD : T04–07, T10 ; traces source/input/refus/cible intacte ; diagnostic dégradé
  en absence de hook ; aucun « toutes écritures bloquées ». Reprise ne transforme
  pas THINKING en mutation. Modifier contrat si effet nouveau, jamais via --json.
- Risques : fail-open client, récursion, taille contexte, lancement lent, outils
  spécialisés. Effort M hors E2E multi-client, L avec ces preuves.
- Rollback : désactiver uniquement hook AIDN via configuration projet contrôlée,
  conserver skills/core et preuves ; retour au parcours manuel annoncé dégradé.

### L2 — MCP minimal (reporté ; S pour décision, M pour lecture, L mutatif)

- **CX-07**, statut conditionnel : comparer mêmes scénarios avec CLI et enveloppe
  MCP temporaire ; bénéfice structuré/latence/outils doit être observable. Pas de
  pourcentage cible arbitraire. Si aucun gain, clôturer comme report motivé.
- Contrat candidat dans ADR proposée ; ne pas publier run-json-hook ou toute
  fonction interne. Uniquement accès au core existant, aucun journal parallèle.
- Modules potentiels nouveaux : adaptateur MCP et tests protocole ; existants :
  use-cases, contrats, registry/policy quand nouvelle surface publique, bootstrap.
- DoR : L1 stable, seuil de décision convenu, compatibilité clients connue,
  concurrence/idempotence/fraîcheur définies pour toute mutation.
- DoD : T05–08/T11, contrat versionné, stdout/logs séparés, cible/worktree verrouillés
  par contexte ; diagnostic absent/timeout clair, usage hors MCP explicitement libre.
- Risques : readiness, double effets, fichier hooks incompatible 0.146, extension
  d'autorité. Rollback : retirer config MCP gérée, garder A et état AIDN intact.

### L3 — bootstrap et cycle de vie unifiés (L, deux valeurs livrables)

- **CX-08** (M) : détection capacités/version et preview de changements/conflits ;
  unifier le parcours déjà rendu sans migration LLM implicite par CX-02b. Garder
  migration custom explicite de secours ; flags nouveaux à confronter au registre.
- **CX-09** (L) : propriété pré/post-images, transaction/reprise install,
  diagnostic non mutatif, repair sur diff, rollback conditionnel, désinstallation
  conservant artefacts/historique. Étendre services install, pas runtime DB parallèle.
- Dépendances : ownership L1a ; indépendant du transport L2. Travaux UX/tests
  préalables parallélisables à L1b ; modifications install sérialisées avec L1a.
- Modules : bootstrap/install/config/ownership, contrats bootstrap, manifests,
  fixtures, INSTALL/UPGRADE/TROUBLESHOOTING, CLI inventory/policy et information
  governance si nouvel enregistrement installé devient concept gouverné.
- DoR : UX ci-dessous validée, schéma propriété/rétention choisi, scénarios
  interruption définis, aucun flag supposé disponible.
- DoD : T01–03/T07/T09–11 ; `diagnostic` et preview inchangés byte-for-byte ;
  repair exige intention et pré-images correspondantes ; upgrade applique version
  verrouillée, pas de restart prescrit sans nécessité constatée.
- Risques : legacy ownership incomplet, transaction partielle, utilisateurs
  modifiant fichiers après preview, double classique/plugin.
- Rollback : transactions reconnues uniquement, CAS pré/post, quarantaine limitée
  et récupérable des objets gérés ; refuser restauration si divergence.

### L4 — qualification et livraison documentée (M)

- **CX-10** : compléter T01–12 sur Windows CLI/GUI/IDE et au moins un Unix ;
  cloud/WSL restent des lignes indépendantes ; panne et concurrency prioritaires.
- **CX-11** : benchmark reproductible et preuves de livraison, manuel d'approbation
  et récupération. Aucun nouveau framework global de tests.
- Modules existants : `tools/verify`, `tools/perf`, fixtures, guide TESTING,
  catalogue gates et CI seulement si besoin démontré, docs d'installation.
- DoR : diff produit stable, clients figés, protocole + instrumentation prêts.
- DoD : matrice de support publiée à son niveau de preuve, critères T01–12
  pertinents verts, required preconditions indisponibles = diagnostic d'échec,
  optional SKIP séparés, obligations ASSURED exactes une fois par famille.
- Risques : fausse équivalence fixture/UI, latence alpha variable, preuve stale.
  Rollback : geler livraison sur preuve manquante, revert borné de lot défectueux ;
  ne pas affaiblir un gate pour faire passer l'environnement.

### Options ultérieures

**CX-12 plugin** : seulement packaging de mêmes assets, verrouillage version,
identité unique classique/plugin, confiance humaine. **CX-13 runner** : session
explicitement déléguée, pas contrôle du chat existant. Effort M/L, DoR = besoin
mesuré non satisfait par MVP ; DoD = installation/pannes/cycle séparés démontrés.
Rollback = désinstallation conditionnelle du transport/paquet, moteur intact.

## Réemploi des backlogs

| Liens existants | Suite de chantier, sans rouvrir artificiellement l'existant |
|---|---|
| `docs/BACKLOG_DETERMINISTIC_PROJECT_FILE_GENERATION_2026-03-11.md`, DPG-01/16/21 | CX-01/02/08/09 : étendre ownership/idempotence, qualifier migration explicite |
| `docs/BACKLOG_AIDN_USAGE_REMEDIATION_2026-05-17.md`, AUR-3 | Garder init non interactif ; CX-08 le raccorde au diagnostic |
| `docs/BACKLOG_AGENTS_RUNTIME_REFOCUS_2026-03-10.md`, ARF-04 | Garder détection AGENTS.override ; CX-04/05 clarifient priorité découverte |
| `docs/BACKLOG_WORKFLOW_CONTEXT_RESILIENCE_2026-03-09.md`, WCR-01..10 | Assets/reanchor/no-plan-no-write existants ; CX-05/06 vérifient raccord natif |
| `docs/BACKLOG_START_SESSION_GATE_RESTORATION_2026-03-10.md`, SSGR-03..15 | Réutiliser admission resume/choose/create/stop et fixtures T04/05 |
| `docs/BACKLOG_WORKFLOW_TRANSITION_ENGINE_2026-03-22.md`, WTE-02/03/05/06/08 | Même moteur et contrats pour CX-06/07 ; pas de nouvelle machine d'états |
| `docs/BACKLOG_AIDN_DB_ONLY_STRICT_CONTEXT_BUNDLE_2026-06-01.md`, P1-01..04 | Budget/fetch/contrats/skills existants ; CX-05/11 instrumentent leur usage réel |
| `docs/BACKLOG_SUBAGENT_PLUGIN_OBSERVABILITY_2026-03-16.md`, SPO-02/06/07 pending | Hooks AIDN de dispatch distincts de hooks natifs/plugin Codex ; aucun doublon créé |

## Spécification du parcours installation/migration/reprise

Les libellés diagnostic/réparation/désinstallation ci-dessous sont des étapes
UX proposées, **pas des commandes ou flags déjà disponibles**. Entrée maintenue :
`aidn bootstrap`. Aujourd'hui `--dry-run --json` preview ; bootstrap/install sans
preview sont mutatifs par intention de commande. Ne pas imposer fictivement
`--write` à leur parseur actuel ; suivre effet par invocation et contrat cible.

1. **Détecter** : racine Git/worktree depuis cwd ou cible explicite, plateforme,
   Node/Git/AIDN, package/lock/source, CLI PATH et app/extension présentes séparément.
   Interroger version/schéma/discovery sans secret. Binaire absent du PATH mais
   app présente : expliquer le mode supporté ou un prérequis précis ; aucun login
   opaque imposé pour une simple copie locale déterministe.
2. **Prévisualiser** : actifs sélectionnés, version verrouillée, propriétaire,
   empreinte existante, diff ciblé, conflit et autorisations nécessaires. Zéro
   création de cache/runtime/config sur cible ; diagnostic non mutatif aussi.
3. **Appliquer** avec intention prévue par commande : périmètre projet par défaut.
   Préserver AGENTS hors bloc, skills/rôles tiers, hooks et paramètres MCP tiers,
   tables TOML et ordre requis. Conflit ambigu = arrêt avant remplacement. Pas de
   chmod/trust/global config caché, pas d'authentification ou appel LLM implicite.
4. **Tracer propriété** : package/source/version, objets gérés, pré/post-images,
   transaction et issue ; étendre modèle install existant. Fichier/bloc/hook
   modifié par utilisateur ne devient pas possédé par ressemblance de texte.
   Rétention locale, chemins neutres et redaction ; aucune base parallèle.
5. **Valider confiance humaine** : indiquer dans le client concerné ce qui doit
   être revu (projet et définition hook), pourquoi, et portée. AIDN n'écrit jamais
   trusted=true, hash approuvé ou désactivation sandbox. Changements de définition
   peuvent exiger nouvelle revue. Reload/restart seulement selon capacité testée.
6. **Vérifier opérationnalité** : noms attendus découverts, rôle compatible,
   hook réellement exécuté et réponse valide dans corpus ; MCP connecté seulement
   si installé. Étape contrôlée et non présentée comme simple diagnostic read-only.
7. **Mettre à jour/réparer** : même entrée, mêmes diff/propriété/intention. Interrompu :
   reconnaître étape appliquée par post-image, continuer sans répéter effet ; si
   divergence, montrer conflit. Version exécutable résolue localement et fixée,
   jamais `npx ...@latest` ou téléchargement implicite à chaque session.
8. **Rollback/désinstaller** : uniquement objets AIDN encore reconnus. Comparer
   post-image attendue avant restauration de pré-image ; conserver changements
   ultérieurs, AGENTS client, historique sessions/cycles/preuves et configurations
   voisines. État manquant/ambigu ne justifie jamais restauration aveugle.

Diagnostic à six états indépendants : **installé** (empreintes assets), **détecté**
(client liste), **approuvé** (source native vérifiable, sinon inconnu), **connecté**
(transport, N/A sans MCP), **opérationnel** (preuve réelle fraîche et limitée),
**dégradé** (raison et prochaine action). Un booléen success d'install ne remplit
pas les cinq autres. Ne pas exposer secrets, noms de projets privés ou détails MCP
au-delà de ce qui aide la décision de l'utilisateur.

À la reprise : lire backend canonique du scope sélectionné, état/révision, anomalies,
prochaine action, scope autorisé, preuves manquantes. Cache borné, fetch ciblé
existant. Recalcul après changement de branche/worktree/contenu/règles et avant
transition ; pas de réutilisation d'autorisation ancienne. Modes files/dual/db-only
conservés, partage explicite, aucun backend partagé imposé au multi-agent.

## Mesure et contrôle de concurrence

Baseline actuelle dans AUDIT et JSON : distinguer octets fichier/cache/stdout,
processus racines mesurés, descendants inconnus, zéro appel LLM et temps direct
CLI. Futur protocole : mêmes scénarios fixture et client, versions/CPU/chauffe,
échantillons répétés (froids et chauds), médiane et dispersion ; nombre d'outils,
processus et contenu chargé instrumentés. Tokens seulement si tokenizer/usage
approprié réellement disponible. La découverte skills n'est pas temps de reprise.

Identifier chaque résultat de validation par scope, contenu testé (HEAD + dirty
pertinent), policy, commande/env, exit/signal, artefacts et origine approval.
Aucune autorité fondée sur booléen modèle ou ancien PASS. Écriture de contexte
atomique et concurrence à tester ; idempotence des transitions au core, pas dans
un journal MCP. Admission + écriture native séparées gardent un risque TOCTOU à
annoncer, même avec digest. Les doubles hooks ne doivent pas doubler les effets.

## Capsule de reprise

- Base audit figée `cb18abbd01691fb632cc5889882aa01f6efd8d93`; branche locale
  `codex/codex-integration-audit-spike`. Aucun push/PR ni lot produit réalisé.
- Décision **proposée** : A, autorité unique core/use-cases ; MCP différé,
  plugin/runner optionnels ; installer d'abord sans perte de configuration.
- Démontré : cinq suites fixture PASS ; 13 skills détectés deux binaires ; hooks
  projet exclus sans trust ; mcp_tool incompatible 0.146 ; pertes hooks tiers et
  lanceur Unicode reproduits ; refus AIDN != exit nonzero sans strict.
- Hypothèses : gain MCP, race contexte, latence conversation, preuve native en
  panne, compatibilité UI/modèles rôles/Unix restent à mesurer ; ne pas les déclarer
  établis. Migration LLM implicite lue dans source, jamais exécutée ici.
- Confiance : aucun changement de trust/global config/sandbox. Les validations
  humaines restent dans le client et doivent porter origine/scope vérifiables.
- Prochaine action, après autorisation du lot produit : **L1a/CX-01**, transformer
  le probe perte hooks en fixture régressive puis corriger fusion/ownership dans
  les services install existants. Ne pas commencer par un serveur MCP.
- Terminé quand installation/upgrade/reinstall/preview préservent les objets tiers,
  signalent conflit sans perte, et passent tests/gates routés ; ce lot n'affirme
  aucun blocage universel des écritures Codex.
