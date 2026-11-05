import assert from "node:assert/strict";

// File identities stay decimal strings: NTFS inode values may exceed 2**53.
// Consumers must obtain this observation with lstat({ bigint: true }).
export function fixturePhysicalStat(stat, { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes >= 0, "FIXTURE_STAT_BYTE_BOUND_INVALID");
  assert.ok([stat.dev, stat.ino, stat.mode, stat.size].every(value => typeof value === "bigint" && value >= 0n), "FIXTURE_BIGINT_STAT_REQUIRED");
  assert.ok(stat.mode <= 0xffffffffn, "FIXTURE_STAT_MODE_BOUND");
  assert.ok(stat.size <= BigInt(maxBytes), "FIXTURE_STAT_BYTE_BOUND");
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), mode: Number(stat.mode), bytes: Number(stat.size) };
}
