import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { exportBpmnProject } from "../../src/core/workflow/bpmn-project-export.mjs";

export async function writeNewBpmnProject(destination, project) {
  const dir = path.resolve(destination);
  // mkdir reserves a new directory exclusively. Never replace an author's work.
  await fs.mkdir(dir);
  const written = [];
  try {
    for (const [file, contents] of Object.entries({ ...project.diagrams, "manifest.json": JSON.stringify(project.manifest, null, 2) + "\n" })) {
      if (file !== "manifest.json" && (!/^[a-z][a-z0-9_-]{0,63}\.[1-9]\d*\.bpmn$/.test(file)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(file))) throw new Error("BPMN_PROJECT_FILENAME_INVALID");
      const target = path.join(dir, file);
      const handle = await fs.open(target, "wx");
      written.push(target);
      try { await handle.writeFile(contents, "utf8"); } finally { await handle.close(); }
    }
  } catch (error) {
    await Promise.all(written.map(file => fs.unlink(file)));
    await fs.rmdir(dir);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { model: { type: "string" }, bindings: { type: "string" }, out: { type: "string" } } });
  if (!values.model || !values.out) throw new Error("Usage: node tools/author/export-bpmn-project.mjs --model model.json [--bindings definitions.json] --out new-directory");
  const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
  const project = exportBpmnProject(await read(values.model), values.bindings ? await read(values.bindings) : {});
  await writeNewBpmnProject(values.out, project);
  console.log(`Exported ${project.manifest.models.length} BPMN models to ${path.resolve(values.out)}`);
}
