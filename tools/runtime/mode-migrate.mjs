#!/usr/bin/env node
import path from 'node:path';
import { migrateStateMode } from '../../src/application/runtime/state-mode-migration.mjs';

const argv = process.argv.slice(2), json = argv.includes('--json');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('aidn runtime mode-migrate --target . --to dual|db-only [--from files|dual|db-only] [--backend sqlite|postgres] [--connection-ref env:NAME] [--write] [--json]');
  console.log('Preview is read-only. Legacy FILES is accepted only as a migration source. Existing SQL authority is preserved.');
} else {
  try {
    const options = { targetRoot: '.', to: '', write: false };
    const values = { '--target': 'targetRoot', '--from': 'from', '--to': 'to', '--backend': 'backend',
      '--connection-ref': 'connectionRef', '--audit-root': 'auditRoot', '--index-file': 'indexFile' };
    const seen = new Set();
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (seen.has(arg)) throw Error('AIDN_MODE_MIGRATION_ARGUMENT_DUPLICATE');
      seen.add(arg);
      if (values[arg]) { const value = argv[++i]; if (!value || value.startsWith('--')) throw Error('AIDN_MODE_MIGRATION_ARGUMENT_REQUIRED'); options[values[arg]] = value; }
      else if (arg === '--write') options.write = true;
      else if (['--json', '--strict', '--no-repair-layer', '--no-repair-layer-triage'].includes(arg)) continue;
      else throw Error('AIDN_MODE_MIGRATION_ARGUMENT_INVALID');
    }
    options.targetRoot = path.resolve(options.targetRoot);
    const output = await migrateStateMode(options);
    console.log(json ? JSON.stringify(output, null, 2) : `${output.preview ? 'Preview' : 'Migrated'}: ${output.from_mode} -> ${output.to_mode}; ${output.verification.sessions} session(s), ${output.verification.cycles} cycle(s), ${output.verification.history_records} history record(s) verified.`);
  } catch (cause) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? cause.message ?? '') ? cause.code ?? cause.message : 'AIDN_MODE_MIGRATION_FAILED';
    console.log(json ? JSON.stringify({ ts: new Date().toISOString(), ok: false, code, message: code, written: cause.migration_written === true,
      outcome_uncertain: cause.migration_outcome_unknown === true }) : code);
    process.exitCode = 1;
  }
}
