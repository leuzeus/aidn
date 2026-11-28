import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Explicit fixture setup BEFORE observing a command. Never imported by runtime
// code and never an implicit fallback from SQL to a visible document.
export function seedSqliteFixture(targetRoot) {
  const script = fileURLToPath(new URL('./index-sync.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath,
    [script, '--target', path.resolve(targetRoot), '--store', 'sqlite', '--with-content', '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8388608,
      env: { ...process.env, AIDN_STATE_MODE: '', AIDN_INDEX_STORE_MODE: '' } }));
  if (result.dry_run !== false || !result.summary.artifacts_count) throw Error('SQLITE_FIXTURE_IMPORT_FAILED');
}
