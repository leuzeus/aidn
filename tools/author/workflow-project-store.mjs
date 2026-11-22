import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { writeNewBpmnProject } from "./export-bpmn-project.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { projectDiagramName } from "../../src/core/workflow/bpmn-project-diagram.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";

const limit = 1024 * 1024;
export const projectHash = project => shadowHash([project.manifest, project.diagrams]);
export const refuse = (code, status = 422) => { throw Object.assign(new Error(code), { code, status }); };
const safeName = id => typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);

async function plainDirectory(dir, create = false) {
  if (create) await fs.mkdir(dir).catch(error => { if (error.code !== "EEXIST") throw error; });
  if (await fs.realpath(dir) !== dir || !(await fs.lstat(dir)).isDirectory()) refuse("BPMN_PROJECT_DIRECTORY_INVALID");
  return dir;
}
export async function readLocalFile(dir, file, max = limit) {
  const full = path.join(dir, file), stat = await fs.lstat(full);
  if (!stat.isFile() || stat.size > max || await fs.realpath(full) !== full) refuse("BPMN_PROJECT_FILE_INVALID");
  return fs.readFile(full, "utf8");
}
async function activeDirectory(dir) {
  let generation;
  try { generation = (await readLocalFile(dir, ".aidn-generation", 64)).trim(); }
  catch (error) { if (error.code === "ENOENT") return dir; throw error; }
  if (!/^[a-f0-9-]{36}$/.test(generation)) refuse("BPMN_PROJECT_DIRECTORY_INVALID");
  return plainDirectory(path.join(dir, ".aidn-generations", generation));
}
export async function readEditorProject(dir) {
  const current = await activeDirectory(dir);
  const manifest = JSON.parse(await readLocalFile(current, "manifest.json"));
  if (!Array.isArray(manifest.models) || manifest.models.length > 33) refuse("BPMN_PROJECT_MANIFEST_INVALID");
  const diagrams = {};
  let bytes = 0;
  for (const row of manifest.models) {
    if (!safeName(row?.model_id) || !Number.isSafeInteger(row.revision) || row.revision < 1) refuse("BPMN_PROJECT_FILENAME_INVALID");
    const file = projectDiagramName(row);
    diagrams[file] = await readLocalFile(current, file);
    if ((bytes += Buffer.byteLength(diagrams[file])) > 8 * limit) refuse("BPMN_PROJECT_LIMIT");
  }
  return { manifest, diagrams };
}

async function exclusive(dir, action) {
  // The kernel releases the project writer endpoint if its owner exits. No
  // user data or authorization crosses this endpoint.
  const key = createHash("sha256").update(process.platform === "win32" ? dir.toLowerCase() : dir).digest("hex").slice(0, 32);
  const address = process.platform === "win32" ? "\\\\.\\pipe\\aidn-editor-" + key :
    process.platform === "linux" ? "\0aidn-editor-" + key : path.join(os.tmpdir(), "aidn-editor-" + key + ".sock");
  const lock = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    lock.once("error", error => reject(error.code === "EADDRINUSE" ? Object.assign(Error("BPMN_PROJECT_FILE_CONFLICT"),
      { code: "BPMN_PROJECT_FILE_CONFLICT", status: 409 }) : error));
    lock.listen(address, resolve);
  });
  try { return await action(); }
  finally { await new Promise(resolve => lock.close(resolve)); }
}

export async function commitEditorProject(dir, expected, next, singleFile) {
  compileBpmnProject(next);
  await exclusive(dir, async () => {
    const check = async () => {
      if (projectHash(await readEditorProject(dir)) !== expected) refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
    };
    await check();
    const token = randomUUID(), temp = path.join(dir, ".aidn-" + token + ".tmp");
    try {
      if (singleFile && await activeDirectory(dir) === dir) {
        await fs.writeFile(temp, next.diagrams[singleFile], { flag: "wx" });
        await check(); await fs.rename(temp, path.join(dir, singleFile));
      } else {
        const generations = await plainDirectory(path.join(dir, ".aidn-generations"), true);
        // Readers resolve this immutable directory once. Rename publishes the
        // manifest and all diagrams with one filesystem operation.
        await writeNewBpmnProject(path.join(generations, token), next);
        await fs.writeFile(temp, token, { flag: "wx" });
        await check(); await fs.rename(temp, path.join(dir, ".aidn-generation"));
      }
    } finally { await fs.rm(temp, { force: true }); }
  });
}
export async function editorWorkspace(root, key) {
  if (!key) return root;
  if (!safeName(key)) refuse("BPMN_PROJECT_FILENAME_INVALID");
  return plainDirectory(path.join(root, ".aidn-workflows", key));
}
export async function createEditorWorkspace(root, key, project) {
  if (!safeName(key)) refuse("BPMN_PROJECT_FILENAME_INVALID");
  const { model } = compileBpmnProject(project);
  if (model.model_id !== key) refuse("BPMN_PROJECT_FILENAME_INVALID");
  const home = await plainDirectory(path.join(root, ".aidn-workflows"), true);
  await exclusive(home, async () => {
    const dir = path.join(home, key);
    if (await fs.lstat(dir).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; })) refuse("BPMN_PROJECT_EXISTS", 409);
    const temp = path.join(home, ".new-" + randomUUID());
    await writeNewBpmnProject(temp, project);
    try {
      await fs.writeFile(path.join(temp, ".aidn-baseline.json"), JSON.stringify(model), { flag: "wx" });
      await fs.rename(temp, dir);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });
}
