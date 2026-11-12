let parents, replacements, active = true;
export function initialize({ targets, mocked, port }) {
  active = true;
  parents = new Set(targets);
  replacements = mocked;
  port.on("message", message => {
    if (message !== "deactivate") throw new Error("FIXTURE_MODULE_MOCK_MESSAGE_INVALID");
    active = false;
    port.postMessage("inactive");
    port.close();
  });
  port.unref();
}
export function resolve(specifier, context, nextResolve) {
  if (active && parents.has(context.parentURL) && Object.hasOwn(replacements, specifier))
    return { url: "data:text/javascript," + encodeURIComponent(replacements[specifier]), shortCircuit: true };
  return nextResolve(specifier, context);
}
