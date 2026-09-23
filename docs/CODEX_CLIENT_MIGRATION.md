# Migration d'un client Windows vers le candidat AIDN 0.8.0

Cette procédure concerne un projet client installé, notamment depuis 0.7.2.
Le dépôt source AIDN n'est pas ce client. Les commandes sont à examiner puis
exécuter sur une cible explicitement choisie ; elles ne constituent ni une
migration réalisée ni une preuve PASS. Tant que le candidat n'est pas publié,
utiliser son tarball exact, son commit et son SHA256, pas un tag supposé
disponible ni une résolution implicite de la dernière version.
Pour un pilote existant, le remplacement du runtime attend la qualification
Windows requise et la livraison. Un candidat non publié sert à préparer et
qualifier la procédure dans un client temporaire.

## Préparer la cible et les sauvegardes

Suspendre les actions AIDN des sessions concernées et recenser les worktrees
liés. L'autorisation Git est commune au dépôt ; fichiers installés et reçus sont
propres à chaque worktree. Une installation ne prépare pas ses voisins.
Un clone indépendant n'hérite pas de l'autorisation.

Consigner localement commit et état Git du client, chemin physique du runtime
0.7.2, VERSION, empreintes et provenance npm ou lien local. Conserver cet ancien
runtime et ses dépendances à leur emplacement stable pendant la qualification.
Si npm doit remplacer son unique répertoire sous node_modules, préparer et
vérifier d'abord une récupération complète ou une installation isolée depuis
l'ancien artefact et les dépendances figées. La copie du seul dossier du paquet
ne prouve pas que ses dépendances restent résolubles. Ne pas supprimer ni
modifier la cible d'un lien local.

Créer une sauvegarde privée, hors checkout et hors synchronisation, contenant :

- package.json, package-lock.json et, s'il existe, npm-shrinkwrap.json ;
- AGENTS.md, les fichiers clients .agents et .codex avec leurs parties tierces ;
- .aidn/config.json, .aidn/project et tout le magasin privé .aidn/install ;
- runtime, sessions, cycles et historiques nécessaires au mode configuré,
  ainsi que l'autorisation Git commune si elle existe.

Les reçus et préimages peuvent contenir des données privées. Ne pas les ajouter
au dépôt ou aux preuves partagées. Sous Windows, leur confidentialité dépend
des ACL du répertoire de sauvegarde choisi.

Pour PostgreSQL, vérifier explicitement serveur, base et identité du projet avec
le profil de connexion existant. Faire une sauvegarde cohérente avec l'outil
habituel, par exemple pg_dump sous ce profil vérifié, et des observations
ciblées en transaction READ ONLY. Conserver version de schéma et contrôles
logiques adaptés au projet. Ne pas afficher URL résolue, secrets ou données
métier dans les rapports. Une sauvegarde n'est pas une migration de schéma ;
aucune adoption, aucun import ou synchronisation ne fait partie de la procédure.

## Transaction npm : sélectionner et installer le paquet

Remplacer les chemins d'exemple. Utiliser Node.js 22.13+ et le npm associé à ce
Node ; l'appel direct évite un lanceur npm.cmd éventuellement défectueux.

~~~powershell
$ErrorActionPreference = 'Stop'
$clientRoot = (Resolve-Path -LiteralPath 'C:\chemin\client').Path
$candidateTarball = (Resolve-Path -LiteralPath 'C:\artefacts\aidn-workflow-0.8.0.tgz').Path
$expectedSha256 = 'REMPLACER_PAR_LE_SHA256_DU_CANDIDAT_REVU'
$nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$npmCliPath = Join-Path (Split-Path $nodePath) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCliPath)) { throw 'Résoudre le npm CLI réel avant de poursuivre' }
if ((Get-FileHash -LiteralPath $candidateTarball -Algorithm SHA256).Hash -ine $expectedSha256) {
  throw 'Le tarball ne correspond pas au candidat revu'
}
$gitRootText = & git -C $clientRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw 'Résolution Git du client impossible' }
$gitRoot = [IO.Path]::GetFullPath(($gitRootText -join [Environment]::NewLine).Trim())
$physicalClientText = & $nodePath --input-type=module -e 'import fs from "node:fs"; console.log(fs.realpathSync.native(process.argv[1]));' $clientRoot
if ($LASTEXITCODE -ne 0) { throw 'Résolution physique du client impossible' }
$physicalClient = [IO.Path]::GetFullPath(($physicalClientText -join [Environment]::NewLine).Trim())
if (-not [string]::Equals([IO.Path]::GetFullPath($clientRoot), $physicalClient, [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals($gitRoot, $physicalClient, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Choisir la racine Git physique du worktree, sans sous-dossier ni redirection'
}
& git -C $clientRoot rev-parse --absolute-git-dir --git-common-dir
if ($LASTEXITCODE -ne 0) { throw 'Résolution Git commune impossible' }
& git -C $clientRoot worktree list --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Inventaire des worktrees impossible' }
Push-Location $clientRoot
try {
  & $nodePath $npmCliPath install --save-dev --save-exact --ignore-scripts --no-audit --no-fund $candidateTarball
  if ($LASTEXITCODE -ne 0) { throw 'Installation npm échouée : inspecter avant bootstrap' }
} finally { Pop-Location }
$installedRoot = Join-Path $clientRoot 'node_modules/aidn-workflow'
$installedBin = Join-Path $installedRoot 'bin/aidn.mjs'
if ((Get-Content -LiteralPath (Join-Path $installedRoot 'VERSION') -Raw).Trim() -ne '0.8.0') {
  throw 'Version du paquet installé inattendue'
}
~~~

Cette première transaction peut modifier manifeste, lockfile, node_modules et
cache npm, et télécharger des dépendances. Elle n'exécute pas le bootstrap
d'assets AIDN. Examiner son diff et conserver l'artefact référencé par le
lockfile. Un tarball local est une provenance de qualification ; sa distribution
durable sera choisie explicitement lors de la livraison.

Les hooks existants peuvent alors constater un ancien binding invalide.
Ne pas reprendre le workflow avant la seconde transaction. Le bootstrap du
nouveau paquet reste disponible pour établir son propre plan.

## Transaction AIDN : preview puis application du même plan

Choisir le profil conforme à l'installation existante : default pour core,
db-only pour un client déjà dans ce mode, full pour un client qui possède
volontairement extended. Le profil postgres demande en plus une référence de
connexion explicite. Ne pas changer mode ou backend pour faire passer la
migration. Si une option supplémentaire est nécessaire, l'ajouter au tableau
commun utilisé pour le preview et l'application.

~~~powershell
$aidnProfile = 'default'
$commonArgs = @('bootstrap', '--target', $clientRoot, '--mode', 'upgrade',
  '--profile', $aidnProfile, '--persistence-policy', 'verify-only',
  '--no-codex-migrate-custom', '--json')
$previewText = & $nodePath $installedBin @commonArgs --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Preview refusé : aucun bootstrap à appliquer' }
$preview = ($previewText -join [Environment]::NewLine) | ConvertFrom-Json
if (-not $preview.ok -or -not $preview.installation_plan.plan_id) { throw 'Plan absent ou en conflit' }
$preview | ConvertTo-Json -Depth 20
~~~

Examiner opérations, conflits, objets tiers conservés, branche source, mode,
backend et effets déclarés. Conserver le JSON complet localement. Le preview
ne crée pas d'autorisation, ne modifie pas le checkout et ne contacte pas
PostgreSQL ; il ne prouve donc pas la disponibilité du backend.

Après examen, appliquer avec les mêmes arguments :

~~~powershell
& $nodePath $installedBin @commonArgs --expect-plan $preview.installation_plan.plan_id
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap non terminé : conserver ses preuves de récupération' }
& $nodePath $installedBin bootstrap --target $clientRoot --diagnose --scope installation --json
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic à examiner avant reprise du workflow' }
~~~

Le bootstrap nominal exprime l'intention d'installation : il n'accepte pas
--write. Les actions de récupération utilisent --write et --expect-plan.
--json ne confère jamais une intention d'écriture.

Pour PostgreSQL, verify-only vérifie que le backend existant ne requiert aucune
adoption avant les écritures, puis recontrôle cette condition à la finalisation.
Une base indisponible ou incompatible bloque sans migration ni import ; ne pas
remplacer la politique par adopt pour contourner ce refus. Pour SQLite, la
politique saute import et migration de schéma sans ouvrir la base : elle ne
prouve ni sa disponibilité ni son intégrité, à vérifier séparément en lecture
seule selon le client. Aucun appel LLM n'est requis.

La réussite doit établir la version produit 0.8.0, le schéma de configuration 1,
le marker install.aidnVersion, son reçu et le binding au nouveau paquet.
Vérifier aussi les objets clients et les observations PostgreSQL pertinentes.
La version seule n'est ni une preuve d'intégrité des assets ni une approbation
native Codex.

## Autorisation, reprise et retour arrière

Une installation nominale initiale ou une migration legacy explicite peut créer
l'autorisation absente. Une autorisation révoquée reste révoquée après install,
repair ou rollback. Les opérations suivantes s'appliquent à l'autorité commune
des worktrees et restent en scope codex-integration :

~~~powershell
& $nodePath $installedBin bootstrap --target $clientRoot --revoke --json
# Après examen, remplacer PLAN_ID par l'identifiant retourné.
& $nodePath $installedBin bootstrap --target $clientRoot --revoke --write --expect-plan PLAN_ID --json
& $nodePath $installedBin bootstrap --target $clientRoot --authorize --json
& $nodePath $installedBin bootstrap --target $clientRoot --authorize --write --expect-plan PLAN_ID --json
~~~

Ce sont des alternatives explicites, pas une séquence à exécuter en bloc.
Révoquer reste possible pendant une installation interrompue et conserve son
journal. La reprise d'un ancien grant refuse d'écraser une révocation plus
récente. Ne jamais supprimer l'autorisation commune pour tenter de revenir au
mode legacy.

Pour une transaction complète interrompue, utiliser --resume --scope
installation en preview, puis la même action avec --write --expect-plan.
Pour une transaction Codex seule, conserver le scope par défaut. Le journal
retient le paquet et l'intention de persistance de la tentative : vérifier ces
valeurs avant reprise, au lieu d'espérer les remplacer par de nouveaux flags.

Un rollback d'assets n'annule ni npm ni les opérations de base de données.
Le retour vers un reçu legacy non vide est refusé avec
ROLLBACK_TO_LEGACY_ACTIVATION_REQUIRES_UNINSTALL : ses anciens hooks pourraient
ignorer une révocation. Examiner une désinstallation explicite puis une
installation compatible avec l'activation. La conservation de 0.7.2 sert à la
récupération et à la comparaison ; elle n'autorise pas sa réactivation implicite.
Le rollback d'une première installation sans reçu antérieur reste possible.
Les deux transactions se récupèrent séparément, avec leurs preuves respectives.

## Skills et qualification après migration

Vérifier les treize identités publiques aidn-*, sans doublons des anciens
entrypoints gérés. Les identifiants CLI internes restent compatibles, par
exemple --skill context-reload. Les homonymes personnalisés restent préservés
ou produisent un conflit explicite.

La désactivation des skills globaux est une opération distincte, sur un
--codex-home absolu choisi explicitement, via --migrate-global-skills en preview
puis --write --expect-plan. Seuls les contenus AIDN historiques exacts sont
sélectionnés automatiquement ; les fichiers de skills restent présents.
La restauration utilise --restore-global-skills et exige le postimage TOML
enregistré. Consulter les [commandes et limites](CODEX_INTEGRATION.md#project-activation-and-skill-names).
Ne pas inclure cette opération globale dans le bootstrap nominal.

Redémarrer le client natif après une modification de sa configuration de skills.
Découverte, autorisation AIDN, approbation native et exécution réelle des hooks
sont des preuves distinctes. Suivre le [protocole natif](CODEX_NATIVE_QUALIFICATION.md)
sur un client temporaire avant toute revendication d'exécution native.
Cette procédure Windows n'établit aucune preuve Unix, WSL ou cloud.
