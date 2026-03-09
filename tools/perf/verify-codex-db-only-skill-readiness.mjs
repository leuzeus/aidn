#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const MUTATING_SKILLS = new Set([
  "start-session",
  "close-session",
  "cycle-create",
  "cycle-close",
  "handoff-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
]);

function parseArgs(argv) {
  const args = {
    root: "template/codex",
    agents: "template/root/AGENTS.md",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      args.root = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--agents") {
      args.agents = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.root) {
    throw new Error("Missing value for --root");
  }
  if (!args.agents) {
    throw new Error("Missing value for --agents");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-codex-db-only-skill-readiness.mjs");
  console.log("  node tools/perf/verify-codex-db-only-skill-readiness.mjs --root template/codex --agents template/root/AGENTS.md --json");
}

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseSkillsYaml(filePath) {
  const text = readRequired(filePath);
  const skills = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+([a-z0-9-]+)\s*$/i);
    if (match) {
      skills.push(match[1]);
    }
  }
  return skills;
}

function resolveSkillsLayout(root) {
  const rootSkillsYaml = path.join(root, "skills.yaml");
  const nestedSkillsYaml = path.join(root, ".codex", "skills.yaml");
  const nestedSkillsDir = path.join(root, ".codex", "skills");
  const siblingSkillsYaml = path.join(path.dirname(root), "skills.yaml");

  if (fs.existsSync(rootSkillsYaml)) {
    const skillsDir = fs.existsSync(path.join(root, "skills"))
      ? path.join(root, "skills")
      : root;
    return {
      skillsYaml: rootSkillsYaml,
      skillsDir,
    };
  }

  if (fs.existsSync(nestedSkillsYaml) && fs.existsSync(nestedSkillsDir)) {
    return {
      skillsYaml: nestedSkillsYaml,
      skillsDir: nestedSkillsDir,
    };
  }

  if (fs.existsSync(siblingSkillsYaml)) {
    return {
      skillsYaml: siblingSkillsYaml,
      skillsDir: root,
    };
  }

  throw new Error(`Missing skills.yaml under ${root}`);
}

function checkPatterns(file, text, patterns) {
  const missingPatterns = patterns.filter((pattern) => !text.includes(pattern));
  return {
    file,
    ok: missingPatterns.length === 0,
    missing_patterns: missingPatterns,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = path.resolve(process.cwd(), args.root);
    const agentsFile = path.resolve(process.cwd(), args.agents);
    const layout = resolveSkillsLayout(root);
    const skillsYaml = layout.skillsYaml;
    const skillsDir = layout.skillsDir;
    const skills = parseSkillsYaml(skillsYaml);

    const commonPatterns = [
      "hydrate db-backed context with `npx aidn codex hydrate-context --target . --skill ",
      "--project-runtime-state --json`",
      "`repair_layer_status`",
      "`repair_layer_advice`",
      "`docs/audit/RUNTIME-STATE.md`",
      "npx aidn runtime repair-layer-triage --target . --json",
    ];
    const mutatingPatterns = [
      "--fail-on-repair-block",
      "npx aidn runtime repair-layer-autofix --target . --apply --json",
      "if blocking findings remain after triage/autofix, STOP the skill and request user arbitration.",
    ];

    const skillChecks = skills.map((skill) => {
      const file = path.resolve(skillsDir, skill, "SKILL.md");
      if (!fs.existsSync(file)) {
        return {
          skill,
          file,
          ok: false,
          missing_file: true,
          missing_patterns: [],
        };
      }
      const text = readRequired(file);
      const patterns = [...commonPatterns];
      if (MUTATING_SKILLS.has(skill)) {
        patterns.push(...mutatingPatterns);
      }
      const result = checkPatterns(file, text, patterns);
      return {
        skill,
        file,
        ok: result.ok,
        missing_file: false,
        missing_patterns: result.missing_patterns,
      };
    });

    const agentsText = readRequired(agentsFile);
    const agentsCheck = checkPatterns(agentsFile, agentsText, [
      "npx aidn codex hydrate-context --target . --skill <skill> --project-runtime-state --json",
      "`repair_layer_status`",
      "`repair_layer_advice`",
      "`docs/audit/RUNTIME-STATE.md`",
      "npx aidn runtime repair-layer-triage --target . --json",
      "npx aidn runtime repair-layer-autofix --target . --apply --json",
      "--fail-on-repair-block",
    ]);

    const pass = skillChecks.every((item) => item.ok) && agentsCheck.ok;
    const output = {
      ts: new Date().toISOString(),
      root,
      skills_yaml: skillsYaml,
      skills_dir: skillsDir,
      agents_file: agentsFile,
      skill_checks: skillChecks,
      agents_check: agentsCheck,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Root: ${root}`);
      console.log(`Skills YAML: ${skillsYaml}`);
      console.log(`Skills Dir: ${skillsDir}`);
      for (const item of skillChecks) {
        console.log(`${item.ok ? "PASS" : "FAIL"} ${item.skill} -> ${item.file}`);
        if (!item.ok && item.missing_patterns.length > 0) {
          console.log(`  Missing: ${item.missing_patterns.join(" | ")}`);
        }
      }
      console.log(`${agentsCheck.ok ? "PASS" : "FAIL"} AGENTS -> ${agentsFile}`);
      if (!agentsCheck.ok && agentsCheck.missing_patterns.length > 0) {
        console.log(`  Missing: ${agentsCheck.missing_patterns.join(" | ")}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
