import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeActivityOutputBindings } from '../../src/core/workflow/native-activity-output.mjs';

// Test-only observation around the actual worker capability. No authority,
// return value or thrown object is replaced. Only bounded machine fields and
// package-relative source locations are retained; no error message or raw stack.
export function observeFixtureNativePreparation(authority, { controlRoot, generation }) {
  if (!authority) return authority;
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  let sequence = 0;
  const locations = error => {
    const rows = [];
    for (const line of typeof error?.stack === 'string' ? error.stack.split('\n') : []) {
      if (!/^\s+at /.test(line)) continue;
      const found = /(file:\/\/\/[^\n)]+[.]mjs):(\d+):(\d+)/.exec(line);
      if (!found) continue;
      let relative;
      try { relative = path.relative(packageRoot, fileURLToPath(found[1])).replaceAll('\\', '/'); } catch { continue; }
      if (!/^(src|tools)\//.test(relative) || relative.split('/').includes('..')) continue;
      rows.push({ module: relative, line: Number(found[2]), column: Number(found[3]) });
      if (rows.length === 8) break;
    }
    return rows;
  };
  return Object.freeze({ ...authority,
    async prepareActivityOutput(input) {
      const index = ++sequence;
      let stage = 'prepareActivityOutput';
      const retain = value => {
        if (!Number.isSafeInteger(generation) || generation < 1 || index > 256) return;
        try { fs.writeFileSync(path.join(controlRoot, 'fixture-native-preparation-' + generation + '-' + String(index).padStart(3, '0') + '.json'),
          JSON.stringify({ fixture_observation_only: true, no_new_authority: true, ...value }) + '\n', { flag: 'wx' }); }
        catch { /* Diagnostics never replace the actual result or failure. */ }
      };
      try {
        const value = await authority.prepareActivityOutput(input);
        stage = 'nativeActivityOutputBindings';
        // Invoke the shared pure binding reader; the execution host performs
        // the same read after this observation. No routing algorithm is copied.
        nativeActivityOutputBindings(input.contractRef, value.context);
        retain({ status: 'prepared', stage, context_sha256: /^[a-f0-9]{64}$/.test(value.context_sha256) ? value.context_sha256 : null });
        return value;
      } catch (error) {
        retain({ status: 'failed', stage,
          code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code) ? error.code : null,
          error_class: ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'AssertionError'].includes(error?.name) ? error.name : 'OTHER',
          locations: locations(error) });
        throw error;
      }
    },
  });
}
