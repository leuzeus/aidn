import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function writeFileAtomicSync(filePath, content, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  const encoding = options.encoding ?? null;
  const mode = options.mode;
  fsImpl.mkdirSync(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let fileDescriptor = null;
  try {
    fileDescriptor = fsImpl.openSync(temporaryPath, "wx", mode);
    if (encoding) {
      fsImpl.writeFileSync(fileDescriptor, content, { encoding });
    } else {
      fsImpl.writeFileSync(fileDescriptor, content);
    }
    if (typeof fsImpl.fsyncSync === "function") {
      fsImpl.fsyncSync(fileDescriptor);
    }
    fsImpl.closeSync(fileDescriptor);
    fileDescriptor = null;
    fsImpl.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (fileDescriptor != null) {
      fsImpl.closeSync(fileDescriptor);
    }
    fsImpl.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return absolutePath;
}
