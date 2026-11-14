import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const hash = data => createHash("sha256").update(data).digest("hex");
const bounded = error => /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code ?? "") ? error.code : "UNKNOWN";

// Replacement must be on the product volume. Control/evidence roots may live
// on another drive; renameSync cannot move a staged file across that boundary.
export function republishBrokerProductFile(original, data, { fsPort = fs } = {}) {
  const staged = path.join(path.dirname(original), `.aidn-broker-${randomUUID()}.tmp`);
  let fd = null, created = false, moved = false, failure = null;
  try {
    fd = fsPort.openSync(staged, "wx", 0o600); created = true;
    fsPort.writeFileSync(fd, data); fsPort.closeSync(fd); fd = null;
    if (hash(fsPort.readFileSync(staged)) !== hash(data)) throw Object.assign(Error("broker bytes changed"), { code: "BROKER_BYTES_CHANGED" });
    fsPort.renameSync(staged, original); moved = true;
    if (hash(fsPort.readFileSync(original)) !== hash(data)) throw Object.assign(Error("broker bytes changed"), { code: "BROKER_BYTES_CHANGED" });
  } catch (error) {
    failure = Object.assign(Error("PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED"), {
      code: "PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED", fs_code: bounded(error), path_sha256: hash(Buffer.from(original)) });
  } finally {
    if (fd !== null) try { fsPort.closeSync(fd); } catch (error) {
      failure ??= Object.assign(Error("PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED"), { code: "PROCESS_EXECUTION_BROKER_REPUBLISH_FAILED", fs_code: bounded(error), path_sha256: hash(Buffer.from(original)) });
    }
    if (created && !moved) try { fsPort.unlinkSync(staged); } catch (error) {
      if (error.code !== "ENOENT" && failure) failure.cleanup_fs_code = bounded(error);
    }
  }
  if (failure) throw failure;
}
