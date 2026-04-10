#!/usr/bin/env node
import fs from "node:fs";
import {
  POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION,
  getPostgresRuntimeRelationalSchemaFile,
  getPostgresRuntimeRelationalTargetContract,
} from "../../src/application/runtime/postgres-runtime-persistence-contract-service.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const contract = getPostgresRuntimeRelationalTargetContract({
      connectionRef: "env:AIDN_PG_URL",
      env: {
        AIDN_PG_URL: "postgres://aidn:test@localhost:5432/aidn",
      },
    });
    const schemaFile = getPostgresRuntimeRelationalSchemaFile();
    const schemaSql = fs.readFileSync(schemaFile, "utf8");
    const targetNames = new Set(contract.target_entities.map((entity) => entity.name));
    const sqliteCanonicalNames = new Set(contract.sqlite_canonical_entities.map((entity) => entity.name));

    assert(contract.schema_version === POSTGRES_RUNTIME_RELATIONAL_TARGET_SCHEMA_VERSION, "expected relational target schema version 2");
    assert(contract.policy.canonical_storage === "relational", "expected relational canonical storage policy");
    assert(contract.policy.runtime_snapshots === "explicit_legacy_fallback_only", "expected runtime_snapshots deprecation policy");
    assert(contract.legacy_snapshot_entities.some((entity) => entity.name === "runtime_snapshots"), "expected runtime_snapshots to stay legacy-only");

    for (const name of sqliteCanonicalNames) {
      assert(targetNames.has(name), `expected relational target to cover SQLite canonical entity ${name}`);
    }

    for (const entity of contract.target_entities) {
      const qualifiedName = `aidn_runtime.${entity.name}`;
      assert(schemaSql.includes(qualifiedName), `expected relational schema file to declare ${qualifiedName}`);
    }

    assert(contract.target_entities.some((entity) => entity.name === "adoption_events" && entity.classification === "admin"), "expected symmetric admin adoption_events");
    assert(contract.target_entities.some((entity) => entity.name === "runtime_heads" && entity.classification === "optimization"), "expected symmetric runtime_heads optimization");
    assert(contract.parity_required_entity_names.includes("artifacts"), "expected artifacts parity requirement");
    assert(contract.parity_required_entity_names.includes("v_materializable_artifacts"), "expected materialization parity requirement");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
