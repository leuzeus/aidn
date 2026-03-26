import fs from "node:fs";

function isRetryableRemoveError(error) {
  return error && (error.code === "EPERM" || error.code === "EBUSY" || error.code === "ENOTEMPTY");
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

export function removePathWithRetry(target, options = {}) {
  const retries = Number(options.retries ?? 5);
  const retryDelayMs = Number(options.retryDelayMs ?? 50);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt === retries) {
        throw error;
      }
      lastError = error;
      sleepMs(retryDelayMs * (attempt + 1));
    }
  }
  if (lastError) {
    throw lastError;
  }
}
