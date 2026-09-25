// Private PowerShell/Node bridge. No public aidn command or JSON API is added.
import { inspectProject, updateStatus } from './installed-project.mjs';
import { resolveReleaseVersion } from './github-release-package.mjs';
import { readProjects, rememberProject, forgetProject } from './project-registry.mjs';
import { updateProject } from './update-project.mjs';
import { installUserSetup } from './install-user-setup.mjs';
const [action, ...args] = process.argv.slice(2);
try {
  let result;
  if (action === 'inspect') result = inspectProject(args[0]);
  else if (action === 'resolve') result = { version: await resolveReleaseVersion(args[0]) };
  else if (action === 'check') {
    const installation = inspectProject(args[0]);
    const version = await resolveReleaseVersion(args[1] || 'latest');
    result = { ...installation, version, status: updateStatus(installation, version) };
  } else if (action === 'list') result = readProjects();
  else if (action === 'remember' && args[1] === '--write') {
    if (inspectProject(args[0]).state !== 'installed') throw new Error('VERIFIED_INSTALLATION_REQUIRED');
    result = rememberProject(args[0]);
  } else if (action === 'forget' && args[1] === '--write') result = forgetProject(args[0]);
  else if (action === 'install-setup') result = installUserSetup({ write: args[0] === '--write' });
  else if (action === 'update') result = await updateProject({ target: args[0], version: args[1], fingerprint: args[2], write: args[3] === '--write',
    ...(args[4] ? { localPackage: { packagePath: args[4], packageSha256: args[5] } } : {}) }, { log: () => {} });
  else throw new Error('INVALID_SETUP_ACTION');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'SETUP_OPERATION_FAILED');
  process.exitCode = 1;
}
