#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildNextAidnProjectConfig } from "../../src/application/install/project-config-service.mjs";
import { writeAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function runJson(args, env = process.env) {
  const stdout = execFileSync(process.execPath, [
    path.resolve(process.cwd(), "bin/aidn.mjs"),
    ...args,
  ], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-persistence-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });

    const nextConfig = buildNextAidnProjectConfig(
      {},
      {
        store: "dual-sqlite",
        stateMode: "dual",
      },
      {},
    );
    writeAidnProjectConfig(targetRoot, nextConfig);

    const sqliteStatus = runJson([
      "runtime",
      "db-status",
      "--target",
      targetRoot,
      "--json",
    ]);

    const postgresConfig = JSON.parse(JSON.stringify(nextConfig));
    postgresConfig.runtime.persistence.backend = "postgres";
    writeAidnProjectConfig(targetRoot, postgresConfig);

    const postgresStatus = runJson([
      "runtime",
      "persistence-status",
      "--target",
      targetRoot,
      "--json",
    ]);

    const envOverrideStatus = runJson([
      "runtime",
      "persistence-status",
      "--target",
      targetRoot,
      "--json",
    ], {
      ...process.env,
      AIDN_RUNTIME_PERSISTENCE_BACKEND: "sqlite",
    });

    const checks = {
      config_builder_sets_runtime_persistence_backend: String(nextConfig?.runtime?.persistence?.backend ?? "") === "sqlite",
      config_builder_sets_local_projection_policy: String(nextConfig?.runtime?.persistence?.localProjectionPolicy ?? "") === "keep-local-sqlite",
      sqlite_status_uses_config_runtime_backend: sqliteStatus?.runtime_persistence?.backend === "sqlite" && sqliteStatus?.runtime_persistence?.source === "config-runtime-persistence",
      postgres_status_uses_config_runtime_backend: postgresStatus?.runtime_persistence?.backend === "postgres" && postgresStatus?.runtime_persistence?.source === "config-runtime-persistence",
      postgres_status_reports_missing_connection: postgresStatus?.supported === false && /connection reference configured/i.test(String(postgresStatus?.reason ?? "")),
      postgres_status_exposes_adoption_plan: postgresStatus?.runtime_backend_adoption_plan?.action === "blocked-conflict" && postgresStatus?.runtime_backend_adoption_plan?.reason_code === "target-unavailable",
      env_override_wins_over_config: envOverrideStatus?.runtime_persistence?.backend === "sqlite" && envOverrideStatus?.runtime_persistence?.source === "env",
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        sqlite_status: {
          runtime_persistence: sqliteStatus?.runtime_persistence ?? null,
          runtime_backend: sqliteStatus?.runtime_backend ?? null,
        },
        postgres_status: {
          runtime_persistence: postgresStatus?.runtime_persistence ?? null,
          runtime_backend: postgresStatus?.runtime_backend ?? null,
          reason: postgresStatus?.reason ?? null,
          adoption_plan: postgresStatus?.runtime_backend_adoption_plan ?? null,
        },
        env_override_status: {
          runtime_persistence: envOverrideStatus?.runtime_persistence ?? null,
        },
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
