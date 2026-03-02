#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readIndexFromSqlite } from "./index-sqlite-lib.mjs";
import { renderOrMergeCanonicalMarkdown } from "./markdown-render-lib.mjs";

function parseArgs(argv) {
  const args = {
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    target: ".",
    auditRoot: "",
    normativeOnly: false,
    renderMarkdown: true,
    strict: false,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--index-file") {
      args.indexFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").toLowerCase();
      i += 1;
    } else if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--audit-root") {
      args.auditRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--normative-only") {
      args.normativeOnly = true;
    } else if (token === "--render-markdown") {
      args.renderMarkdown = true;
    } else if (token === "--no-render-markdown") {
      args.renderMarkdown = false;
    } else if (token === "--strict") {
      args.strict = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.indexFile) {
    throw new Error("Missing value for --index-file");
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!["auto", "json", "sqlite"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/index-export-files.mjs");
  console.log("  node tools/perf/index-export-files.mjs --index-file .aidn/runtime/index/workflow-index.sqlite --backend sqlite");
  console.log("  node tools/perf/index-export-files.mjs --index-file .aidn/runtime/index/workflow-index.json --backend json");
  console.log("  node tools/perf/index-export-files.mjs --target ../client-repo --audit-root docs/audit");
  console.log("  node tools/perf/index-export-files.mjs --normative-only");
  console.log("  node tools/perf/index-export-files.mjs --render-markdown");
  console.log("  node tools/perf/index-export-files.mjs --no-render-markdown");
  console.log("  node tools/perf/index-export-files.mjs --dry-run --json");
}

function detectBackend(indexFile, backend) {
  if (backend === "json" || backend === "sqlite") {
    return backend;
  }
  return String(indexFile).toLowerCase().endsWith(".sqlite") ? "sqlite" : "json";
}

function readJsonIndex(indexFile) {
  const absolute = path.resolve(process.cwd(), indexFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Index file not found: ${absolute}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON index file ${absolute}: ${error.message}`);
  }
  return { absolute, payload };
}

function decodeArtifactContent(artifact) {
  if (typeof artifact?.content !== "string") {
    return {
      ok: false,
      reason: "missing_content",
      content: null,
    };
  }
  const format = String(artifact?.content_format ?? "utf8").toLowerCase();
  if (format === "utf8") {
    return {
      ok: true,
      reason: null,
      content: Buffer.from(artifact.content, "utf8"),
    };
  }
  if (format === "base64") {
    return {
      ok: true,
      reason: null,
      content: Buffer.from(artifact.content, "base64"),
    };
  }
  return {
    ok: false,
    reason: "unsupported_encoding",
    content: null,
  };
}

function canonicalFromArtifact(artifact) {
  if (artifact?.canonical && typeof artifact.canonical === "object") {
    return artifact.canonical;
  }
  if (typeof artifact?.canonical_json === "string" && artifact.canonical_json.trim().length > 0) {
    try {
      return JSON.parse(artifact.canonical_json);
    } catch {
      return null;
    }
  }
  return null;
}

function isSafeRelativePath(rel) {
  if (!rel || path.isAbsolute(rel)) {
    return false;
  }
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    return false;
  }
  return true;
}

function resolveTargetPath(targetRoot, candidate) {
  if (!candidate) {
    return "";
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(targetRoot, candidate);
}

function writeIfChanged(filePath, content, dryRun) {
  const existed = fs.existsSync(filePath);
  let unchanged = false;
  if (existed) {
    const previous = fs.readFileSync(filePath);
    unchanged = previous.equals(content);
  }
  if (!unchanged && !dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return {
    existed,
    written: !unchanged,
    unchanged,
    bytes_written: unchanged ? 0 : content.length,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const backend = detectBackend(args.indexFile, args.backend);
    const targetRoot = path.resolve(process.cwd(), args.target);
    let sourceFile = "";
    let payload = null;

    if (backend === "sqlite") {
      const out = readIndexFromSqlite(args.indexFile);
      sourceFile = out.absolute;
      payload = out.payload;
    } else {
      const out = readJsonIndex(args.indexFile);
      sourceFile = out.absolute;
      payload = out.payload;
    }

    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    const selectedArtifacts = artifacts.filter((artifact) => {
      if (args.normativeOnly && String(artifact?.family ?? "unknown") !== "normative") {
        return false;
      }
      return true;
    });

    const auditRoot = args.auditRoot
      ? resolveTargetPath(targetRoot, args.auditRoot)
      : path.resolve(targetRoot, "docs", "audit");

    let scanned = 0;
    let exported = 0;
    let unchanged = 0;
    let missingContent = 0;
    let renderedFromCanonical = 0;
    let renderedIncrementalFromCanonical = 0;
    let skippedUnsafePath = 0;
    let skippedUnsupportedEncoding = 0;
    let bytesWritten = 0;
    const warnings = [];

    for (const artifact of selectedArtifacts) {
      scanned += 1;
      const relPath = String(artifact?.path ?? "");
      if (!isSafeRelativePath(relPath)) {
        skippedUnsafePath += 1;
        warnings.push(`unsafe_path:${relPath}`);
        continue;
      }
      let decoded = decodeArtifactContent(artifact);
      if (!decoded.ok && decoded.reason === "unsupported_encoding") {
        skippedUnsupportedEncoding += 1;
        warnings.push(`unsupported_encoding:${relPath}`);
        continue;
      }
      if (!decoded.ok && decoded.reason === "missing_content" && args.renderMarkdown) {
        const canonical = canonicalFromArtifact(artifact);
        if (canonical && typeof canonical === "object") {
          const outputPath = path.resolve(auditRoot, relPath.replace(/\//g, path.sep));
          const existingMarkdown = fs.existsSync(outputPath)
            ? fs.readFileSync(outputPath, "utf8")
            : null;
          const rendered = renderOrMergeCanonicalMarkdown(canonical, artifact, existingMarkdown);
          decoded = {
            ok: true,
            reason: null,
            content: Buffer.from(rendered.content, "utf8"),
          };
          renderedFromCanonical += 1;
          if (rendered.mode === "incremental") {
            renderedIncrementalFromCanonical += 1;
          }
        }
      }
      if (!decoded.ok) {
        missingContent += 1;
        warnings.push(`missing_content:${relPath}`);
        continue;
      }

      const outputPath = path.resolve(auditRoot, relPath.replace(/\//g, path.sep));
      const out = writeIfChanged(outputPath, decoded.content, args.dryRun);
      if (out.unchanged) {
        unchanged += 1;
      } else {
        exported += 1;
        bytesWritten += out.bytes_written;
      }
    }

    const result = {
      ts: new Date().toISOString(),
      backend,
      source_index: sourceFile,
      target_root: targetRoot,
      audit_root: auditRoot,
      dry_run: args.dryRun,
      strict: args.strict,
      normative_only: args.normativeOnly,
      summary: {
        artifacts_total: artifacts.length,
        artifacts_selected: selectedArtifacts.length,
        scanned,
        exported,
        unchanged,
        missing_content: missingContent,
        rendered_from_canonical: renderedFromCanonical,
        rendered_incremental_from_canonical: renderedIncrementalFromCanonical,
        skipped_unsafe_path: skippedUnsafePath,
        skipped_unsupported_encoding: skippedUnsupportedEncoding,
        bytes_written: bytesWritten,
      },
      warnings,
    };

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Index source: ${result.source_index}`);
      console.log(`Target audit root: ${result.audit_root}`);
      console.log(`Backend: ${result.backend}`);
      console.log(`Selected artifacts: ${result.summary.artifacts_selected}`);
      console.log(`Exported: ${result.summary.exported}`);
      console.log(`Unchanged: ${result.summary.unchanged}`);
      console.log(`Missing content: ${result.summary.missing_content}`);
      console.log(`Rendered from canonical: ${result.summary.rendered_from_canonical}`);
      console.log(`Rendered incremental from canonical: ${result.summary.rendered_incremental_from_canonical}`);
      console.log(`Bytes written: ${result.summary.bytes_written}`);
      if (warnings.length > 0) {
        console.log(`Warnings: ${warnings.length}`);
      }
    }

    if (args.strict && (missingContent > 0 || skippedUnsafePath > 0 || skippedUnsupportedEncoding > 0)) {
      process.exit(2);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
