import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function writeFileAtomicSync(filePath, content, options = {}) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  const encoding = options.encoding ?? null;
  const mode = options.mode;
  fs.mkdirSync(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let fileDescriptor = null;
  try {
    fileDescriptor = fs.openSync(temporaryPath, "wx", mode);
    if (encoding) {
      fs.writeFileSync(fileDescriptor, content, { encoding });
    } else {
      fs.writeFileSync(fileDescriptor, content);
    }
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = null;
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (fileDescriptor != null) {
      fs.closeSync(fileDescriptor);
    }
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return absolutePath;
}
