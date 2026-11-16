// Node's Number stat fields can merge adjacent NTFS identities above 2**53.
// Require bigint observations and serialize identifiers/times losslessly.
export function exactFileIdentity(stat) {
  const fields = ["dev", "ino", "size", "nlink", "mode", "mtimeNs", "ctimeNs"];
  if (!stat || fields.some(key => typeof stat[key] !== "bigint")
    || ["dev", "ino"].some(key => stat[key] < -(1n << 63n) || stat[key] >= (1n << 64n))
    || ["size", "nlink", "mode"].some(key => stat[key] < 0n)
    || stat.size > BigInt(Number.MAX_SAFE_INTEGER) || stat.nlink > BigInt(Number.MAX_SAFE_INTEGER)
    || stat.mode > BigInt(Number.MAX_SAFE_INTEGER))
    throw Object.assign(new Error("EXACT_FILE_IDENTITY_REQUIRED"), { code: "EXACT_FILE_IDENTITY_REQUIRED" });
  // Node exposes uint64 device/inode bits through a signed BigInt64Array.
  // Restore the unsigned identifier without Number conversion or truncation.
  return { dev: BigInt.asUintN(64, stat.dev).toString(), ino: BigInt.asUintN(64, stat.ino).toString(),
    size: Number(stat.size), nlink: Number(stat.nlink), mode: Number(stat.mode),
    mtime_ns: stat.mtimeNs.toString(), ctime_ns: stat.ctimeNs.toString() };
}
