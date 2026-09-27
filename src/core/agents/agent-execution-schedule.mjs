// Pure, deterministic graph projection. No clock, I/O, or mutable authority.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fail(code) { throw Object.assign(new TypeError(code), { code }); }

export function buildAgentExecutionSchedule(tasks) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 256) fail("SCHEDULE_TASKS_INVALID");
  const dependencies = Object.create(null), children = Object.create(null);
  for (const task of tasks) {
    if (!task || typeof task.task_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(task.task_id)
      || Object.hasOwn(dependencies, task.task_id)) fail("SCHEDULE_ID_INVALID");
    if (!Array.isArray(task.depends_on) || new Set(task.depends_on).size !== task.depends_on.length) fail("SCHEDULE_DEPENDENCIES_INVALID");
    dependencies[task.task_id] = [...task.depends_on].sort(compare);
    children[task.task_id] = [];
  }
  const remaining = new Map();
  for (const [id, parents] of Object.entries(dependencies)) {
    remaining.set(id, parents.length);
    for (const parent of parents) {
      if (!Object.hasOwn(children, parent)) fail("SCHEDULE_UNKNOWN_DEPENDENCY");
      children[parent].push(id);
    }
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id).sort(compare), order = [];
  while (ready.length) {
    const id = ready.shift(); order.push(id);
    for (const child of children[id]) {
      remaining.set(child, remaining.get(child) - 1);
      if (remaining.get(child) === 0) { ready.push(child); ready.sort(compare); }
    }
  }
  if (order.length !== tasks.length) fail("SCHEDULE_DEPENDENCY_CYCLE");
  for (const value of Object.values(dependencies)) Object.freeze(value);
  for (const value of Object.values(children)) Object.freeze(value.sort(compare));
  return Object.freeze({ order: Object.freeze(order), dependencies: Object.freeze(dependencies), children: Object.freeze(children) });
}

// A failure blocks descendants, but never an unrelated node. Callers derive
// these sets from PostgreSQL; this projection cannot grant acceptance itself.
export function projectAgentExecutionSchedule(graph, { attempted = [], integrated = [], failed = [] } = {}) {
  const known = new Set(graph.order), tried = new Set(attempted), done = new Set(integrated), rejected = new Set(failed);
  for (const id of [...tried, ...done, ...rejected]) if (!known.has(id)) fail("SCHEDULE_FOREIGN_TASK");
  const blocked = new Set();
  for (const id of graph.order) if (graph.dependencies[id].some(parent => rejected.has(parent) || blocked.has(parent))) blocked.add(id);
  const ready = graph.order.filter(id => !tried.has(id) && !rejected.has(id) && !blocked.has(id)
    && graph.dependencies[id].every(parent => done.has(parent)));
  const nextIntegration = graph.order.find(id => !done.has(id) && !rejected.has(id) && !blocked.has(id)) ?? null;
  return { ready, blocked: graph.order.filter(id => blocked.has(id)), nextIntegration };
}
