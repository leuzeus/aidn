import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateGovernanceAdoption, isGovernanceAdoptionEffective } from "../../core/governance/adoption-policy.mjs";
import { resolveWorkflowAdapterConfigPath } from "../../lib/config/workflow-adapter-config-lib.mjs";

const kinds = new Set(["automatic", "human", "native"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

// Observe local availability only. No network fetch, execution, acceptance or
// semantic comparison is performed, and fragments are not verified as rules.
function observeReference(root, reference) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference) && !/^[a-z]:[\\/]/i.test(reference)) return "external_not_checked";
  const file = path.resolve(root, reference.split("#")[0]);
  if (!inside(path.resolve(root), file)) return "outside_target";
  try {
    if (!fs.existsSync(file)) return "missing";
    if (!inside(fs.realpathSync(root), fs.realpathSync(file))) return "outside_target";
    return "available_local";
  } catch { return "unavailable"; }
}

function projectRecord(record, { root, scope, asOf, sha256, reference }) {
  const validation = validateGovernanceAdoption(record, { expectedScope: scope });
  const result = { reference, scope, status: "invalid", effective: false, sha256,
    adoption_id: null, revision: null, declared_status: null, method: null,
    conformance: "not_evaluated", execution: "not_evaluated", authority_semantics: "human_review_required",
    authorities: [], sections: [], controls: [], omissions: [], history: [], issues: validation.issues,
    coverage: { status: "not_evaluated", automatic: 0, human: 0, native: 0, unclassified: 0, deferred: 0, omitted: 0 } };
  if (!validation.ok) return result;
  const effective = isGovernanceAdoptionEffective(record, { expectedScope: scope, asOf });
  Object.assign(result, { status: effective ? "effective" : record.status === "proposed" ? "proposed" : "inactive",
    effective, adoption_id: record.adoptionId, revision: record.revision, declared_status: record.status,
    method: record.method, owner: record.owner, acceptance: record.acceptance, precedence: record.precedence,
    omissions: record.omissions, history: record.history, review_triggers: record.reviewTriggers });
  result.authorities = record.authorities.map((authority) => ({ ...authority,
    applicable: effective && authority.status === "effective" && authority.effectiveFrom <= asOf,
    reference_status: observeReference(root, authority.reference), semantic_verification: "not_evaluated" }));
  result.sections = record.sections.map((section) => ({ ...section,
    applicable: effective && ["adopted", "adapted"].includes(section.disposition)
      && section.authorities.every((id) => result.authorities.find((authority) => authority.id === id)?.applicable),
    human_review: "required", execution: "not_evaluated" }));
  const references = [...new Set(record.sections.flatMap((section) => section.controls))];
  const classifications = new Map();
  const extension = record.extensions?.controlCoverage;
  if (extension !== undefined) {
    if (!extension || extension.schemaVersion !== 1 || !Array.isArray(extension.controls)
      || Object.keys(extension).some((key) => !["schemaVersion", "controls"].includes(key))) {
      result.issues.push("controlCoverage must have schemaVersion 1 and controls");
    } else {
      for (const [index, control] of extension.controls.entries()) {
        if (!control || !references.includes(control.reference) || !kinds.has(control.kind)
          || Object.keys(control).some((key) => !["reference", "kind"].includes(key)) || classifications.has(control.reference)) {
          result.issues.push(`controlCoverage.controls[${index}] invalid, duplicate or unbound`);
        } else classifications.set(control.reference, control.kind);
      }
    }
  }
  result.coverage.status = result.issues.length ? "invalid" : extension === undefined ? "unclassified" : "declared";
  // Invalid classification cannot leave a misleading partially classified view.
  if (result.issues.length) classifications.clear();
  result.controls = references.map((reference) => {
    const kind = classifications.get(reference) ?? "unclassified";
    result.coverage[kind] += 1;
    return { reference, kind, reference_status: observeReference(root, reference), execution: "not_evaluated" };
  });
  if (result.coverage.status === "declared" && result.coverage.unclassified > 0) result.coverage.status = "partial";
  result.coverage.deferred = record.sections.filter((section) => section.disposition === "deferred").length;
  result.coverage.omitted = record.sections.filter((section) => section.disposition === "omitted").length;
  return result;
}

function readRecord(file, { root, scope, asOf, reference, adapter = false }) {
  const empty = (status, issues = []) => ({ reference, scope, status, effective: false, sha256: null,
    conformance: "not_evaluated", execution: "not_evaluated", issues });
  try {
    if (!fs.existsSync(file)) return empty("absent");
    if (!inside(fs.realpathSync(root), fs.realpathSync(file))) return empty("unavailable", ["declaration_outside_target"]);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1048576) return empty("unavailable", ["declaration_not_a_bounded_regular_file"]);
    const bytes = fs.readFileSync(file);
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (adapter && (!document || Array.isArray(document) || typeof document !== "object")) return empty("invalid", ["adapter_root_invalid"]);
    if (adapter && !Object.hasOwn(document, "governanceAdoption")) return empty("absent");
    return projectRecord(adapter ? document.governanceAdoption : document, { root, scope, asOf, sha256: hash(bytes), reference });
  } catch { return empty("invalid", ["declaration_unreadable_or_invalid_json"]); }
}

export function projectGovernanceAdoptionCoverage({ targetRoot, packageRoot, asOf = new Date().toISOString().slice(0, 10) }) {
  return { as_of: asOf, source_inheritance: false, write_authorization: false,
    method_verification: "pinned_reference_only", native_qualification: "not_evaluated",
    package_source: readRecord(path.join(packageRoot, "package/governance/gfd-adoption.v1.json"), {
      root: packageRoot, scope: "package-source", asOf, reference: "package/governance/gfd-adoption.v1.json" }),
    client: readRecord(resolveWorkflowAdapterConfigPath(targetRoot), { root: targetRoot,
      scope: "installed-project", asOf, reference: ".aidn/project/workflow.adapter.json", adapter: true }) };
}
