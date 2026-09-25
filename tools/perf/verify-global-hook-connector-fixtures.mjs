import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { globalHookConnector } from '../../src/application/install/global-project-integration.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-hook-transport-'));
const client = path.join(temporary, 'client espace été');
const home = path.join(temporary, 'global');
const launcher = path.join(home, 'bin/global-launcher.mjs');
const secret = 'fixture-secret-not-for-hook-output';
const assertions = [];
try {
  fs.mkdirSync(path.join(client, '.codex/hooks'), { recursive: true });
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  for (const event of ['pre-tool-use', 'session-start']) {
    fs.writeFileSync(path.join(client, `.codex/hooks/aidn-${event}.mjs`), globalHookConnector(event));
  }
  const run = (event, env = {}) => {
    const result = spawnSync(process.execPath, [path.join(client, `.codex/hooks/aidn-${event}.mjs`)], {
      cwd: client, env: { ...process.env, AIDN_HOME: home, ...env },
      input: JSON.stringify({ cwd: client, tool_name: 'apply_patch', tool_input: { command: 'fixture' } }),
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(result.status, 0, JSON.stringify({ status: result.status, error: result.error?.code, stderr: result.stderr }));
    assert(!`${result.stdout}${result.stderr}`.includes(secret), 'child failure details must not leak');
    return JSON.parse(result.stdout.trim());
  };
  const failure = (env = {}) => {
    const denial = run('pre-tool-use', env);
    assert.equal(denial.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(denial.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(denial.hookSpecificOutput.permissionDecisionReason, /global hook unavailable/i);
    const startup = run('session-start', env);
    assert.equal(startup.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(startup.hookSpecificOutput.additionalContext, /degraded.*read-only/i);
    assert.equal(startup.hookSpecificOutput.permissionDecision, undefined);
  };
  failure();
  failure({ AIDN_HOME: '' });
  failure({ AIDN_HOME: 'relative-home' });
  assertions.push('missing-launcher-and-invalid-home-produce-structured-failure');
  for (const code of [1, 2]) {
    fs.writeFileSync(launcher, `process.stdout.write('${secret}');process.stderr.write('${secret}');process.exitCode=${code};`);
    failure();
  }
  assertions.push('nonzero-child-exits-do-not-rely-on-native-exit-code-handling');
  for (const output of ['', 'not-json', '{}\n{}', 'null', '[]', '{"ok":false}',
    '{"hookSpecificOutput":{"hookEventName":"Other","additionalContext":"unexpected"}}',
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}']) {
    fs.writeFileSync(launcher, `process.stdout.write(${JSON.stringify(output)});`);
    failure();
  }
  assertions.push('empty-malformed-multiple-and-unrecognized-replies-refused');
  fs.writeFileSync(launcher, "process.stdout.write('x'.repeat(70000));");
  failure();
  assertions.push('oversized-output-refused');
  fs.writeFileSync(launcher, 'process.stdin.resume();process.stdin.on("end",()=>console.log("{}"));');
  assert.deepEqual(run('pre-tool-use'), {}, 'inactive reply stays neutral');
  assert.deepEqual(run('session-start'), {}, 'inactive startup stays neutral');
  const replies = [
    ['pre-tool-use', { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'admitted for this patch' } }],
    ['pre-tool-use', { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'canonical refusal' } }],
    ['session-start', { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'canonical context' } }],
  ];
  for (const [event, reply] of replies) {
    fs.writeFileSync(launcher, `let input='';for await(const c of process.stdin)input+=c;const p=JSON.parse(input);if(p.tool_input.command!=='fixture')process.exit(1);console.log(${JSON.stringify(JSON.stringify(reply))});`);
    assert.deepEqual(run(event), reply, 'valid reply and stdin preserved');
  }
  assertions.push('inactive-admitted-denied-startup-and-stdin-preserved');
  fs.writeFileSync(launcher, 'setTimeout(()=>console.log("{}"),30000);');
  const started = Date.now();
  const timedOut = run('pre-tool-use');
  assert.equal(timedOut.hookSpecificOutput.permissionDecision, 'deny');
  assert(Date.now() - started < 14000, 'connector deadline precedes native termination');
  assertions.push('child-timeout-produces-explicit-denial');
  assert.deepEqual(fs.readdirSync(client).sort(), ['.codex'], 'connector never mutates project state');
  console.log(JSON.stringify({ status: 'PASS', evidence: 'real subprocess fixtures; not native Codex qualification', assertions }));
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-hook-transport-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
