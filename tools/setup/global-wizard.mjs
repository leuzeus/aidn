import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { readProjects } from './project-registry.mjs';
import { runGlobalCommand, publicGlobalResult } from './global-cli.mjs';

export async function globalWizard(options, dependencies = {}) {
  if (!dependencies.ask && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('GLOBAL_WIZARD_REQUIRES_TERMINAL');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const terminal = dependencies.ask ? null : readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = dependencies.ask ?? (question => terminal.question(question));
  const show = dependencies.show ?? (value => process.stdout.write(`${value}\n`));
  const run = dependencies.run ?? runGlobalCommand;
  const secret = dependencies.secret ?? (async () => {
    process.stdout.write('URL PostgreSQL du projet (saisie masquée) : ');
    muted = true;
    try { return await terminal.question(''); }
    finally { muted = false; process.stdout.write('\n'); }
  });
  let target, written = false;
  try {
    while (true) {
      show('AIDN — moteur commun\n1. Ajouter un projet\n2. Sélectionner un projet mémorisé\n3. Diagnostic du projet\n4. Consulter les mises à jour globales\n5. Mettre à jour / installer AIDN\n6. Migrer un projet local\n7. Retirer un projet du registre\n8. Retour arrière global\n0. Quitter');
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
          const connectionRef = await ask('Référence PostgreSQL existante (env:NOM), vide pour stockage local : ');
          input = { ...input, action: 'project-add', target, ...(connectionRef ? { connectionRef } : {}) };
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
        else continue;
        const plan = await run(input);
        show(JSON.stringify(publicGlobalResult(plan), null, 2));
        if (input.check || input.action === 'doctor' || !plan.plan_id || plan.ok === false || plan.conflicts?.length
            || ['blocked', 'local-newer', 'up-to-date'].includes(plan.status)) continue;
        if ((await ask('Appliquer exactement ce plan ? Saisir OUI : ')).trim() !== 'OUI') { show('Annulé.'); continue; }
        const name = input.connectionRef?.slice(4), previous = name ? process.env[name] : undefined;
        try {
          if (name && !process.env[name]) process.env[name] = await secret();
          const applied = await run({ ...input, ...(input.release === 'latest' ? { release: plan.version } : {}), write: true, expectedPlanId: plan.plan_id });
          written ||= applied.written === true;
          show(JSON.stringify(publicGlobalResult(applied), null, 2));
          if (name && applied.ok !== false && applied.written && process.platform === 'win32') {
            show('La variable utilisateur conserve la connexion et son mot de passe EN CLAIR. Sans conservation, provisionner cette variable avant de lancer Codex.');
            if ((await ask('Conserver explicitement cette connexion dans votre environnement utilisateur ? Saisir OUI : ')).trim() === 'OUI') {
              const saved = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                '[Environment]::SetEnvironmentVariable($env:AIDN_SETUP_VARIABLE_NAME, [Environment]::GetEnvironmentVariable($env:AIDN_SETUP_VARIABLE_NAME, "Process"), "User")'],
              { env: { ...process.env, AIDN_SETUP_VARIABLE_NAME: name }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
              if (saved.status !== 0) throw new Error('GLOBAL_CONNECTION_PERSIST_FAILED');
            }
          }
        } finally { if (name) { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; } }
      } catch (error) { show(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_OPERATION_FAILED'); }
    }
  } finally { terminal?.close(); }
}
