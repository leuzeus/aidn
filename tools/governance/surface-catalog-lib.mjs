import fs from "node:fs";
import path from "node:path";
import {
  classifyCliOptionEffect,
  getCliEffectProfile,
  resolveEffectClassFromProfile as resolvePolicyEffectClass,
} from "../../src/core/cli/effect-policy.mjs";
import {
  listCommandGroups,
  listDispatchableCommandDescriptors,
  validateCommandRegistryDescriptors,
} from "../../src/core/cli/command-registry.mjs";

export const SURFACE_CATALOG_PATH = "package/catalogs/surfaces.v1.json";
export const SURFACE_STATUSES = Object.freeze(["active", "deprecated", "replaced", "removed"]);
export const PROOF_CLASSES = Object.freeze(["source", "scaffold", "fixture", "installed-client", "external-pilot"]);
export const INFORMATION_CLASSES = Object.freeze(["canonical", "derived", "historical"]);

const PUBLIC_DOCS = [
  "README.md",
  "docs/INSTALL.md",
  "docs/UPGRADE.md",
  "docs/CLI_SURFACE_INVENTORY.md",
  "docs/CODEX_APP_COMPATIBILITY.md",
];

const SPECIAL_PUBLIC_EFFECTS = new Map([
  ["aidn", { default: "read-only", variants: [] }],
  ["aidn codex", { default: "read-only", variants: [] }],
  ["aidn project", { default: "read-only", variants: [] }],
  ["aidn runtime", { default: "read-only", variants: [] }],
]);

function posix(value) {
  return String(value).replace(/\\/g, "/");
}

function listFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(absolute, predicate));
    } else if (predicate(absolute)) {
      out.push(absolute);
    }
  }
  return out.sort((a, b) => posix(a).localeCompare(posix(b)));
}

function catalogEntry({
  id,
  kind,
  status = "active",
  visibility = "public",
  informationClass = "canonical",
  owner,
  source,
  entrypoint,
  implementation,
  effects,
  consumer,
  docs,
  proofClass = "source",
  proofTarget,
  proofGate = "tools/verify/verify-surface-catalog.mjs",
  replacement = "",
  migration = "",
}) {
  return {
    id,
    kind,
    status,
    visibility,
    information_class: informationClass,
    owner,
    source: posix(source),
    entrypoint,
    implementation: posix(implementation),
    effects,
    consumer,
    docs: posix(docs),
    proof: {
      class: proofClass,
      target: posix(proofTarget),
      gate: posix(proofGate),
    },
    replacement,
    migration,
  };
}

function effectProfileFor(command) {
  if (SPECIAL_PUBLIC_EFFECTS.has(command)) {
    return SPECIAL_PUBLIC_EFFECTS.get(command);
  }
  return getCliEffectProfile(command);
}

export function resolveEffectClassFromProfile(effectProfile, argv = []) {
  return resolvePolicyEffectClass(effectProfile, argv);
}

function optionEffect(command, option) {
  if (SPECIAL_PUBLIC_EFFECTS.has(command)) {
    if (option === "--help" || option === "-h") {
      return { role: "effect-override", rule: "help-is-read-only", effect_class: "read-only" };
    }
    return { role: "effect-neutral", rule: "invocation-profile" };
  }
  return classifyCliOptionEffect(command, option);
}

function namedFunctionBody(text, functionName) {
  const declaration = new RegExp(`(?:export\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "m");
  const match = declaration.exec(text);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") {
      depth += 1;
    } else if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start + 1, index);
      }
    }
  }
  throw new Error(`Unclosed ${functionName} function`);
}

export function parserOptionsFor(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, "utf8");
  const parserBody = namedFunctionBody(text, "parseArgs");
  if (!parserBody) {
    return [];
  }
  return [...new Set(
    [...parserBody.matchAll(/(["'])(-{1,2}[a-z][a-z0-9-]*)\1/g)]
      .map((match) => match[2]),
  )].sort();
}

function buildCommands(repoRoot) {
  const entries = [];
  const descriptors = listDispatchableCommandDescriptors();
  const registryValidation = validateCommandRegistryDescriptors(descriptors);
  if (!registryValidation.ok) {
    throw new Error(`Invalid dispatch registry: ${registryValidation.issues.join("; ")}`);
  }
  const commands = [
    ...descriptors,
    {
      command: "aidn",
      implementation: "bin/aidn.mjs",
      visibility: "public",
      options: ["--help", "-h", "--version", "-v"],
    },
  ];
  for (const group of listCommandGroups()) {
    commands.push({
      command: `aidn ${group}`,
      implementation: "bin/aidn.mjs",
      visibility: group === "perf" ? "internal" : "public",
      options: ["--help", "-h"],
    });
  }
  for (const item of commands.sort((a, b) => a.command.localeCompare(b.command))) {
    const effects = item.visibility === "public"
      ? effectProfileFor(item.command)
      : "internal/non-public";
    const proofClass = item.visibility === "public" && item.command.startsWith("aidn codex")
      ? "installed-client"
      : "source";
    const proofTarget = proofClass === "installed-client"
      ? "tools/verify/verify-codex-client-install.mjs"
      : item.implementation;
    entries.push(catalogEntry({
      id: `command:${item.command}`,
      kind: "command",
      visibility: item.visibility,
      owner: item.owner
        ?? (item.command.startsWith("aidn codex") ? "Codex integration maintainer" : "CLI maintainer"),
      source: item.registry_source ?? "bin/aidn.mjs",
      entrypoint: item.command,
      implementation: item.implementation,
      effects,
      consumer: item.visibility === "public" ? "installed client and automation" : "repository maintainers",
      docs: "docs/CLI_SURFACE_INVENTORY.md",
      proofClass,
      proofTarget,
    }));
    const options = item.options
      ?? (item.dispatch_kind === "builtin"
        ? []
        : parserOptionsFor(path.join(repoRoot, item.implementation)));
    for (const option of options) {
      entries.push(catalogEntry({
        id: `option:${item.command}:${option}`,
        kind: "option",
        visibility: item.visibility,
        owner: "CLI maintainer",
        source: item.implementation,
        entrypoint: `${item.command} ${option}`,
        implementation: item.implementation,
        effects: item.visibility === "public"
          ? optionEffect(item.command, option)
          : "internal/non-public",
        consumer: item.visibility === "public" ? "installed client and automation" : "repository maintainers",
        docs: "docs/CLI_SURFACE_INVENTORY.md",
        proofTarget: item.implementation,
      }));
    }
  }
  entries.push(catalogEntry({
    id: "command:aidn codex context-store",
    kind: "command",
    status: "removed",
    visibility: "historical",
    informationClass: "historical",
    owner: "Codex integration maintainer",
    source: "bin/aidn.mjs",
    entrypoint: "aidn codex context-store",
    implementation: "",
    effects: "removed",
    consumer: "legacy callers",
    docs: "docs/CLI_SURFACE_INVENTORY.md",
    proofTarget: "tools/verify/verify-surface-catalog.mjs",
    replacement: "aidn codex hydrate-context",
    migration: "Replace the removed command with hydrate-context or workflow-step according to the required consumer result.",
  }));
  return entries;
}

function buildArtifacts(repoRoot) {
  const entriesByTarget = new Map();
  for (const manifestPath of listFiles(path.join(repoRoot, "packs"), (file) => file.endsWith("manifest.yaml"))) {
    const relativeManifest = posix(path.relative(repoRoot, manifestPath));
    const text = fs.readFileSync(manifestPath, "utf8");
    for (const match of text.matchAll(/^\s+to:\s+(.+)$/gm)) {
      const target = match[1].trim();
      const proofClass = target.startsWith(".agents/") || target.startsWith(".codex/")
        ? "installed-client"
        : "fixture";
      if (entriesByTarget.has(target)) {
        continue;
      }
      entriesByTarget.set(target, catalogEntry({
        id: `artifact:${target}`,
        kind: "artifact",
        visibility: "public",
        informationClass: "derived",
        owner: "Install and pack maintainer",
        source: relativeManifest,
        entrypoint: target,
        implementation: relativeManifest,
        effects: "installer projection",
        consumer: "installed client",
        docs: "docs/INSTALL.md",
        proofClass,
        proofTarget: proofClass === "installed-client"
          ? "tools/verify/verify-codex-client-install.mjs"
          : "tools/perf/verify-pack-topology-fixtures.mjs",
      }));
    }
  }
  const entries = [...entriesByTarget.values()];
  entries.push(catalogEntry({
    id: "artifact:.codex/skills/",
    kind: "artifact",
    status: "replaced",
    visibility: "historical",
    informationClass: "historical",
    owner: "Codex integration maintainer",
    source: "packs/core/manifest.yaml",
    entrypoint: ".codex/skills/",
    implementation: "",
    effects: "legacy project skill location",
    consumer: "previously installed clients",
    docs: "docs/CODEX_APP_COMPATIBILITY.md",
    proofTarget: "tools/verify/verify-codex-client-install.mjs",
    replacement: ".agents/skills/",
    migration: "Reinstall the core or codex-integration pack and remove the legacy directory after preserving user-owned files.",
  }));
  return entries;
}

function buildSkills(repoRoot) {
  return listFiles(path.join(repoRoot, "scaffold", "codex"), (file) => path.basename(file) === "SKILL.md")
    .map((file) => {
      const relative = posix(path.relative(repoRoot, file));
      const name = path.basename(path.dirname(file));
      return catalogEntry({
        id: `skill:${name}`,
        kind: "skill",
        owner: "Workflow skill maintainer",
        source: relative,
        entrypoint: `.agents/skills/${name}/SKILL.md`,
        implementation: relative,
        effects: "declared by skill and routed runtime hook",
        consumer: "Codex installed client",
        docs: "scaffold/root/AGENTS.md",
        proofClass: "installed-client",
        proofTarget: "tools/verify/verify-codex-client-install.mjs",
      });
    });
}

function buildAgents(repoRoot) {
  return listFiles(path.join(repoRoot, "scaffold", "codex_agents"), (file) => file.endsWith(".toml"))
    .map((file) => {
      const relative = posix(path.relative(repoRoot, file));
      const name = path.basename(file, ".toml");
      return catalogEntry({
        id: `agent:${name}`,
        kind: "agent",
        owner: "Codex integration maintainer",
        source: relative,
        entrypoint: `.codex/agents/${name}.toml`,
        implementation: relative,
        effects: "bounded by model, reasoning effort, and sandbox mode",
        consumer: "Codex installed client",
        docs: "docs/CODEX_APP_COMPATIBILITY.md",
        proofClass: "installed-client",
        proofTarget: "tools/verify/verify-codex-client-install.mjs",
      });
    });
}

function buildHooks(repoRoot) {
  const source = "scaffold/codex_hooks/hooks.json";
  const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, source), "utf8"));
  return Object.keys(hooks.hooks ?? {}).sort().map((eventName) => catalogEntry({
    id: `hook:${eventName}`,
    kind: "hook",
    owner: "Codex integration maintainer",
    source,
    entrypoint: eventName,
    implementation: "scaffold/codex_hooks/scripts/aidn-session-start.mjs",
    effects: "read-only discovery context",
    consumer: "trusted Codex installed client",
    docs: "docs/CODEX_APP_COMPATIBILITY.md",
    proofClass: "installed-client",
    proofTarget: "tools/verify/verify-codex-client-install.mjs",
  }));
}

function buildContracts(repoRoot) {
  return listFiles(
    path.join(repoRoot, "src", "core", "contracts", "cli-output"),
    (file) => file.endsWith(".schema.json"),
  ).map((file) => {
    const relative = posix(path.relative(repoRoot, file));
    const schema = JSON.parse(fs.readFileSync(file, "utf8"));
    return catalogEntry({
      id: `contract:${path.basename(file)}`,
      kind: "contract",
      owner: "CLI contract maintainer",
      source: relative,
      entrypoint: schema["x-aidn-command"] ?? schema.$id,
      implementation: relative,
      effects: "machine-readable public output",
      consumer: "automation and contract fixtures",
      docs: "docs/agents/04-json-contracts.md",
      proofClass: "fixture",
      proofTarget: "tools/perf/verify-cli-output-contracts-fixtures.mjs",
    });
  });
}

function buildModes() {
  return ["files", "dual", "db-only"].map((mode) => catalogEntry({
    id: `mode:${mode}`,
    kind: "mode",
    owner: "Runtime governance maintainer",
    source: "src/lib/config/aidn-config-lib.mjs",
    entrypoint: mode,
    implementation: "src/lib/config/aidn-config-lib.mjs",
    effects: mode === "files" ? "file canonical" : `${mode} runtime persistence`,
    consumer: "installed runtime",
    docs: "docs/RUNTIME_SURFACE_SCOPE_MATRIX.md",
    proofClass: "fixture",
    proofTarget: "tools/perf/verify-state-mode-parity-fixtures.mjs",
  }));
}

export function buildSurfaceCatalog(repoRoot) {
  const entries = [
    ...buildCommands(repoRoot),
    ...buildArtifacts(repoRoot),
    ...buildSkills(repoRoot),
    ...buildAgents(repoRoot),
    ...buildHooks(repoRoot),
    ...buildContracts(repoRoot),
    ...buildModes(),
    catalogEntry({
      id: "corpus:tests/fixtures",
      kind: "corpus",
      visibility: "internal",
      informationClass: "derived",
      owner: "Validation maintainer",
      source: "tests/fixtures/",
      entrypoint: "tests/fixtures/",
      implementation: "tests/fixtures/",
      effects: "tracked test corpus",
      consumer: "fixture gates",
      docs: "docs/TESTING.md",
      proofClass: "fixture",
      proofTarget: "tests/fixtures/",
    }),
    catalogEntry({
      id: "corpus:historical-plans",
      kind: "corpus",
      visibility: "historical",
      informationClass: "historical",
      owner: "Documentation steward",
      source: "docs/README.md",
      entrypoint: "docs/PLAN_* and docs/BACKLOG_*",
      implementation: "docs/README.md",
      effects: "non-normative historical record",
      consumer: "architecture research",
      docs: "docs/README.md",
      proofTarget: "docs/README.md",
    }),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: 1,
    statuses: [...SURFACE_STATUSES],
    proof_classes: [...PROOF_CLASSES],
    information_classes: [...INFORMATION_CLASSES],
    public_docs: PUBLIC_DOCS,
    generated_by: "tools/governance/generate-surface-catalog.mjs",
    entries,
  };
}
