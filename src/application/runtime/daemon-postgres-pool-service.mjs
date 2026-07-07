import crypto from "node:crypto";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function hashConnectionRef(connectionString) {
  const normalized = normalizeScalar(connectionString);
  if (!normalized) {
    return "none";
  }
  return `pg-${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

async function loadPgModule(moduleLoader) {
  if (typeof moduleLoader === "function") {
    return moduleLoader("pg");
  }
  return import("pg");
}

export function createDaemonPostgresPool({
  moduleLoader = null,
  poolFactory = null,
  max = 4,
  idleTimeoutMillis = 30000,
} = {}) {
  const pools = new Map();
  const stats = {
    pool_hits: 0,
    pool_misses: 0,
    pools_created: 0,
    leases_created: 0,
    leases_released: 0,
    close_count: 0,
    errors: 0,
  };

  async function createPool(connectionString) {
    if (typeof poolFactory === "function") {
      return poolFactory({
        connectionString,
        max,
        idleTimeoutMillis,
      });
    }
    const pgModule = await loadPgModule(moduleLoader);
    const Pool = pgModule?.Pool ?? pgModule?.default?.Pool;
    if (typeof Pool !== "function") {
      throw new Error("The pg package does not expose a Pool constructor");
    }
    return new Pool({
      connectionString,
      max,
      idleTimeoutMillis,
    });
  }

  async function resolvePool(connectionString) {
    const normalizedConnectionString = normalizeScalar(connectionString);
    const key = hashConnectionRef(normalizedConnectionString);
    const existing = pools.get(key);
    if (existing) {
      stats.pool_hits += 1;
      return existing.pool;
    }
    stats.pool_misses += 1;
    const pool = await createPool(normalizedConnectionString);
    pools.set(key, {
      key,
      pool,
    });
    stats.pools_created += 1;
    return pool;
  }

  async function createPooledClient({ connectionString }) {
    const normalizedConnectionString = normalizeScalar(connectionString);
    let leasedClient = null;
    let released = false;
    return {
      async connect() {
        if (leasedClient) {
          return;
        }
        try {
          const pool = await resolvePool(normalizedConnectionString);
          leasedClient = await pool.connect();
          stats.leases_created += 1;
        } catch (error) {
          stats.errors += 1;
          throw error;
        }
      },
      async query(text, values = []) {
        if (!leasedClient) {
          await this.connect();
        }
        return leasedClient.query(text, values);
      },
      async end() {
        if (!leasedClient || released) {
          return;
        }
        released = true;
        if (typeof leasedClient.release === "function") {
          leasedClient.release();
        } else if (typeof leasedClient.end === "function") {
          await leasedClient.end();
        }
        stats.leases_released += 1;
      },
    };
  }

  async function closeAll() {
    const entries = Array.from(pools.values());
    pools.clear();
    for (const entry of entries) {
      if (typeof entry.pool?.end === "function") {
        await entry.pool.end();
      }
      stats.close_count += 1;
    }
  }

  return {
    getClientFactory() {
      return createPooledClient;
    },
    getStats() {
      return {
        entries: pools.size,
        ...stats,
      };
    },
    async closeAll() {
      await closeAll();
    },
  };
}
