import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadBytes, downloadReleasePackage, releasePackagePlan } from '../setup/github-release-package.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-release-download-'));
try {
  const plan = releasePackagePlan('0.8.0');
  for (const version of ['latest', 'v0.8.0', '0.8.0-beta', '01.8.0', '../0.8.0']) assert.throws(() => releasePackagePlan(version));
  const bytes = Buffer.from('fixture package bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const manifest = { schema_version: 2, package_name: 'aidn-workflow', version: '0.8.0', git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40),
    source: { tracked_tree_only: true, clean_checkout_required: true },
    artifacts: [{ name: plan.name, path: `release/dist/${plan.name}`, sha256: sha, bytes: bytes.length }] };
  const release = { tag_name: plan.tag, draft: false, prerelease: false, assets:
    [[plan.name, plan.packageUrl], ['manifest.json', plan.manifestUrl], ['checksums.txt', plan.checksumsUrl]]
      .map(([name, browser_download_url]) => ({ name, browser_download_url, size: bytes.length })) };
  const entries = new Map([[plan.apiUrl, Buffer.from(JSON.stringify(release))], [plan.manifestUrl, Buffer.from(JSON.stringify(manifest))],
    [plan.checksumsUrl, Buffer.from(`${sha}  release/dist/${plan.name}\n`)], [plan.packageUrl, bytes]]);
  const read = async (url) => entries.get(url);
  const cacheRoot = path.join(root, 'cache');
  const result = await downloadReleasePackage('0.8.0', { read, cacheRoot });
  assert.deepEqual(fs.readFileSync(result.packagePath), bytes);
  assert.equal(result.packageUrl, plan.packageUrl);
  assert.equal(result.packageIntegrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
  assert.deepEqual(await downloadReleasePackage('0.8.0', { read, cacheRoot }), result);
  for (const [url, bad] of [
    [plan.packageUrl, Buffer.from('tampered package!!!!!')],
    [plan.checksumsUrl, Buffer.from(`${'0'.repeat(64)}  release/dist/${plan.name}\n`)],
    [plan.apiUrl, Buffer.from(JSON.stringify({ ...release, draft: true }))],
    [plan.apiUrl, Buffer.from(JSON.stringify({ ...release, prerelease: true }))],
    [plan.apiUrl, Buffer.from(JSON.stringify({ ...release, assets: [] }))],
    [plan.apiUrl, Buffer.from(JSON.stringify({ ...release, assets: [...release.assets, release.assets[0]] }))],
    [plan.manifestUrl, Buffer.from(JSON.stringify({ ...manifest, version: '0.9.0' }))],
  ]) {
    const rejectedCache = path.join(root, 'rejected');
    await assert.rejects(downloadReleasePackage('0.8.0', { cacheRoot: rejectedCache, read: async (key) => key === url ? bad : read(key) }));
    assert(!fs.existsSync(rejectedCache), 'invalid release must not enter cache');
  }
  fs.writeFileSync(result.packagePath, 'cache tampering');
  await assert.rejects(downloadReleasePackage('0.8.0', { read, cacheRoot }), /CACHE_CONFLICT/);
  const fetchImpl = async () => new Response('12345');
  await assert.rejects(downloadBytes(plan.packageUrl, 4, { fetchImpl }), /TOO_LARGE/);
  assert.equal((await downloadBytes(plan.packageUrl, 5, { fetchImpl })).toString(), '12345');
  for (const location of ['http://github.com/file', 'https://untrusted.example/file']) {
    await assert.rejects(downloadBytes(plan.packageUrl, 100, { fetchImpl: async () => new Response(null, { status: 302, headers: { location } }) }), /ORIGIN_REJECTED/);
  }
  await assert.rejects(downloadBytes(plan.packageUrl, 100, { fetchImpl: async () => new Response(null, { status: 404 }) }), /HTTP_404/);
  await assert.rejects(downloadBytes(plan.packageUrl, 100, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: plan.packageUrl } }) }), /REDIRECT_LIMIT/);
  console.log(JSON.stringify({ ok: true, proof_class: 'fixture', checks: ['exact-version', 'verified-cache-and-retry', 'tampered-or-incomplete-release-refused-before-cache', 'https-origin-size-redirect-bounds'] }));
} finally {
  const cleanup = removePathWithRetry(root);
  if (!cleanup.ok) throw cleanup.error;
}
