# ASCII prompts preserve Windows PowerShell 5.1 compatibility without a BOM.
function Read-AidnSetupValue {
    param([string]$Prompt, [string]$Pattern = '.+', [string]$Default = '')
    while ($true) {
        $value = Read-Host $Prompt
        if ($null -eq $value) { throw 'AIDN_WIZARD_CANCELLED' }
        $value = $value.Trim()
        if ($value -ieq 'q') { throw 'AIDN_WIZARD_CANCELLED' }
        if (-not $value) { $value = $Default }
        if ($value -match $Pattern) { return $value }
        Write-Host 'Valeur invalide. Reessayer, ou q pour annuler.'
    }
}

function Invoke-AidnSetupWizard {
    param([Parameter(Mandatory = $true)][scriptblock]$RunSetup, [scriptblock]$Control)
    try {
        Write-Host 'AIDN - Installation guidee Windows (q pour annuler)'
        Write-Host 'Prerequis : Git, Node.js 22.13+ avec npm ; WinGet pour installer PostgreSQL.'
        $options = @{}
        while ($true) {
            $target = Read-AidnSetupValue 'Chemin du depot Git du projet'
            if ((Test-Path -LiteralPath $target -PathType Container) -and (Test-Path -LiteralPath (Join-Path $target '.git'))) { break }
            Write-Host 'Choisir un depot Git existant, a sa racine.'
        }
        $options.Target = (Resolve-Path -LiteralPath $target).ProviderPath
        if ($Control) {
            $existing = & $Control -ControlArguments @('inspect', $options.Target)
            if ($existing.state -ne 'absent') { throw "Installation existante ($($existing.state)) : utiliser le menu de mise a jour ou le diagnostic." }
        }
        $source = Read-AidnSetupValue 'Paquet : 1 = release GitHub, 2 = tarball local [1]' '^[12]$' '1'
        if ($source -eq '1') {
            $pattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
            if ($Control) {
                $selected = Read-AidnSetupValue 'Version publiee exacte, ou latest pour consulter GitHub [latest]' ('^(latest|' + $pattern.TrimStart('^').TrimEnd('$') + ')$') 'latest'
                $options.ReleaseVersion = (& $Control -ControlArguments @('resolve', $selected)).version
            } else { $options.ReleaseVersion = Read-AidnSetupValue 'Version publiee exacte (sans v)' $pattern }
        } else {
            while ($true) {
                $tarball = Read-AidnSetupValue 'Chemin du paquet .tgz'
                if ($tarball.EndsWith('.tgz') -and (Test-Path -LiteralPath $tarball -PathType Leaf)) { break }
                Write-Host 'Fichier .tgz introuvable.'
            }
            $options.PackagePath = (Resolve-Path -LiteralPath $tarball).ProviderPath
            $options.PackageSha256 = Read-AidnSetupValue 'SHA-256 du manifeste de confiance' '^[a-fA-F0-9]{64}$'
        }
        $mode = Read-AidnSetupValue 'PostgreSQL : 1 = existant, 2 = installer localement, 3 = sans PostgreSQL [1]' '^[123]$' '1'
        $options.PostgresMode = @{ '1' = 'existing'; '2' = 'install'; '3' = 'none' }[$mode]
        if ($mode -eq '2') {
            $options.PostgresVersion = Read-AidnSetupValue 'Version WinGet PostgreSQL 17 exacte (format 17.x-y)' '^17\.[0-9]+-[0-9]+$'
        }
        $persist = $false
        if ($mode -ne '3') {
            $connection = Read-AidnSetupValue 'Variable de connexion AIDN_* [Entree = nom propre au projet]' '^(|AIDN_[A-Z0-9_]+)$'
            if ($connection) { $options.ConnectionEnv = $connection }
            Write-Host 'Les secrets seront demandes en saisie masquee uniquement apres confirmation.'
            Write-Host 'La persistance utilisateur Windows conserve l URL en clair, hors coffre de secrets.'
            $persist = (Read-AidnSetupValue 'Conserver la connexion pour les prochaines sessions Windows ? o/n [n]' '^[onON]$' 'n') -ieq 'o'
        }
        Write-Host 'Recapitulatif et verification du plan (aucune installation) :'
        & $RunSetup $options
        Write-Host "Conserver la connexion utilisateur : $persist"
        Write-Host 'Les hooks seront prepares ; leur approbation dans Codex reste manuelle.'
        $decision = Read-AidnSetupValue 'Taper INSTALLER pour appliquer, ou Entree pour quitter sans modification' '^(INSTALLER|)$'
        if ($decision -cne 'INSTALLER') { Write-Host 'Termine sans installation.'; return }
        $options.Write = $true
        if ($persist) { $options.PersistUserConnection = $true }
        & $RunSetup $options
    } catch {
        if ($_.Exception.Message -eq 'AIDN_WIZARD_CANCELLED') { Write-Host 'Installation annulee.'; return }
        throw
    }
}
