import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import schema from "../../core/contracts/workflow-definition/workflow-package.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import { checkShadowJson, freezeShadow } from "../../core/workflow/shadow-json.mjs";

export function loadWorkflowPackage(directory, descriptor, verifyAssets) {
  if (checkShadowJson(descriptor) || validateJsonSchema(descriptor, schema, "$", { contractKind: "workflow-definition" }).length ||
      new Set(descriptor.skills).size !== descriptor.skills.length || typeof verifyAssets !== "function")
    throw Error("WORKFLOW_PACKAGE_INVALID");
  const root = fs.realpathSync(directory instanceof URL ? fileURLToPath(directory) : directory);
  function read(name) {
    const file = fs.realpathSync(path.resolve(root, name));
    const relative = path.relative(root, file);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      throw Error("WORKFLOW_PACKAGE_PATH_INVALID");
    return fs.readFileSync(pathToFileURL(file));
  }
  const catalog = JSON.parse(read(descriptor.catalog));
  const model = JSON.parse(read(descriptor.model));
  const skills = Object.fromEntries(descriptor.skills.map(name => [name, read(name)]));
  const source = verifyAssets({ catalog, model, specification: read(descriptor.specification), skills });
  return freezeShadow({ catalog, model, source });
}
