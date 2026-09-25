import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = (code) => { throw new Error(code); };
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const allowedHosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export function releasePackagePlan(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) fail('EXACT_STABLE_RELEASE_VERSION_REQUIRED');
  const tag = `v${version}`, name = `aidn-workflow-${version}.tgz`;
  const base = `https://github.com/leuzeus/aidn/releases/download/${tag}`;
  return { version, tag, name, apiUrl: `https://api.github.com/repos/leuzeus/aidn/releases/tags/${tag}`,
    packageUrl: `${base}/${name}`, manifestUrl: `${base}/manifest.json`, checksumsUrl: `${base}/checksums.txt` };
}

export async function resolveReleaseVersion(version, { read = downloadBytes } = {}) {
  if (/^latest$/i.test(version)) version = 'latest';
  const url = version === 'latest' ? 'https://api.github.com/repos/leuzeus/aidn/releases/latest' : releasePackagePlan(version).apiUrl;
  const release = JSON.parse((await read(url, 2 * 1024 * 1024)).toString('utf8'));
  const selected = version === 'latest' ? String(release.tag_name || '').replace(/^v/, '') : version;
  const plan = releasePackagePlan(selected);
  if (release.tag_name !== plan.tag || release.draft !== false || release.prerelease !== false) fail('RELEASE_NOT_PUBLISHED_STABLE');
  for (const [name, target] of [[plan.name, plan.packageUrl], ['manifest.json', plan.manifestUrl], ['checksums.txt', plan.checksumsUrl]]) {
    const assets = release.assets?.filter(asset => asset.name === name) ?? [];
    if (assets.length !== 1 || assets[0].browser_download_url !== target) fail('RELEASE_ASSET_MISSING_OR_AMBIGUOUS');
  }
  return selected;
}

export async function downloadBytes(url, limit, { fetchImpl = fetch } = {}) {
  for (let redirect = 0; redirect <= 5; redirect++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !allowedHosts.has(target.hostname) || target.username || target.password) fail('RELEASE_DOWNLOAD_ORIGIN_REJECTED');
    const response = await fetchImpl(target.href, { redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'aidn-project-setup', Accept: target.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) fail('RELEASE_REDIRECT_INVALID');
      url = new URL(location, target).href;
      continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); fail(`RELEASE_HTTP_${response.status}`); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('RELEASE_DOWNLOAD_TOO_LARGE'); }
    if (!response.body) fail('RELEASE_DOWNLOAD_EMPTY');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) fail('RELEASE_DOWNLOAD_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  fail('RELEASE_REDIRECT_LIMIT');
}

export function verifyReleaseMetadata(plan, release, manifest, checksums) {
  if (release.tag_name !== plan.tag || release.draft !== false || release.prerelease !== false) fail('RELEASE_NOT_PUBLISHED_STABLE');
  for (const [name, url] of [[plan.name, plan.packageUrl], ['manifest.json', plan.manifestUrl], ['checksums.txt', plan.checksumsUrl]]) {
    const matches = release.assets?.filter((asset) => asset.name === name) ?? [];
    if (matches.length !== 1 || matches[0].browser_download_url !== url) fail('RELEASE_ASSET_MISSING_OR_AMBIGUOUS');
  }
  if (manifest.schema_version !== 2 || manifest.package_name !== 'aidn-workflow' || manifest.version !== plan.version
      || !/^[a-f0-9]{40}$/.test(manifest.git_commit || '') || !/^[a-f0-9]{40}$/.test(manifest.git_tree || '')
      || manifest.source?.tracked_tree_only !== true || manifest.source?.clean_checkout_required !== true) fail('RELEASE_MANIFEST_INVALID');
  const artifacts = manifest.artifacts?.filter((artifact) => artifact.name === plan.name) ?? [];
  const artifact = artifacts[0];
  if (artifacts.length !== 1 || artifact.path !== `release/dist/${plan.name}` || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > 64 * 1024 * 1024) fail('RELEASE_TARBALL_MANIFEST_INVALID');
  if (release.assets.find((asset) => asset.name === plan.name).size !== artifact.bytes) fail('RELEASE_ASSET_SIZE_MISMATCH');
  const entries = checksums.trim().split(/\r?\n/).map((line) => /^([a-f0-9]{64}) {2}(.+)$/.exec(line));
  const matches = entries.filter((entry) => entry?.[2] === artifact.path);
  if (entries.some((entry) => !entry) || matches.length !== 1 || matches[0][1] !== artifact.sha256) fail('RELEASE_CHECKSUMS_MISMATCH');
  return artifact;
}

export async function downloadReleasePackage(version, { read = downloadBytes,
  cacheRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), 'AIDN', 'packages') } = {}) {
  const plan = releasePackagePlan(version);
  const release = JSON.parse((await read(plan.apiUrl, 2 * 1024 * 1024)).toString('utf8'));
  // Refuse missing, draft or incomplete releases before fetching their assets.
  if (release.tag_name !== plan.tag || release.draft !== false || release.prerelease !== false) fail('RELEASE_NOT_PUBLISHED_STABLE');
  const manifestBytes = await read(plan.manifestUrl, 2 * 1024 * 1024);
  const checksumsBytes = await read(plan.checksumsUrl, 16384);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const artifact = verifyReleaseMetadata(plan, release, manifest, checksumsBytes.toString('utf8'));
  const bytes = await read(plan.packageUrl, artifact.bytes);
  if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) fail('RELEASE_TARBALL_HASH_MISMATCH');
  // Only verified bytes enter the durable cache. npm records the HTTPS URL,
  // never this host-specific cache path, in the project's lockfile.
  const directory = path.join(cacheRoot, version, artifact.sha256);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of [[plan.name, bytes], ['manifest.json', manifestBytes], ['checksums.txt', checksumsBytes]]) {
    const file = path.join(directory, name);
    try { fs.writeFileSync(file, content, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST' || digest(fs.readFileSync(file)) !== digest(content)) fail('RELEASE_CACHE_CONFLICT');
    }
  }
  return { packagePath: path.join(directory, plan.name), packageSha256: artifact.sha256,
    packageUrl: plan.packageUrl, packageIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    releaseCommit: manifest.git_commit };
}
