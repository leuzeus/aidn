#!/usr/bin/env node
import { createDaemonPostgresPool } from "../../src/application/runtime/daemon-postgres-pool-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakePoolFactory() {
  const state = {
    pools_created: 0,
    connects: 0,
    releases: 0,
    closes: 0,
    queries: [],
  };
  return {
    state,
    factory({ connectionString }) {
      state.pools_created += 1;
      return {
        async connect() {
          state.connects += 1;
          return {
            async query(text, values = []) {
              state.queries.push({
                connectionString,
                text: String(text),
                values,
              });
              return {
                rows: [{ ok: true }],
              };
            },
            release() {
              state.releases += 1;
            },
          };
        },
        async end() {
          state.closes += 1;
        },
      };
    },
  };
}

async function main() {
  try {
    const fake = createFakePoolFactory();
    const pool = createDaemonPostgresPool({
      poolFactory: fake.factory,
      max: 2,
      idleTimeoutMillis: 1000,
    });
    const clientFactory = pool.getClientFactory();

    const first = await clientFactory({ connectionString: "postgres://example/runtime-a" });
    await first.connect();
    await first.query("SELECT 1", []);
    await first.end();

    const second = await clientFactory({ connectionString: "postgres://example/runtime-a" });
    await second.connect();
    await second.query("SELECT 2", []);
    await second.end();

    const third = await clientFactory({ connectionString: "postgres://example/runtime-b" });
    await third.connect();
    await third.query("SELECT 3", []);
    await third.end();

    const statsBeforeClose = pool.getStats();
    await pool.closeAll();
    const statsAfterClose = pool.getStats();

    const checks = {
      reused_same_connection_pool: fake.state.pools_created === 2
        && statsBeforeClose.pool_hits === 1
        && statsBeforeClose.pool_misses === 2,
      leases_released: fake.state.connects === 3
        && fake.state.releases === 3
        && statsBeforeClose.leases_created === 3
        && statsBeforeClose.leases_released === 3,
      close_drains_pools: fake.state.closes === 2
        && statsAfterClose.entries === 0
        && statsAfterClose.close_count === 2,
      queries_preserve_connection_routing: fake.state.queries[0]?.connectionString === "postgres://example/runtime-a"
        && fake.state.queries[1]?.connectionString === "postgres://example/runtime-a"
        && fake.state.queries[2]?.connectionString === "postgres://example/runtime-b",
    };
    for (const [name, passed] of Object.entries(checks)) {
      assert(passed, `failed check: ${name}; sample=${JSON.stringify({
        fake: fake.state,
        stats_before_close: statsBeforeClose,
        stats_after_close: statsAfterClose,
      })}`);
    }
    console.log("PASS daemon postgres pool fixture checks");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

await main();
