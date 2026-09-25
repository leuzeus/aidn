import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';

const refuse = (code) => { throw new Error(code); };
export function parseConnection(value) {
  let url;
  try { url = new URL(value); } catch { refuse('POSTGRES_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) refuse('POSTGRES_URL_INVALID');
  let role, database, password;
  try { role = decodeURIComponent(url.username); database = decodeURIComponent(url.pathname.slice(1)); password = decodeURIComponent(url.password); }
  catch { refuse('POSTGRES_URL_INVALID'); }
  if (![role, database].every((v) => /^[a-z][a-z0-9_]{0,62}$/.test(v)) || !password) refuse('POSTGRES_IDENTITY_INVALID');
  return { url, role, database, password };
}

// PostgreSQL SCRAM verifier: never send the cleartext role password in SQL.
export function scramVerifier(password) {
  // ASCII avoids silently disagreeing with PostgreSQL's SASLprep normalization.
  if (!/^[\x21-\x7e]{16,}$/.test(password)) refuse('NEW_ROLE_PASSWORD_REQUIRES_16_ASCII_CHARACTERS');
  const salt = randomBytes(16), iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const client = createHmac('sha256', salted).update('Client Key').digest();
  const stored = createHash('sha256').update(client).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`;
}

export function validateConnections({ connectionString, adminConnectionString, create }) {
  const runtime = parseConnection(connectionString);
  if (['postgres', 'template0', 'template1'].includes(runtime.database) || runtime.role === 'postgres') refuse('DEDICATED_DATABASE_AND_ROLE_REQUIRED');
  if (create) {
    const admin = parseConnection(adminConnectionString);
    if (![runtime, admin].every((c) => ['127.0.0.1', 'localhost', '[::1]'].includes(c.url.hostname))
        || runtime.url.hostname !== admin.url.hostname || (runtime.url.port || '5432') !== (admin.url.port || '5432')
        || admin.database !== 'postgres' || admin.role === runtime.role || runtime.url.search || admin.url.search) refuse('LOCAL_ADMIN_ENDPOINT_MISMATCH');
    scramVerifier(runtime.password);
  }
  return runtime;
}

export async function preparePostgres(options, { clientFactory }) {
  const runtime = validateConnections(options);
  if (options.create) {
    const admin = clientFactory(options.adminConnectionString);
    try {
      await admin.connect();
      const server = await admin.query('SHOW server_version_num');
      if (!Number.isInteger(options.expectedServerVersion) || Number(server.rows[0]?.server_version_num) !== options.expectedServerVersion) refuse('POSTGRES_SERVER_VERSION_MISMATCH');
      // No DROP, password rotation, privilege adoption or ownership takeover.
      const role = await admin.query('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1', [runtime.role]);
      const db = await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1', [runtime.database]);
      if (db.rows.length && db.rows[0].owner !== runtime.role) refuse('DATABASE_OWNER_CONFLICT');
      if (role.rows.length) {
        if (['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls'].some((key) => role.rows[0][key])) refuse('PROJECT_ROLE_PRIVILEGES_INVALID');
        // Prove existing credentials before creating anything else on a retry.
        const probeUrl = new URL(options.connectionString); probeUrl.pathname = '/postgres';
        const probe = clientFactory(probeUrl.href);
        try { await probe.connect(); } finally { await probe.end(); }
      } else {
        const verifier = scramVerifier(runtime.password);
        await admin.query(`CREATE ROLE "${runtime.role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`);
      }
      if (!db.rows.length) await admin.query(`CREATE DATABASE "${runtime.database}" OWNER "${runtime.role}"`);
    } finally { await admin.end(); }
  }
  const client = clientFactory(options.connectionString);
  try {
    await client.connect();
    const result = await client.query(`SELECT current_user AS role, current_database() AS database,
      r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
      pg_get_userbyid(d.datdba) AS owner
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = current_user`);
    const row = result.rows[0];
    if (!row || row.role !== runtime.role || row.database !== runtime.database || row.owner !== runtime.role
        || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls) refuse('PROJECT_DATABASE_PRIVILEGES_INVALID');
    return { database: runtime.database, role: runtime.role };
  } finally { await client.end(); }
}
