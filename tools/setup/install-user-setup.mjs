import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupHome, readProjects } from './project-registry.mjs';
import { setupProcess, cleanSetupEnvironment } from './update-project.mjs';
import { writeFileAtomicSync } from '../../src/lib/fs/atomic-write-lib.mjs';

export function installUserSetup({ write = false, home = setupHome(), source = path.resolve(import.meta.dirname, '../..') } = {}, { run = setupProcess, env = process.env } = {}) {
  const version = fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim();
  if (!write) return { home, version, written: false, command: 'aidn-setup' };
  readProjects(home);
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, 'setup.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { throw new Error('SETUP_INSTALL_BUSY'); }
  try {
    const id = `${version}-${randomUUID()}`;
    const directory = path.join(home, 'setup', id);
    fs.mkdirSync(directory, { recursive: true });
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const options = { cwd: directory, env: cleanSetupEnvironment(env), stage: 'setup-package' };
    const packed = JSON.parse(run(process.execPath, [npm, 'pack', source, '--ignore-scripts', '--json', '--pack-destination', directory], options));
    const filename = packed[0]?.filename;
    if (!filename || path.basename(filename) !== filename) throw new Error('SETUP_PACKAGE_INVALID');
    fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}');
    run(process.execPath, [npm, 'install', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', path.join(directory, filename)], options);
    if (fs.readFileSync(path.join(directory, 'node_modules/aidn-workflow/VERSION'), 'utf8').trim() !== version
      || !fs.existsSync(path.join(directory, 'node_modules/aidn-workflow/scripts/setup-project.ps1'))) throw new Error('SETUP_PACKAGE_INVALID');
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    writeFileAtomicSync(path.join(home, 'bin/aidn-setup.cmd'), '@echo off\r\npowershell.exe -NoProfile -File "%~dp0aidn-setup.ps1" %*\r\nexit /b %errorlevel%\r\n');
    writeFileAtomicSync(path.join(home, 'bin/aidn-setup.ps1'), `$ErrorActionPreference = 'Stop'
$setupHome = Split-Path -Parent $PSScriptRoot
$current = Get-Content -LiteralPath (Join-Path $setupHome 'current.json') -Raw | ConvertFrom-Json
if ($current.id -notmatch '^[0-9]+\\.[0-9]+\\.[0-9]+-[a-f0-9-]{36}$') { throw 'Invalid setup pointer' }
$entry = Join-Path $setupHome ('setup/' + $current.id + '/node_modules/aidn-workflow/scripts/setup-project.ps1')
$env:AIDN_HOME = $setupHome
& powershell.exe -NoProfile -File $entry @args
exit $LASTEXITCODE
`);
    writeFileAtomicSync(path.join(home, 'current.json'), JSON.stringify({ schema_version: 1, id, version }) + '\n');
    return { home, version, written: true, command: 'aidn-setup' };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
