import fs from "node:fs";
import path from "node:path";
import { listCliEffectPolicies } from "../../src/core/cli/effect-policy.mjs";

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

function parseAliasBlock(binText, constantName) {
  const match = binText.match(new RegExp(`const ${constantName} = \\{([\\s\\S]*?)\\n\\};`));
  if (!match) {
    throw new Error(`Unable to find ${constantName} in bin/aidn.mjs`);
  }
  const aliases = [];
  for (const item of match[1].matchAll(/(?:^|\n)\s*(?:"([^"]+)"|([a-z][a-z0-9-]*)):\s*\{\s*file:\s*"([^"]+)"/g)) {
    aliases.push({ name: item[1] || item[2], file: item[3] });
  }
  return aliases;
}

function effectFor(command, policies) {
  const exact = policies.find((policy) => policy.command === command);
  if (exact) {
    return exact.effect_class;
  }
  const family = policies.find((policy) => policy.command.startsWith(`${command} `));
  return family?.effect_class ?? "unclassified-internal";
}

function optionsFor(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, "utf8");
  return [...new Set([...text.matchAll(/--[a-z][a-z0-9-]*/g)].map((match) => match[0]))].sort();
}

function buildCommands(repoRoot) {
  const binPath = path.join(repoRoot, "bin", "aidn.mjs");
  const binText = fs.readFileSync(binPath, "utf8");
  const policies = listCliEffectPolicies();
  const entries = [];
  const commands = [
    { command: "aidn bootstrap", implementation: "tools/bootstrap.mjs", visibility: "public" },
    { command: "aidn install", implementation: "tools/install.mjs", visibility: "public" },
    { command: "aidn build-release", implementation: "tools/build-release.mjs", visibility: "public" },
  ];
  const groups = [
    ["perf", "PERF_ALIASES"],
    ["codex", "CODEX_ALIASES"],
    ["runtime", "RUNTIME_ALIASES"],
    ["project", "PROJECT_ALIASES"],
  ];
  for (const [group, constantName] of groups) {
    const aliasByName = new Map(parseAliasBlock(binText, constantName).map((item) => [item.name, item]));
    for (const name of aliasByName.keys()) {
      const alias = aliasByName.get(name);
      commands.push({
        command: `aidn ${group} ${name}`,
        implementation: `tools/${group}/${alias.file}`,
        visibility: "public",
      });
    }
  }
  for (const item of commands.sort((a, b) => a.command.localeCompare(b.command))) {
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
      owner: item.command.startsWith("aidn codex") ? "Codex integration maintainer" : "CLI maintainer",
      source: "bin/aidn.mjs",
      entrypoint: item.command,
      implementation: item.implementation,
      effects: effectFor(item.command, policies),
      consumer: item.visibility === "public" ? "installed client and automation" : "repository maintainers",
      docs: "docs/CLI_SURFACE_INVENTORY.md",
      proofClass,
      proofTarget,
    }));
    for (const option of optionsFor(path.join(repoRoot, item.implementation))) {
      entries.push(catalogEntry({
        id: `option:${item.command}:${option}`,
        kind: "option",
        visibility: item.visibility,
        owner: "CLI maintainer",
        source: item.implementation,
        entrypoint: `${item.command} ${option}`,
        implementation: item.implementation,
        effects: option === "--json" ? "format-only" : effectFor(item.command, policies),
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
