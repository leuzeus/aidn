#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_CATALOG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package", "catalogs", "gates.v1.json"), "utf8"),
);
const DOC_POLICY = GATE_CATALOG.documentation_policy ?? {};
const REPO_PATH_PREFIXES = [
  ".github/",
  "docs/",
  "package/",
  "packs/",
  "scaffold/",
  "scripts/",
  "src/",
  "tests/",
  "tools/",
];

function posix(value) {
  return String(value).replaceAll("\\", "/");
}

function trackedMarkdownFiles(repoRoot) {
  const result = spawnSync("git", ["ls-files", "*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function globMatches(relativePath, pattern) {
  const normalized = posix(relativePath);
  const marker = String(pattern ?? "");
  const star = marker.indexOf("*");
  if (star < 0) {
    return normalized === marker;
  }
  return normalized.startsWith(marker.slice(0, star))
    && normalized.endsWith(marker.slice(star + 1));
}

function classifyMarkdown(relativePath, docPolicy) {
  const normalized = posix(relativePath);
  if ((docPolicy.derived_roots ?? []).some((root) => normalized.startsWith(root))) {
    return "derived-corpus";
  }
  if ((docPolicy.historical_patterns ?? []).some((pattern) => globMatches(normalized, pattern))) {
    return "historical";
  }
  return "active";
}

function resolveGovernedProjection(repoRoot, targetRelative, docPolicy) {
  const target = posix(targetRelative);
  const exactRules = (docPolicy.projection_rules ?? [])
    .filter((rule) => typeof rule.target === "string");
  const prefixRules = (docPolicy.projection_rules ?? [])
    .filter((rule) => typeof rule.target_prefix === "string");
  const rule = exactRules.find((candidate) => candidate.target === target)
    ?? prefixRules.find((candidate) => target.startsWith(candidate.target_prefix));
  if (!rule) {
    return null;
  }
  const source = rule.source
    ?? `${rule.source_prefix}${target.slice(rule.target_prefix.length)}`;
  const required = [source, rule.producer].filter(Boolean);
  return {
    target,
    source,
    producer: rule.producer ?? null,
    complete: required.every((candidate) => fs.existsSync(path.resolve(repoRoot, candidate))),
  };
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseReferenceTarget(rawTarget) {
  let target = String(rawTarget ?? "").trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) {
    return null;
  }
  const queryIndex = target.indexOf("?");
  if (queryIndex >= 0) {
    target = target.slice(0, queryIndex);
  }
  const hashIndex = target.indexOf("#");
  const pathname = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const fragment = hashIndex >= 0 ? decode(target.slice(hashIndex + 1)) : "";
  return {
    pathname: decode(pathname),
    fragment,
  };
}

function markdownLinkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/!?\[[^\]]*]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*)?\)/g)) {
    targets.push({ kind: "markdown", target: match[1] });
  }
  for (const match of text.matchAll(/^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm)) {
    targets.push({ kind: "markdown-reference", target: match[1] });
  }
  return targets;
}

function inlineRepoTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/`([^`\r\n]+)`/g)) {
    let candidate = match[1].trim().replace(/[.,;:]$/, "");
    if (!candidate || /\s/.test(candidate) || /[*{}<>|]/.test(candidate)) {
      continue;
    }
    candidate = candidate.replace(/:\d+(?::\d+)?$/, "");
    const pathPart = candidate.split("#")[0];
    const repoLike = REPO_PATH_PREFIXES.some((prefix) => pathPart.startsWith(prefix))
      || /^(?:AGENTS|README|CHANGELOG|VERSION|LICENSE)(?:\.md)?$/.test(pathPart);
    const fileLike = /\.(?:md|mjs|js|json|ya?ml|sql|toml)$/i.test(pathPart);
    if (repoLike && fileLike) {
      targets.push({ kind: "inline-code", target: candidate });
    }
  }
  return targets;
}

function npmRunReferences(text) {
  return [...text.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_*-]+)/g)]
    .map((match) => match[1])
    .filter((name) => !name.includes("*"));
}

function githubSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownAnchors(filePath) {
  if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
    return new Set();
  }
  const seen = new Map();
  const anchors = new Set();
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    const base = githubSlug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of text.matchAll(/\bid=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function resolveTarget(repoRoot, documentPath, reference) {
  if (!reference.pathname) {
    return path.resolve(repoRoot, documentPath);
  }
  if (reference.pathname.startsWith("/")) {
    return path.resolve(repoRoot, `.${reference.pathname}`);
  }
  return path.resolve(path.dirname(path.resolve(repoRoot, documentPath)), reference.pathname);
}

export function validateDocReferences({
  repoRoot,
  markdownFiles,
  packageScripts,
  docPolicy = DOC_POLICY,
}) {
  const issues = [];
  const classifications = {
    active: 0,
    historical: 0,
    "derived-corpus": 0,
  };
  let localLinks = 0;
  let inlinePaths = 0;
  let anchors = 0;
  let npmScripts = 0;
  let projectedTargets = 0;
  for (const relativePath of markdownFiles) {
    const classification = classifyMarkdown(relativePath, docPolicy);
    classifications[classification] += 1;
    if (classification !== "active") {
      continue;
    }
    const absolutePath = path.resolve(repoRoot, relativePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    const references = [
      ...markdownLinkTargets(text),
      ...inlineRepoTargets(text),
    ];
    for (const item of references) {
      const reference = parseReferenceTarget(item.target);
      if (!reference) {
        continue;
      }
      if (item.kind === "inline-code") {
        inlinePaths += 1;
      } else {
        localLinks += 1;
      }
      const resolved = item.kind === "inline-code" && reference.pathname
        ? path.resolve(repoRoot, reference.pathname)
        : resolveTarget(repoRoot, relativePath, reference);
      if (!fs.existsSync(resolved)) {
        const targetRelative = posix(path.relative(repoRoot, resolved));
        const projection = resolveGovernedProjection(repoRoot, targetRelative, docPolicy);
        if (projection?.complete) {
          projectedTargets += 1;
          continue;
        }
        issues.push({
          code: projection
            ? "DOC_PROJECTION_SOURCE_MISSING"
            : (item.kind === "inline-code"
              ? "DOC_INLINE_PATH_MISSING"
              : "DOC_LOCAL_LINK_MISSING"),
          document: posix(relativePath),
          reference: item.target,
          ...(projection ? { projection } : {}),
        });
        continue;
      }
      if (reference.fragment) {
        anchors += 1;
        const targetAnchors = markdownAnchors(resolved);
        if (!targetAnchors.has(reference.fragment.toLowerCase())) {
          issues.push({
            code: "DOC_LOCAL_ANCHOR_MISSING",
            document: posix(relativePath),
            reference: item.target,
          });
        }
      }
    }
    for (const script of npmRunReferences(text)) {
      npmScripts += 1;
      if (!Object.prototype.hasOwnProperty.call(packageScripts, script)) {
        issues.push({
          code: "DOC_NPM_SCRIPT_MISSING",
          document: posix(relativePath),
          reference: script,
        });
      }
    }
  }
  return {
    classifications,
    policy_marker: docPolicy.marker_source ?? null,
    local_links_checked: localLinks,
    inline_paths_checked: inlinePaths,
    anchors_checked: anchors,
    npm_scripts_checked: npmScripts,
    projected_targets_checked: projectedTargets,
    issues,
  };
}

function runNegativeProbes() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-doc-reference-probes-"));
  try {
    fs.writeFileSync(path.join(tempRoot, "target file.md"), "# Existing heading\n", "utf8");
    fs.writeFileSync(path.join(tempRoot, "probe.md"), [
      "# Probe",
      "",
      "[missing](./does-not-exist.md)",
      "[angle](<./missing angle.md>)",
      "[anchor](<./target file.md#missing-anchor>)",
      "`docs/missing-inline-path.md`",
      "`npm run perf:missing-script`",
      "",
    ].join("\n"), "utf8");
    const probePolicy = {
      projection_rules: [{
        target_prefix: "docs/audit/",
        source_prefix: "scaffold/docs_audit/",
        producer: "packs/core/manifest.yaml",
      }],
    };
    const result = validateDocReferences({
      repoRoot: tempRoot,
      markdownFiles: ["probe.md"],
      packageScripts: {},
      docPolicy: probePolicy,
    });
    const codes = new Set(result.issues.map((issue) => issue.code));
    fs.writeFileSync(path.join(tempRoot, "projection-probe.md"), "`docs/audit/typo.md`\n", "utf8");
    const projectionResult = validateDocReferences({
      repoRoot: tempRoot,
      markdownFiles: ["projection-probe.md"],
      packageScripts: {},
      docPolicy: probePolicy,
    });
    const missingProjectionSourceRejected = projectionResult.issues.some(
      (issue) => issue.code === "DOC_PROJECTION_SOURCE_MISSING",
    );
    return {
      ok: codes.has("DOC_LOCAL_LINK_MISSING")
        && codes.has("DOC_LOCAL_ANCHOR_MISSING")
        && codes.has("DOC_INLINE_PATH_MISSING")
        && codes.has("DOC_NPM_SCRIPT_MISSING")
        && missingProjectionSourceRejected,
      broken_link_rejected: codes.has("DOC_LOCAL_LINK_MISSING"),
      angle_destination_rejected: result.issues.some(
        (issue) => issue.reference === "<./missing angle.md>",
      ),
      missing_anchor_rejected: codes.has("DOC_LOCAL_ANCHOR_MISSING"),
      missing_inline_path_rejected: codes.has("DOC_INLINE_PATH_MISSING"),
      missing_npm_script_rejected: codes.has("DOC_NPM_SCRIPT_MISSING"),
      missing_projection_source_rejected: missingProjectionSourceRejected,
    };
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok) {
      throw cleanup.error;
    }
  }
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const verification = validateDocReferences({
    repoRoot: REPO_ROOT,
    markdownFiles: trackedMarkdownFiles(REPO_ROOT),
    packageScripts: packageJson.scripts ?? {},
  });
  const negativeProbes = runNegativeProbes();
  const issues = [
    ...verification.issues,
    ...(!negativeProbes.ok ? [{
      code: "DOC_NEGATIVE_PROBE_FAILED",
      document: "synthetic",
      reference: "link-anchor-angle-inline-or-script",
    }] : []),
  ];
  const output = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    ...verification,
    negative_probes: negativeProbes,
    issues,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
}

main();
