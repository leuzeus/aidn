import { AsyncLocalStorage } from "node:async_hooks";

// Only the application host installs this capability. Nothing in model JSON,
// a scenario, or an output envelope can select a declaration/closure writer.
const context = new AsyncLocalStorage();
export const withStandardDispatchContext = (capability, effect) => context.run(capability, effect);
export const currentStandardDispatchContext = () => context.getStore() ?? null;
