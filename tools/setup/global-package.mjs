import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setupProcess, cleanSetupEnvironment } from './update-project.mjs';
import { checkedHostPath, sealRuntimeGeneration, GLOBAL_INTEGRATION_REVISION } from '../../src/application/install/global-runtime-store.mjs';
import { assertGlobalSkillsEnabled } from '../../src/application/install/global-skills-migration-service.mjs';

const hash = file => createHash('sha256').update(fs.readFileSync(checkedHostPath(file))).digest('hex');
const fail = code => { throw new Error(code); };

export function prepareGlobalPackage({ home, artifact, version }, {
  env = process.env, run = setupProcess,
  npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
} = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) fail('NODE_22_13_REQUIRED');
  checkedHostPath(home);
  if (!fs.existsSync(npmCli)) fail('NODE_BUNDLED_NPM_REQUIRED');
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.packageSha256 ?? '')
      || hash(artifact.packagePath) !== artifact.packageSha256) fail('GLOBAL_TARBALL_HASH_MISMATCH');
  const directory = path.join(home, 'generations', randomUUID());
  checkedHostPath(directory);
  fs.mkdirSync(directory, { recursive: true });
  // Install only the bytes already verified, not a second fetch of a mutable URL.
  const tarball = path.join(directory, 'package.tgz');
  fs.copyFileSync(artifact.packagePath, tarball, fs.constants.COPYFILE_EXCL);
  if (hash(tarball) !== artifact.packageSha256) fail('GLOBAL_TARBALL_CHANGED');
  fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}\n', { flag: 'wx' });
  run(process.execPath, [npmCli, 'install', '--save-exact', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', tarball],
    { cwd: directory, env: cleanSetupEnvironment(env), stage: 'global-candidate-install' });
  const packageRoot = path.join(directory, 'node_modules', 'aidn-workflow');
  if (fs.readFileSync(checkedHostPath(path.join(packageRoot, 'VERSION')), 'utf8').trim() !== version) fail('GLOBAL_CANDIDATE_VERSION_MISMATCH');
  const pointer = sealRuntimeGeneration({ home, directory, packageRoot,
    provenance: { sha256: artifact.packageSha256, source: artifact.packageUrl ? 'github-release' : 'local-tarball', commit: artifact.releaseCommit ?? null } });
  return { pointer, packageRoot };
}

export function globalCodexAssets({ home, packageRoot, userHome = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(userHome, '.codex') }) {
  for (const directory of [home, packageRoot, userHome, codexHome]) checkedHostPath(directory);
  const assets = [];
  const add = (file, content) => assets.push({ path: checkedHostPath(file), content });
  const read = relative => fs.readFileSync(checkedHostPath(path.join(packageRoot, relative)), 'utf8');
  // Definitions loaded in an older native session must carry their old revision.
  const command = text => text.replace(/\bnpx aidn\b/g, 'aidn')
    .replace(/\baidn (?=(?:runtime|bootstrap|codex|project|perf|install)\b)/g, `aidn --integration-revision ${GLOBAL_INTEGRATION_REVISION} `);
  function tree(source, destination, transform) {
    for (const entry of fs.readdirSync(checkedHostPath(source), { withFileTypes: true })) {
      const file = checkedHostPath(path.join(source, entry.name));
      if (entry.isDirectory()) tree(file, path.join(destination, entry.name), transform);
      else if (entry.isFile()) {
        if (!/\.(md|yaml|yml|toml|mjs|js|json|ps1|txt)$/.test(entry.name)) fail('GLOBAL_ASSET_FORMAT_UNSUPPORTED');
        add(path.join(destination, entry.name), transform(fs.readFileSync(file, 'utf8')));
      } else fail('GLOBAL_UNSAFE_PACKAGE_ENTRY');
    }
  }
  const skillRoot = path.join(packageRoot, 'scaffold', 'codex');
  for (const entry of fs.readdirSync(checkedHostPath(skillRoot), { withFileTypes: true })) {
    if (entry.isDirectory()) tree(path.join(skillRoot, entry.name), path.join(codexHome, 'skills', entry.name), command);
  }
  assertGlobalSkillsEnabled(codexHome, assets.filter(item => item.path.endsWith('SKILL.md')).map(item => item.path));
  tree(path.join(packageRoot, 'scaffold', 'codex_agents'), path.join(codexHome, 'agents'), text => command(text)
    .replace('developer_instructions = """', `developer_instructions = """\nBefore AIDN workflow execution, run aidn --integration-revision ${GLOBAL_INTEGRATION_REVISION} runtime pre-write-admit --target . --skill context-reload --json. Require active project admission.`));
  add(path.join(home, 'bin', 'global-runtime-store.mjs'), read('src/application/install/global-runtime-store.mjs')
    .replace('../../lib/fs/atomic-write-lib.mjs', './atomic-write-lib.mjs'));
  add(path.join(home, 'bin', 'atomic-write-lib.mjs'), read('src/lib/fs/atomic-write-lib.mjs'));
  add(path.join(home, 'bin', 'global-launcher.mjs'), read('tools/setup/global-launcher.mjs'));
  add(path.join(home, 'bin', 'aidn.cmd'), '@echo off\r\nnode "%~dp0global-launcher.mjs" %*\r\nexit /b %errorlevel%\r\n');
  add(path.join(home, 'bin', 'aidn-setup.cmd'), '@echo off\r\ncall "%~dp0aidn.cmd" setup %*\r\nexit /b %errorlevel%\r\n');
  return assets;
}
