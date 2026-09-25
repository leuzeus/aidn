import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { findCodexLauncher } from './codex-discovery-lib.mjs';

// Native Codex loads its user agent files and constructs an actual Responses
// request. A loopback provider records only whether the expected definitions
// were advertised and returns no tool call. No subagent or real model is run.
export async function discoverGlobalAgents({ cwd, codexHome, expectedNames, env = process.env }) {
  const launcher = findCodexLauncher(env);
  if (!launcher) return { status: 'SKIP', reason: 'Codex CLI unavailable' };
  const version = spawnSync(launcher.command, [...launcher.args, '--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const observed = new Set(); let requests = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') { response.writeHead(403); response.end(); return; }
    let bytes = 0; const chunks = [];
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) request.destroy(); else chunks.push(chunk); });
    request.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks)); } catch { response.writeHead(400); response.end(); return; }
      requests++;
      const definitions = JSON.stringify([body.tools, body.instructions]);
      for (const name of expectedNames) if (definitions.includes(name)) observed.add(name);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: {
        id: 'resp_aidn_fixture', object: 'response', status: 'completed', output: [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      } })}\n\n`);
    });
  });
  // Prevent incidental background HTTPS requests from reaching a remote service.
  server.on('connect', (_request, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !/^AIDN_|^(?:OPENAI|CODEX)_API_KEY$/i.test(name)));
    const child = spawn(launcher.command, [...launcher.args,
      '-c', 'model_provider="aidn_fixture"', '-c', 'model="aidn-fixture-model"',
      '-c', 'model_providers.aidn_fixture.name="Local qualification fixture"',
      '-c', `model_providers.aidn_fixture.base_url="${base}/v1"`,
      '-c', 'model_providers.aidn_fixture.wire_api="responses"',
      '-c', 'model_providers.aidn_fixture.requires_openai_auth=false',
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
      'Do not invoke tools. This is a local protocol qualification.'],
    { cwd, env: { ...childEnv, CODEX_HOME: codexHome, HTTP_PROXY: base, HTTPS_PROXY: base, ALL_PROXY: base, NO_PROXY: '127.0.0.1,localhost' },
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1500); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
    const exit = await new Promise(resolve => { child.once('error', () => resolve(null)); child.once('close', resolve); });
    clearTimeout(timer);
    return { status: exit === 0 && !timedOut && requests > 0 && observed.size === expectedNames.length ? 'PASS' : 'FAIL',
      requests, discovered: [...observed].sort(), expected: [...expectedNames].sort(),
      backend_version: version.status === 0 ? version.stdout.trim() : 'UNAVAILABLE',
      launcher_sha256: createHash('sha256').update(fs.readFileSync(launcher.source)).digest('hex'),
      exit_code: exit, ...(exit !== 0 ? { diagnostic: stderr.replace(/https?:\/\/[^\s"']+/g, '[url]') } : {}),
      model_provider: 'loopback fixture', subagents_executed: 0, native_hook_execution: 'NOT_RUN', timed_out: timedOut };
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
