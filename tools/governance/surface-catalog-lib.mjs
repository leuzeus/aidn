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

const EXPLICIT_INTERNAL_ALIAS_SURFACES = new Set([
  "aidn codex normalize-hook-payload",
  "aidn codex run-json-hook",
  "aidn perf audit-review",
  "aidn perf campaign",
  "aidn perf check-constraint-trend",
  "aidn perf check-constraints",
  "aidn perf check-fallbacks",
  "aidn perf check-regression",
  "aidn perf check-thresholds",
  "aidn perf checkpoint",
  "aidn perf collect",
  "aidn perf constraint-actions",
  "aidn perf constraint-history",
  "aidn perf constraint-loop",
  "aidn perf constraint-lot-advance",
  "aidn perf constraint-lot-plan",
  "aidn perf constraint-lot-summary",
  "aidn perf constraint-lot-update",
  "aidn perf constraint-report",
  "aidn perf constraint-summary",
  "aidn perf constraint-trend",
  "aidn perf constraint-trend-summary",
  "aidn perf delivery-end",
  "aidn perf delivery-start",
  "aidn perf fallback-report",
  "aidn perf gate",
  "aidn perf hook",
  "aidn perf index",
  "aidn perf index-canonical-check",
  "aidn perf index-canonical-summary",
  "aidn perf index-check",
  "aidn perf index-export-files",
  "aidn perf index-from-sqlite",
  "aidn perf index-query",
  "aidn perf index-reconcile",
  "aidn perf index-regression",
  "aidn perf index-regression-history",
  "aidn perf index-regression-kpi",
  "aidn perf index-report",
  "aidn perf index-select-paths",
  "aidn perf index-sql",
  "aidn perf index-sync-history",
  "aidn perf index-sync-report",
  "aidn perf index-sync-thresholds",
  "aidn perf index-thresholds",
  "aidn perf index-verify",
  "aidn perf index-verify-sqlite",
  "aidn perf reload-check",
  "aidn perf render-summary",
  "aidn perf report",
  "aidn perf reset",
  "aidn perf session-close",
  "aidn perf session-start",
  "aidn perf skill-hook",
  "aidn perf structure",
  "aidn perf sync-history",
  "aidn perf verify-cli-aliases",
  "aidn perf verify-constraint-actions",
  "aidn perf verify-constraint-lot-plan",
  "aidn perf verify-constraint-report",
  "aidn perf verify-constraint-trend",
  "aidn perf verify-db-first-sync",
  "aidn perf verify-index-canonical-check",
  "aidn perf verify-index-reconcile",
  "aidn perf verify-index-regression",
  "aidn perf verify-index-sqlite",
  "aidn perf verify-index-sync",
  "aidn perf verify-index-sync-select-paths",
  "aidn perf verify-install-import",
  "aidn perf verify-project-config",
  "aidn perf verify-skill-hook-context",
  "aidn perf verify-skill-hooks",
  "aidn perf verify-state-mode-parity",
  "aidn perf verify-structure",
  "aidn perf verify-sync-db-first-selective",
]);

const SPECIAL_PUBLIC_EFFECTS = new Map([
  ["aidn", { default: "read-only", variants: [] }],
  ["aidn help", { default: "read-only", variants: [] }],
  ["aidn version", { default: "read-only", variants: [] }],
  ["aidn codex", { default: "read-only", variants: [] }],
  ["aidn codex help", { default: "read-only", variants: [] }],
  ["aidn project", { default: "read-only", variants: [] }],
  ["aidn project help", { default: "read-only", variants: [] }],
  ["aidn runtime", { default: "read-only", variants: [] }],
  ["aidn runtime help", { default: "read-only", variants: [] }],
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

function effectProfileFor(command, policies) {
  if (SPECIAL_PUBLIC_EFFECTS.has(command)) {
    return SPECIAL_PUBLIC_EFFECTS.get(command);
  }
  const candidates = policies.filter((policy) => policy.surface === command);
  if (candidates.length === 0) {
    throw new Error(`${command}: public surface has no exact effect policy`);
  }
  const defaults = candidates.filter(
    (policy) => policy.surface_default === true || policy.when_args.length === 0,
  );
  const explicitDefaultClasses = candidates
    .map((policy) => policy.surface_default_effect)
    .filter(Boolean);
  const defaultClasses = [...new Set(
    explicitDefaultClasses.length > 0
      ? explicitDefaultClasses
      : defaults.map((policy) => policy.effect_class),
  )];
  if (defaultClasses.length !== 1) {
    throw new Error(
      `${command}: effect policy must declare exactly one unambiguous default class `
      + `(found ${defaultClasses.join(", ") || "none"})`,
    );
  }
  return {
    default: defaultClasses[0],
    variants: [
      ...candidates
      .filter((policy) => policy.when_args.length > 0)
      .map((policy) => ({
        when_args: [...policy.when_args],
        unless_args: [...policy.unless_args],
        effect_class: policy.effect_class,
        policy: policy.id,
      })),
      ...candidates.flatMap((policy) => policy.effect_variants.map((variant) => ({
        when_args: [...variant.when_args],
        unless_args: [...variant.unless_args],
        effect_class: variant.effect_class,
        policy: `${policy.id}/${variant.id}`,
      }))),
    ]
      .sort((left, right) => left.policy.localeCompare(right.policy)),
  };
}

export function resolveEffectClassFromProfile(effectProfile, argv = []) {
  if (!effectProfile || typeof effectProfile !== "object") {
    throw new Error("effect profile must be an object");
  }
  const tokens = new Set(argv.map((token) => String(token)));
  const matches = (effectProfile.variants ?? []).filter(
    (variant) => variant.when_args.every((token) => tokens.has(token))
      && variant.unless_args.every((token) => !tokens.has(token)),
  );
  if (matches.length === 0) {
    return effectProfile.default;
  }
  const specificity = Math.max(...matches.map((variant) => variant.when_args.length));
  const mostSpecific = matches.filter((variant) => variant.when_args.length === specificity);
  const classes = [...new Set(mostSpecific.map((variant) => variant.effect_class))];
  if (classes.length !== 1) {
    throw new Error(`ambiguous effect variants: ${mostSpecific.map((item) => item.policy).join(", ")}`);
  }
  return classes[0];
}

function optionEffect(option, effectProfile) {
  if (option === "--json") {
    return "format-only";
  }
  const matchingVariants = effectProfile.variants.filter(
    (variant) => variant.when_args.includes(option),
  );
  if (matchingVariants.length === 0) {
    return effectProfile.default;
  }
  const classes = [...new Set(matchingVariants.map((variant) => variant.effect_class))];
  return classes.length === 1
    ? classes[0]
    : {
      default: effectProfile.default,
      variants: matchingVariants,
    };
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
  const binPath = path.join(repoRoot, "bin", "aidn.mjs");
  const binText = fs.readFileSync(binPath, "utf8");
  const policies = listCliEffectPolicies();
  const entries = [];
  const commands = [
    { command: "aidn bootstrap", implementation: "tools/bootstrap.mjs", visibility: "public" },
    { command: "aidn install", implementation: "tools/install.mjs", visibility: "public" },
    { command: "aidn build-release", implementation: "tools/build-release.mjs", visibility: "public" },
    { command: "aidn help", implementation: "bin/aidn.mjs", visibility: "public", options: [] },
    { command: "aidn version", implementation: "bin/aidn.mjs", visibility: "public", options: [] },
    {
      command: "aidn",
      implementation: "bin/aidn.mjs",
      visibility: "public",
      options: ["--help", "-h", "--version", "-v"],
    },
  ];
  const groups = [
    ["perf", "PERF_ALIASES"],
    ["codex", "CODEX_ALIASES"],
    ["runtime", "RUNTIME_ALIASES"],
    ["project", "PROJECT_ALIASES"],
  ];
  for (const [group, constantName] of groups) {
    const aliasByName = new Map(parseAliasBlock(binText, constantName).map((item) => [item.name, item]));
    commands.push({
      command: `aidn ${group}`,
      implementation: "bin/aidn.mjs",
      visibility: group === "perf" ? "internal" : "public",
      options: ["--help", "-h"],
    });
    commands.push({
      command: `aidn ${group} help`,
      implementation: "bin/aidn.mjs",
      visibility: group === "perf" ? "internal" : "public",
      options: [],
    });
    for (const name of aliasByName.keys()) {
      const alias = aliasByName.get(name);
      const command = `aidn ${group} ${name}`;
      const hasEffectPolicy = policies.some((policy) => policy.surface === command);
      const explicitlyInternal = EXPLICIT_INTERNAL_ALIAS_SURFACES.has(command);
      if (hasEffectPolicy === explicitlyInternal) {
        throw new Error(
          `${command}: alias must have exactly one visibility source `
          + `(public effect policy or explicit internal declaration)`,
        );
      }
      commands.push({
        command,
        implementation: `tools/${group}/${alias.file}`,
        visibility: hasEffectPolicy ? "public" : "internal",
      });
    }
  }
  for (const item of commands.sort((a, b) => a.command.localeCompare(b.command))) {
    const effects = item.visibility === "public"
      ? effectProfileFor(item.command, policies)
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
      owner: item.command.startsWith("aidn codex") ? "Codex integration maintainer" : "CLI maintainer",
      source: "bin/aidn.mjs",
      entrypoint: item.command,
      implementation: item.implementation,
      effects,
      consumer: item.visibility === "public" ? "installed client and automation" : "repository maintainers",
      docs: "docs/CLI_SURFACE_INVENTORY.md",
      proofClass,
      proofTarget,
    }));
    const options = item.options ?? parserOptionsFor(path.join(repoRoot, item.implementation));
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
          ? optionEffect(option, effects)
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
