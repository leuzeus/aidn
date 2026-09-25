# Installation complète d'un projet sous Windows

`scripts/setup-project.ps1` orchestre le paquet AIDN, les skills et hooks Codex,
et une persistance PostgreSQL facultative. Il réutilise le bootstrap et son plan
d'installation ; les règles du workflow et les migrations restent dans AIDN.
La version 0.9.0 fournit le setup commun et les mises à jour par projet.

## Setup utilisateur et plusieurs projets

Depuis le dépôt source ou le paquet extrait, préparer puis installer le setup commun :

```powershell
.\scripts\setup-project.ps1 -InstallSetup
.\scripts\setup-project.ps1 -InstallSetup -Write
```

L'application installe une copie autonome du paquet et de ses dépendances dans
`%LOCALAPPDATA%\AIDN\setup`, définit `AIDN_HOME` et ajoute son sous-dossier `bin`
au PATH utilisateur. Un `AIDN_HOME` absolu déjà défini est conservé. Node.js/npm
restent des prérequis. Relancer le terminal pour hériter des variables, puis :

```powershell
aidn-setup
```

Le menu permet d'ajouter un projet, sélectionner ou mémoriser une installation,
consulter ses versions, la mettre à jour ou retirer une entrée de la liste.
Le script source sans arguments ou avec `-Wizard` ouvre le même menu.
La version du setup est indépendante des versions de chaque projet. Réinstaller
le setup depuis un paquet plus récent ne met aucun projet à jour. Le pointeur
vers le setup actif n'est remplacé qu'après préparation de sa nouvelle copie.
Les anciennes copies sont conservées ; aucun nettoyage automatique n'est effectué.

`%AIDN_HOME%\projects.json` contient uniquement le schéma, l'identifiant, le nom,
le chemin absolu et la dernière utilisation réussie de chaque entrée. Il ne
contient ni version ni secret. Une installation/mise à jour réussie mémorise le
projet ; mémoriser une installation existante et retirer une entrée exigent un
choix explicite. Consultation et annulation ne changent pas le registre.
Les écritures utilisent un verrou exclusif et un remplacement atomique.
Un registre invalide est refusé sans écrasement. Un verrou occupé impose de
réessayer ; après interruption, vérifier l'absence d'autre setup actif avant
de retirer manuellement le seul verrou concerné. Un chemin déplacé se remplace
explicitement en retirant l'ancienne entrée puis en mémorisant le nouveau chemin.
Retirer une entrée ne supprime jamais le projet ou sa base.

Chaque projet conserve son paquet npm verrouillé, sa configuration `.aidn`,
ses skills/hooks et ses reçus locaux. Le registre n'est pas une autorité sur
leur état. PostgreSQL peut être un serveur commun, avec base et rôle dédiés
par projet. Le mode serveur existant attend ces ressources déjà provisionnées.

## Consultation et mise à jour

```powershell
aidn-setup -Target 'C:\work\client' -CheckUpdate
aidn-setup -Target 'C:\work\client' -Update -ReleaseVersion latest
aidn-setup -Target 'C:\work\client' -Update -ReleaseVersion latest -Write
```

`-CheckUpdate` consulte la dernière release stable GitHub par défaut. Le setup
croise le paquet local, le marqueur de réussite et le reçu. Un simple AGENTS.md
ne constitue pas une installation. Versions inconnues, désaccords et transactions
interrompues demandent un diagnostic/reprise avant mise à jour.
La consultation ne télécharge pas le paquet et ne modifie ni projet ni registre.
Une erreur réseau ou une release incomplète n'est jamais présentée comme « à jour ».

`latest` désigne la dernière release stable choisie par GitHub. Le wizard fige
sa version exacte avant confirmation. Les commandes scriptées séparées résolvent
chacune latest : utiliser une version exacte pour conserver le choix entre deux
invocations. Les versions identiques ou plus anciennes n'entraînent aucune écriture.
Le candidat local s'utilise avec `-Update -PackagePath ... -PackageSha256 ...` ;
comme pour l'installation locale, il doit avoir la même version que le setup.

La mise à jour prépare le candidat hors du projet, vérifie son intégrité et
utilise les services d'installation du bootstrap avec les paramètres enregistrés,
la configuration actuelle et `verify-only`. Pack, règles, métadonnées, mode et
référence de connexion sont conservés. Les paramètres d'installation ne peuvent
pas servir de changement de configuration pendant update.
Le serveur PostgreSQL n'est pas réinstallé et aucun import de données n'est demandé.
Les migrations SQLite/PostgreSQL nécessaires bloquent avant remplacement du paquet
du projet : traiter la migration séparément puis relancer. Un backend indisponible
est également bloquant. Seule la variable de connexion du projet sélectionné est
transmise au processus de vérification ; les autres variables AIDN_* sont retirées
de son environnement. Les paramètres de connexion des autres projets ne sont pas consultés.

Le candidat doit supporter le protocole interne de vérification du setup ; les
anciens paquets qui n'en disposent pas sont refusés pour update. La version de
réussite n'est enregistrée qu'à la fin. Si npm a déjà remplacé le paquet avant
un échec ultérieur, le diagnostic expose ce désaccord ; suivre la reprise de
l'installation plutôt que forcer une nouvelle mise à jour. Si seule l'écriture
du registre échoue après réussite, mémoriser ensuite le projet depuis le menu.

## Prérequis et choix

- Windows, PowerShell 5.1 ou supérieur, Node.js 22.13+ avec son npm, et Git.
- Un dépôt Git client existant, distinct du dépôt source AIDN.
- Une release GitHub publiée avec tarball, manifeste et checksums, sélectionnée
  par version exacte, ou un tarball local de la même version que le script avec
  son SHA-256 vérifié. Le setup commun est disponible à partir de la release 0.9.0.
- Pour installer le serveur : WinGet et une version précise de PostgreSQL 17.
  L'installation officielle reste interactive pour les options du serveur,
  les accords et l'élévation Windows. Node.js et WinGet ne sont pas installés
  automatiquement par ce script.

| PostgresMode | Effet après `-Write` |
| --- | --- |
| `none` | Installe AIDN et les hooks avec le profil default, sans préparer de serveur PostgreSQL. |
| `existing` | Vérifie une base et un rôle dédiés déjà disponibles, puis configure AIDN avec le profil postgres. Aucun installateur système ni CREATE ROLE/DATABASE. |
| `install` | Lance l'installateur PostgreSQL 17 via WinGet, prépare une base et un rôle dédiés sur le serveur local, puis configure AIDN avec le profil postgres. |

Le profil postgres prépare la persistance canonique PostgreSQL ; il ne configure
pas automatiquement la coordination partagée et ne force pas le mode db-only.
L'application peut créer/migrer le schéma AIDN et importer l'état du projet par
le bootstrap existant. Sur un projet déjà installé, examiner et sauvegarder son
état avant cette adoption ; ce script n'est pas un outil de sauvegarde.

## Prévisualisation et application

### Assistant interactif

Lancer le script sans arguments, ou avec `-Wizard` :

```powershell
.\scripts\setup-project.ps1 -Wizard
```

Choisir « Ajouter » dans le menu. L'assistant demande le dépôt Git du projet, la source du paquet (release GitHub
avec version exacte ou tarball local avec SHA-256), puis le mode PostgreSQL.
Pour un serveur local, il demande aussi la version WinGet ; pour PostgreSQL,
il propose le nom de variable de connexion et sa persistance utilisateur.
Le nom de variable peut rester vide pour être dérivé du chemin du projet.

Il affiche et vérifie ensuite le plan sans téléchargement ni modification.
Taper exactement `INSTALLER` pour appliquer ce plan. Entrée au récapitulatif
quitte sans installer ; `q` annule pendant la sélection. Les URL secrètes sont
demandées en saisie masquée seulement après confirmation. Un prérequis invalide
arrête le parcours avant application. L'approbation des hooks dans Codex reste
séparée. Ne pas combiner `-Wizard` avec les paramètres du mode scripté.

### Paramètres pour une exécution scriptée

Depuis le dépôt contenant le script mis à jour, sélectionner une release publiée.
Le script et ses modules ne sont pas présents dans les anciennes releases.

```powershell
$setup = @{
    Target = 'C:\work\client'
    ReleaseVersion = '0.8.0'
    PostgresMode = 'existing'
    ConnectionEnv = 'AIDN_MON_PROJET_PG_URL'
}
& .\scripts\setup-project.ps1 @setup
& .\scripts\setup-project.ps1 @setup -Write
```

Avec `-ReleaseVersion`, le script télécharge les assets depuis `leuzeus/aidn`,
refuse les drafts, préversions et assets manquants, puis compare la taille et le
SHA-256 du tarball au manifeste et aux checksums. Les téléchargements sont bornés
et limités aux origines HTTPS GitHub admises. Ces contrôles prouvent la cohérence
des assets du même éditeur ; ce ne sont pas une signature indépendante.
Les octets vérifiés sont conservés sous `%LOCALAPPDATA%\AIDN\packages`.
npm enregistre l'URL HTTPS versionnée et son intégrité SHA-512 dans le lockfile,
qui est contrôlé avant le bootstrap. Une version exacte est figée après une
sélection explicite de latest ; aucun repli sur une autre release. La disponibilité
d'une version exacte en mode scripté est vérifiée à l'application.
Les fonctionnalités installées sont celles de la version sélectionnée.

Pour le candidat local 0.9.0, remplacer `ReleaseVersion` par les deux paramètres :

```powershell
$setup.Remove('ReleaseVersion')
$setup.PackagePath = 'C:\paquets\aidn-workflow-0.9.0.tgz'
$setup.PackageSha256 = 'REMPLACER_PAR_64_CARACTERES_HEXA_DU_MANIFESTE'
```

Conserver ce tarball local dans un emplacement durable : npm enregistre son chemin.
Les deux sources de paquet sont mutuellement exclusives.

Sans `-Write`, le script affiche les étapes sans télécharger de paquet, demander
de secret ou contacter une base. La sélection latest, la consultation des mises
à jour et le choix de release dans le wizard consultent les métadonnées GitHub.
Avec `-Write`, il demande l'URL de connexion masquée si la variable du processus
n'est pas déjà renseignée. Ne pas saisir les secrets dans les arguments ou dans
un fichier suivi. Encoder les caractères réservés du mot de passe dans l'URL.

Le mode existing attend une URL de la forme
`postgresql://aidn_projet:MOT_DE_PASSE_ENCODE@serveur:5432/aidn_projet`.
Le rôle doit être propriétaire de la base et ne doit avoir aucun privilège
superuser, createdb, createrole, replication ou bypassrls. Les noms de base et
de rôle doivent commencer par une lettre minuscule et ne contenir que lettres
minuscules, chiffres et underscores, sur 63 caractères maximum. Les bases
postgres/template et le rôle postgres ne sont pas des identités applicatives.

Pour installer un serveur local, remplacer le mode et préciser sa version :

```powershell
$setup.PostgresMode = 'install'
$setup.PostgresVersion = '17.11-3'
& .\scripts\setup-project.ps1 @setup
& .\scripts\setup-project.ps1 @setup -Write
```

Cette version illustre le manifeste WinGet vérifié lors du développement.
Choisir explicitement une version disponible et approuvée ; le script ne résout
pas implicitement « latest ». Il utilise `PostgreSQL.PostgreSQL.17`, la source
winget, le mode interactif et `--no-upgrade`. Les vérifications d'intégrité de
WinGet restent actives. Le [manifeste Microsoft](https://github.com/microsoft/winget-pkgs/tree/master/manifests/p/PostgreSQL/PostgreSQL/17)
référence l'installateur EDB recommandé par le
[site PostgreSQL](https://www.postgresql.org/download/windows/).

Deux URL sont nécessaires pour le mode install :

- L'URL du futur rôle/base du projet, avec un mot de passe de 16 caractères ASCII
  imprimables au minimum, sans espace. Le script crée un vérificateur SCRAM et
  n'envoie pas ce mot de passe en clair dans les instructions SQL de création.
- L'URL administrateur vers la base postgres, demandée sous
  `AIDN_SETUP_PG_ADMIN`. Utiliser le même mot de passe et port dans l'installateur.

Les deux URL doivent viser exactement le même hôte de boucle locale et le même
port ; les paramètres de requête d'URL ne sont pas admis dans ce mode. Le script
vérifie la version du serveur connecté avant toute création. Un serveur déjà
installé n'est pas mis à niveau implicitement. Le rôle/base existant est conservé
seulement si les identifiants, droits et propriétaire conviennent ; aucun mot de
passe n'est réinitialisé et aucun objet n'est supprimé.

## Connexion du client et fin du parcours

Si ConnectionEnv est omis, son nom est dérivé du chemin du projet, pour éviter
de partager involontairement une même variable entre projets. Seule la référence
`env:...` est enregistrée dans la configuration AIDN.

Par défaut, le secret reste dans le processus PowerShell courant. Lancer le
client depuis cet environnement, ou provisionner la variable dans l'environnement
du client à sa prochaine ouverture. L'option `-PersistUserConnection`, avec
`-Write`, enregistre explicitement la variable au niveau utilisateur Windows
après réussite. **Une variable utilisateur n'est pas un coffre de secrets** :
elle contient l'URL en clair. Cette option refuse de remplacer une valeur
différente et ne persiste jamais l'URL administrateur. Redémarrer le client pour
hériter de la variable ; aucune configuration globale Codex n'est modifiée.
Avec le lanceur `aidn-setup`, le processus de l'assistant se termine à sa sortie :
sans persistance, fournir la variable au client séparément.

Les étapes AIDN sont : paquet npm avec scripts désactivés, vérification du driver
pg, préparation/vérification de la base, preview bootstrap, application avec son
plan exact, diagnostic des assets/activation, puis état de persistance ready.
Les erreurs des enfants ne sont pas recopiées, pour éviter les URL de connexion
dans les sorties. Le nom de la dernière étape indique où le parcours s'arrête.

Ouvrir enfin le projet dans Codex et revoir/approuver les définitions exactes
des hooks. Cette étape native ne peut pas être remplacée par l'installateur.
La réussite locale ne prouve ni l'approbation ni l'exécution des hooks.

## Reprise et preuves

Les étapes hôte, npm, PostgreSQL et bootstrap ne forment pas une transaction
globale. Après un échec, les étapes déjà appliquées restent présentes. Le script
ne désinstalle jamais automatiquement un serveur, ne supprime pas une base et
ne restaure pas un ancien package.json. Corriger l'erreur puis relancer avec les
mêmes entrées. Pour une transaction bootstrap interrompue, employer son diagnostic
et sa reprise existants, décrits dans [l'intégration Codex](CODEX_INTEGRATION.md).

Les fixtures couvrent la prévisualisation réelle PowerShell Windows, les appels
injectés des trois parcours, le refus de prérequis, la reprise sans rotation de
secrets, les conflits de propriétaire, l'arrêt sur erreur et les diagnostics
de persistance. Elles ne prouvent pas une installation EDB réelle ni une
connexion PostgreSQL réelle. Ces deux preuves restent SKIP tant qu'un hôte et
une base de qualification n'ont pas été explicitement désignés.

Si la politique PowerShell bloque l'exécution, faire autoriser le script revu
selon la politique du poste. Le script ne change aucune politique d'exécution.
La fixture utilise RemoteSigned dans son processus jetable uniquement.
