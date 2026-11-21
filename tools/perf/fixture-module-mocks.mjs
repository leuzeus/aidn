import assert from "node:assert/strict";
import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";

// Fixture-only resolution: exact queried parents, authored module text, and
// explicit deactivation. The evaluated data modules keep the main realm's
// globalThis ports; the loader thread never receives those mutable ports.
let serial = 0;
export function registerFixtureModuleMocks({ targets, mocked }) {
  assert.ok(Array.isArray(targets) && targets.length && targets.every(value => typeof value === "string"));
  assert.ok(mocked && Object.values(mocked).every(value => typeof value === "string"));
  const { port1, port2 } = new MessageChannel();
  const loader = new URL("./fixture-module-mocks-loader.mjs", import.meta.url);
  loader.searchParams.set("scope", String(++serial));
  register(loader, {
    data: { targets, mocked, port: port2 }, transferList: [port2],
  });
  port1.unref();
  let closing = null;
  return Object.freeze({
    deregister() {
      return closing ??= new Promise((resolve, reject) => {
        const failed = () => reject(new Error("FIXTURE_MODULE_MOCK_DEACTIVATION_FAILED"));
        port1.once("message", message => {
          if (message !== "inactive") { failed(); return; }
          port1.removeListener("close", failed);
          port1.close();
          resolve();
        });
        port1.once("close", failed);
        port1.ref();
        port1.postMessage("deactivate");
      });
    },
  });
}
