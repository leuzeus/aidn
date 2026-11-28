import fs from 'node:fs';
import { isMainThread, parentPort } from 'node:worker_threads';

async function execute(input, readOnly) {
  try {
    const request = JSON.parse(readOnly ? input : fs.readFileSync(0, 'utf8'));
    if (readOnly && !['get', 'get-many', 'list', 'list-paths', 'list-reconciliation'].includes(request.action)) throw new Error('ARTIFACT_POSTGRES_READ_ACTION_REQUIRED');
    const { createRuntimeArtifactStore } = await import('./runtime-persistence-service.mjs');
    const store = createRuntimeArtifactStore({ targetRoot: request.targetRoot });
    if (typeof store.executeArtifactCommand !== 'function') throw new Error('ARTIFACT_BACKEND_CHANGED');
    const result = await store.executeArtifactCommand(request.action, request.options);
    return { status: 0, stdout: JSON.stringify({ ok: true, result }) };
  } catch (error) {
    // PostgreSQL exceptions may contain credentials or private document text.
    const candidate = error?.code === 'ARTIFACT_EXECUTION_SCOPE_RESERVED' ? error.code : error?.message;
    const code = /^ARTIFACT_[A-Z_]+$/.test(candidate) ? candidate : 'ARTIFACT_POSTGRES_COMMAND_FAILED';
    return { status: 1, stdout: JSON.stringify({ ok: false, code }) };
  }
}

if (isMainThread) {
  const result = await execute(null, false);
  process.stdout.write(result.stdout);
  process.exitCode = result.status;
} else {
  parentPort.on('message', async ({ input, reply, ready, maxBytes }) => {
    const result = await execute(input, true);
    try {
      reply.postMessage(Buffer.byteLength(result.stdout) > maxBytes ? { status: null, error: { code: 'ENOBUFS' } } : result);
    } finally {
      reply.close();
      Atomics.store(ready, 0, 1);
      Atomics.notify(ready, 0);
    }
  });
}
