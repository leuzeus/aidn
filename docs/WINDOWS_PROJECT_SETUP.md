# Installation complète d'un projet sous Windows

`scripts/setup-project.ps1` orchestre le paquet AIDN, les skills et hooks Codex,
et une persistance PostgreSQL facultative. Il réutilise le bootstrap et son plan
d'installation ; les règles du workflow et les migrations restent dans AIDN.
Le candidat 0.9.0 est local et non publié.

## Prérequis et choix

- Windows, PowerShell 5.1 ou supérieur, Node.js 22.13+ avec son npm, et Git.
- Un dépôt Git client existant, distinct du dépôt source AIDN.
- Une release GitHub publiée avec tarball, manifeste et checksums, sélectionnée
  par version exacte, ou un tarball local de la même version que le script avec
  son SHA-256 vérifié. La release 0.8.0 est publiée ; 0.9.0 reste locale.
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
qui est contrôlé avant le bootstrap. Une version exacte est obligatoire : aucun
repli sur latest ni sur une autre release. La disponibilité est vérifiée à l'application.
Les fonctionnalités installées sont celles de la version sélectionnée.

Pour le candidat local 0.9.0, remplacer `ReleaseVersion` par les deux paramètres :

```powershell
$setup.Remove('ReleaseVersion')
$setup.PackagePath = 'C:\paquets\aidn-workflow-0.9.0.tgz'
$setup.PackageSha256 = 'REMPLACER_PAR_64_CARACTERES_HEXA_DU_MANIFESTE'
```

Conserver ce tarball local dans un emplacement durable : npm enregistre son chemin.
Les deux sources de paquet sont mutuellement exclusives.

Sans `-Write`, le script lit uniquement les entrées locales et affiche les étapes.
Il ne télécharge rien, ne demande aucun secret et ne contacte aucune base.
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
