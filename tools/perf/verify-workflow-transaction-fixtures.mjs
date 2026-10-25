#!/usr/bin/env node
// The same unchanged-input decision oracle used by the manual source benchmark.
process.argv.push('--samples', '1', '--include-transaction');
await import('./measure-workflow-preparation.mjs');
