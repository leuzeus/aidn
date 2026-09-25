import fs from 'node:fs';
import { createRuntimeArtifactStore } from './runtime-persistence-service.mjs';

try {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  const store = createRuntimeArtifactStore({ targetRoot: request.targetRoot });
  if (typeof store.executeArtifactCommand !== 'function') throw new Error('ARTIFACT_BACKEND_CHANGED');
  const result = await store.executeArtifactCommand(request.action, request.options);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  // PG messages can contain credentials, SQL values, or private document text.
  const code = /^ARTIFACT_[A-Z_]+$/.test(error.message) ? error.message : 'ARTIFACT_POSTGRES_COMMAND_FAILED';
  process.stdout.write(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}
