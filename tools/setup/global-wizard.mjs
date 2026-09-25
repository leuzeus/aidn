import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { readProjects } from './project-registry.mjs';
import { runGlobalCommand, publicGlobalResult } from './global-cli.mjs';
import path from 'node:path';

export function registerGlobalUserEnvironment(home, { run = spawnSync } = {}) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  const registered = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; $setupRoot = [IO.Path]::GetFullPath($env:AIDN_SETUP_HOME); ' +
    '$setupBin = Join-Path $setupRoot "bin"; ' +
    '$setupPath = [Environment]::GetEnvironmentVariable("PATH", "User"); ' +
    '$setupEntries = @($setupPath -split ";" | Where-Object { $_ }); ' +
    'if (-not ($setupEntries | Where-Object { $_.TrimEnd("\\") -ieq $setupBin.TrimEnd("\\") })) { ' +
    '[Environment]::SetEnvironmentVariable("PATH", (($setupEntries + $setupBin) -join ";"), "User") }; ' +
    '[Environment]::SetEnvironmentVariable("AIDN_HOME", $setupRoot, "User")'],
  { env: { ...process.env, AIDN_SETUP_HOME: home }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (registered.status !== 0 || registered.error) throw new Error('GLOBAL_ENVIRONMENT_REGISTRATION_FAILED');
  process.env.AIDN_HOME = home;
  const key = Object.keys(process.env).find(name => name.toLowerCase() === 'path') ?? 'PATH';
  const bin = path.join(home, 'bin'), entries = (process.env[key] ?? '').split(path.delimiter);
  if (!entries.some(entry => entry.replace(/[\\/]+$/, '').toLowerCase() === bin.toLowerCase())) process.env[key] = [...entries, bin].filter(Boolean).join(path.delimiter);
}

export async function globalWizard(options, dependencies = {}) {
  if (!dependencies.ask && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('GLOBAL_WIZARD_REQUIRES_TERMINAL');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const terminal = dependencies.ask ? null : readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = dependencies.ask ?? (question => terminal.question(question));
  const show = dependencies.show ?? (value => process.stdout.write(`${value}\n`));
  const run = dependencies.run ?? runGlobalCommand;
  const secret = dependencies.secret ?? (async label => {
    process.stdout.write(`${label} (saisie masquée) : `);
    muted = true;
    try { return await terminal.question(''); }
    finally { muted = false; process.stdout.write('\n'); }
  });
  let target, written = false;
  try {
    while (true) {
      show('AIDN — moteur commun\n1. Ajouter un projet\n2. Sélectionner un projet mémorisé\n3. Diagnostic du projet\n4. Consulter les mises à jour globales\n5. Mettre à jour / installer AIDN\n6. Migrer un projet local\n7. Retirer un projet du registre\n8. Retour arrière global\n9. Reprendre un ajout avec PostgreSQL local\n0. Quitter');
      const choice = (await ask('Choix : ')).trim();
      if (choice === '0') return { status: 'closed', written };
      try {
        if (choice === '2') {
          const projects = readProjects(options.home).projects;
          show(projects.map((entry, index) => `${index + 1}. ${entry.name} — ${entry.path}`).join('\n'));
          const index = Number(await ask('Numéro : ')) - 1;
          if (!Number.isInteger(index) || !projects[index]) throw new Error('PROJECT_NOT_REGISTERED');
          target = projects[index].path;
          show(JSON.stringify(await run({ home: options.home, action: 'doctor', target }), null, 2));
          continue;
        }
        let input = { home: options.home, json: true };
        if (choice === '1') {
          target = await ask('Racine du dépôt Git existant : ');
          const persistence = (await ask('Persistance : 1. Sans PostgreSQL ; 2. Ressources PostgreSQL existantes ; 3. Installer PostgreSQL local : ')).trim();
          if (!['1', '2', '3'].includes(persistence)) throw new Error('GLOBAL_PERSISTENCE_CHOICE_INVALID');
          const connectionRef = persistence === '1' ? '' : await ask('Référence de connexion du projet (env:AIDN_PG_NOM) : ');
          if (connectionRef && !/^env:AIDN_(?:PG|POSTGRES)_[A-Z0-9_]+$/.test(connectionRef)) throw new Error('GLOBAL_WIZARD_CONNECTION_REFERENCE_REQUIRED');
          if (persistence !== '1' && !connectionRef) throw new Error('GLOBAL_WIZARD_CONNECTION_REFERENCE_REQUIRED');
          input = { ...input, action: 'project-add', target, ...(connectionRef ? { connectionRef } : {}) };
          if (persistence === '3') {
            input = { ...input, postgresMode: 'install', postgresVersion: await ask('Version exacte WinGet PostgreSQL 17 (17.MINOR-REVISION) : '),
              adminConnectionRef: await ask('Référence administrateur locale (env:AIDN_PG_ADMIN, distincte du projet) : ') };
            show('Le programme officiel PostgreSQL peut demander une élévation Windows. Préparer ensuite un rôle et une base dédiés vides ; aucun mot de passe administrateur ne sera conservé.');
          }
        } else if (choice === '3') input = { ...input, action: 'doctor', target: target ?? await ask('Racine du dépôt Git : ') };
        else if (choice === '4' || choice === '5') {
          const release = choice === '4' ? 'latest' : (await ask('Release (latest, version exacte, ou local pour un tarball) : ')).trim() || 'latest';
          input = { ...input, action: 'update', release, ...(choice === '4' ? { check: true } : {}) };
          if (release === 'local') input = { ...input, release: await ask('Version exacte du paquet : '),
            packagePath: await ask('Tarball local : '), packageSha256: await ask('Empreinte SHA-256 : ') };
        } else if (choice === '6') input = { ...input, action: 'project-migrate', target: await ask('Racine du projet à migrer : ') };
        else if (choice === '7') {
          show(JSON.stringify(readProjects(options.home).projects, null, 2));
          input = { ...input, action: 'project-remove', id: await ask('Identifiant du projet à retirer (sans désinstallation) : ') };
        } else if (choice === '8') input = { ...input, action: 'rollback' };
        else if (choice === '9') input = { ...input, action: 'project-add', target: await ask('Racine du projet dont la préparation est interrompue : '), resume: true };
        else continue;
        const plan = await run(input);
        show(JSON.stringify(publicGlobalResult(plan), null, 2));
        if (input.check || input.action === 'doctor' || !plan.plan_id || plan.ok === false || plan.conflicts?.length
            || ['blocked', 'local-newer', 'up-to-date'].includes(plan.status)) continue;
        const register = input.action === 'update' && plan.status === 'installation-proposed';
        if (register) show(`Installation utilisateur : définir AIDN_HOME=${options.home} et ajouter son dossier bin au PATH utilisateur. Aucun droit administrateur pour AIDN.`);
        if ((await ask('Appliquer exactement ce plan ? Saisir OUI : ')).trim() !== 'OUI') { show('Annulé.'); continue; }
        const provisioning = plan.external_effects?.find(effect => effect.id === 'database-provision');
        const name = (input.connectionRef ?? provisioning?.connection_ref)?.slice(4);
        const admin = (input.adminConnectionRef ?? provisioning?.admin_connection_ref)?.slice(4);
        const previous = new Map([name, admin].filter(Boolean).map(key => [key, process.env[key]]));
        try {
          if (name && !process.env[name]) process.env[name] = await secret('URL PostgreSQL du projet');
          if (admin && !process.env[admin]) process.env[admin] = await secret('URL administrateur PostgreSQL locale, base postgres');
          const applied = await run({ ...input, ...(input.release === 'latest' ? { release: plan.version } : {}), write: true, expectedPlanId: plan.plan_id });
          written ||= applied.written === true;
          show(JSON.stringify(publicGlobalResult(applied), null, 2));
          if (register && applied.written && applied.ok !== false) {
            (dependencies.registerEnvironment ?? registerGlobalUserEnvironment)(options.home);
            show('Commande aidn enregistrée pour cet utilisateur. Rouvrir les autres terminaux pour actualiser leur environnement.');
          }
          if (name && applied.ok !== false && applied.written && process.platform === 'win32') {
            show('La variable utilisateur conserve la connexion et son mot de passe EN CLAIR. Sans conservation, provisionner cette variable avant de lancer Codex.');
            if ((await ask('Conserver explicitement cette connexion dans votre environnement utilisateur ? Saisir OUI : ')).trim() === 'OUI') {
              const saved = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                '$ErrorActionPreference = "Stop"; [Environment]::SetEnvironmentVariable($env:AIDN_SETUP_VARIABLE_NAME, [Environment]::GetEnvironmentVariable($env:AIDN_SETUP_VARIABLE_NAME, "Process"), "User")'],
              { env: { ...process.env, AIDN_SETUP_VARIABLE_NAME: name }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
              if (saved.status !== 0) throw new Error('GLOBAL_CONNECTION_PERSIST_FAILED');
            }
          }
        } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
      } catch (error) { show(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_OPERATION_FAILED'); }
    }
  } finally { terminal?.close(); }
}
