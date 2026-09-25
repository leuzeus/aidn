// Private candidate protocol; stderr is deliberately bounded to error codes.
import { inspectGlobalProjectCompatibility } from '../../src/application/install/global-project-compatibility.mjs';
try {
  if (![3, 4].includes(process.argv.length)) throw new Error('GLOBAL_COMPATIBILITY_TARGET_REQUIRED');
  const result = await inspectGlobalProjectCompatibility({ targetRoot: process.argv[2], globalRecoveryPlanId: process.argv[3] });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write((/^GLOBAL_[A-Z0-9_]+$/.test(error.message) ? error.message : 'GLOBAL_COMPATIBILITY_UNAVAILABLE') + '\n');
  process.exitCode = 2;
}
