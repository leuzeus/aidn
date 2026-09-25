function Invoke-AidnSetupMenu {
    param([scriptblock]$RunSetup, [scriptblock]$Control)
    $selectedProject = $null
    try {
        while ($true) {
            Write-Host 'AIDN setup : 1 Ajouter | 2 Selectionner/memoriser | 3 Consulter | 4 Mettre a jour | 5 Retirer | q Quitter'
            if ($selectedProject) { Write-Host "Projet selectionne : $selectedProject" }
            $choice = Read-AidnSetupValue 'Action' '^[1-5]$'
            if ($choice -eq '1') {
                Invoke-AidnSetupWizard -RunSetup $RunSetup -Control $Control
                continue
            }
            if ($choice -eq '2' -or -not $selectedProject) {
                $registry = & $Control -ControlArguments @('list')
                $projects = @($registry.projects)
                for ($i = 0; $i -lt $projects.Count; $i++) {
                    $exists = Test-Path -LiteralPath $projects[$i].path -PathType Container
                    Write-Host "$($i + 1) $($projects[$i].name) : $($projects[$i].path) (present=$exists)"
                }
                $index = Read-AidnSetupValue 'Numero du projet, ou 0 pour saisir un chemin' '^[0-9]+$'
                if ($index -eq '0') {
                    $selectedProject = Read-AidnSetupValue 'Chemin du depot existant'
                    $installed = & $Control -ControlArguments @('inspect', $selectedProject)
                    Write-Host "Installation : $($installed.state); paquet : $($installed.packageVersion); terminee : $($installed.recordedVersion)"
                    if ($installed.state -eq 'installed' -and (Read-AidnSetupValue 'Memoriser ce projet ? o/n [n]' '^[onON]$' 'n') -ieq 'o') {
                        $null = & $Control -ControlArguments @('remember', $selectedProject, '--write')
                    }
                } elseif ([long]$index -gt $projects.Count) { Write-Host 'Numero inconnu.'; continue }
                else {
                    $selectedProject = $projects[[int]$index - 1].path
                    if (Test-Path -LiteralPath $selectedProject -PathType Container) {
                        $installed = & $Control -ControlArguments @('inspect', $selectedProject)
                        Write-Host "Installation : $($installed.state); paquet : $($installed.packageVersion); terminee : $($installed.recordedVersion)"
                    } else { Write-Host 'Chemin absent ou deplace. Retirer cette entree puis selectionner explicitement le nouveau chemin.' }
                }
                if ($choice -eq '2') { continue }
            }
            if ($choice -eq '5') {
                $registry = & $Control -ControlArguments @('list')
                $entry = @($registry.projects | Where-Object { $_.path -ieq $selectedProject })
                if ($entry.Count -ne 1) { Write-Host 'Ce chemin ne figure pas dans la liste.'; continue }
                if ((Read-AidnSetupValue 'Retirer de la liste seulement ? o/n [n]' '^[onON]$' 'n') -ieq 'o') {
                    $null = & $Control -ControlArguments @('forget', $entry[0].id, '--write')
                    $selectedProject = $null
                }
                continue
            }
            if (-not (Test-Path -LiteralPath $selectedProject -PathType Container)) {
                Write-Host 'Chemin absent ou deplace. Retirer cette entree puis selectionner explicitement le nouveau chemin.'
                continue
            }
            $current = & $Control -ControlArguments @('inspect', $selectedProject)
            Write-Host "Installation : $($current.state); paquet : $($current.packageVersion); terminee : $($current.recordedVersion)"
            if ($choice -eq '3') {
                if ((Read-AidnSetupValue 'Consulter la derniere release sur GitHub ? o/n [n]' '^[onON]$' 'n') -ieq 'o') {
                    $check = & $Control -ControlArguments @('check', $selectedProject, 'latest')
                    Write-Host "Release : $($check.version); etat : $($check.status)"
                }
                continue
            }
            if ($current.state -ne 'installed') { Write-Host 'Diagnostic/reprise necessaire avant mise a jour.'; continue }
            $source = Read-AidnSetupValue 'Mise a jour : 1 Release GitHub, 2 Tarball local [1]' '^[12]$' '1'
            $updateOptions = @{ Target = $selectedProject; Update = $true; ExpectedInstallation = $current.fingerprint }
            if ($source -eq '1') {
                $release = Read-AidnSetupValue 'Version exacte ou latest [latest]' '^(latest|[0-9]+\.[0-9]+\.[0-9]+)$' 'latest'
                $check = & $Control -ControlArguments @('check', $selectedProject, $release)
                Write-Host "Release : $($check.version); etat : $($check.status)"
                if ($check.status -ne 'update-available') { continue }
                $updateOptions.ReleaseVersion = $check.version
            } else {
                $updateOptions.PackagePath = Read-AidnSetupValue 'Chemin du tarball local (meme version que ce setup)'
                $updateOptions.PackageSha256 = Read-AidnSetupValue 'SHA-256 du manifeste' '^[a-fA-F0-9]{64}$'
            }
            & $RunSetup $updateOptions
            Write-Host 'Configuration et base conservees. Une migration necessaire bloquera la mise a jour.'
            if ((Read-AidnSetupValue 'Taper INSTALLER pour appliquer, ou Entree pour annuler' '^(INSTALLER|)$') -ceq 'INSTALLER') {
                $updateOptions.Write = $true
                & $RunSetup $updateOptions
            }
        }
    } catch {
        if ($_.Exception.Message -eq 'AIDN_WIZARD_CANCELLED') { Write-Host 'Setup termine.'; return }
        throw
    }
}
