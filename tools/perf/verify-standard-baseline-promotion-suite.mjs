import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const repo = fileURLToPath(new URL("../../", import.meta.url));
// Existing required promotion gate owns these isolated temp-client components.
// No native/human authority or complete workflow claim follows from them.
export async function verifyStandardBaselinePromotionComponent() {
  const cases = [{ id: "pure", script: "verify-standard-baseline-promotion-fixtures.mjs", args: [] },
    ...["files", "dual", "db-only", "partial", "projection", "source", "instance", "revoked", "revoked-post"]
      .map(mode => ({ id: mode, script: "verify-standard-baseline-promotion-ports-fixtures.mjs", args: ["--mode=" + mode] }))];
  const results = [];
  for (const row of cases) {
    const data = execFileSync(process.execPath, [path.join(repo, "tools/perf", row.script), ...row.args, "--json"], {
      cwd: repo, env: { ...process.env, AIDN_STATE_MODE: "", AIDN_INDEX_STORE_MODE: "" },
      encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 600000, maxBuffer: 1048576,
    });
    const result = JSON.parse(data); assert.equal(result.status, "PASS", row.id); assert.ok(Number.isInteger(result.checks) && result.checks > 0, row.id);
    assert.equal(result.native, "NOT_RUN"); assert.equal(result.installed_archive, "NOT_RUN");
    results.push({ id: row.id, status: result.status, checks: result.checks,
      proof: result.proof, human_and_closure_authority: result.human_and_closure_authority ?? "NOT_RUN" });
  }
  return { status: "PASS", cases: results, native: "NOT_RUN", installed_archive: "NOT_RUN", mixed_host: "NOT_RUN", final_hook: "NOT_RUN" };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await verifyStandardBaselinePromotionComponent()));
