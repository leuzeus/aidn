#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../../src/lib/fs/atomic-write-lib.mjs";
import {
  buildSurfaceCatalog,
  SURFACE_CATALOG_PATH,
} from "./surface-catalog-lib.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const write = process.argv.includes("--write");
const catalog = buildSurfaceCatalog(repoRoot);
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
const target = path.join(repoRoot, SURFACE_CATALOG_PATH);

if (write) {
  writeFileAtomicSync(target, serialized, { encoding: "utf8" });
  console.log(`WROTE ${SURFACE_CATALOG_PATH} (${catalog.entries.length} entries)`);
} else {
  process.stdout.write(serialized);
}
