import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const LOCKED_GATE_INSTALL_COMMAND = "npm ci --include=dev --ignore-scripts --no-audit --no-fund";
const DEPENDENCY_BEARING_GATE_COMMANDS = new Set([
  "verify:cleanliness",
  "verify:release",
]);

const REQUIRED_OBLIGATIONS = Object.freeze({
  "contracts-json": ["dev", "main", "release"],
  "contracts-surface-catalog": ["dev", "main", "release"],
  "effects-policy": ["dev", "main", "release"],
  "effects-no-implicit-write": ["dev", "main", "release"],
  "effects-db-migrate-write-boundary": ["dev", "main", "release"],
  "governance-source": ["dev", "main", "release"],
  "governance-metadata": ["dev", "main", "release"],
  "governance-completeness": ["dev", "main", "release"],
  "docs-references": ["dev", "main", "release"],
  "codex-pack-topology": ["dev", "main", "release"],
  "runtime-db-runtime-cli": ["dev", "main", "release"],
  "security-tracked-sensitivity": ["dev", "main", "release"],
  "release-version": ["dev", "main", "release"],
  "release-reproducibility": ["dev", "main", "release"],
  "release-workflow-policy": ["dev", "main", "release"],
  "cleanliness-branch-policy": ["dev", "main", "release"],
  "cleanliness-gate-catalog": ["dev", "main", "release"],
  "cleanliness-gate-runner-fixtures": ["dev", "main", "release"],
  "cleanliness-worktree": ["dev", "main", "release"],
});

const REQUIRED_GATE_SCRIPTS = Object.freeze({
  "contracts-json": "perf:verify-cli-output-contracts",
  "effects-policy": "perf:verify-cli-effect-policy",
  "runtime-db-runtime-cli": "perf:verify-db-runtime-cli",
  "codex-pack-topology": "perf:verify-pack-topology",
  "security-tracked-sensitivity": "perf:verify-tracked-sensitivity",
  "release-version": "perf:verify-release-version",
  "release-reproducibility": "perf:verify-release-reproducibility",
  "release-workflow-policy": "perf:verify-release-workflow-policy",
  "cleanliness-branch-policy": "perf:verify-branch-policy",
  "cleanliness-gate-catalog": "perf:verify-gate-catalog",
  "cleanliness-gate-runner-fixtures": "perf:verify-gate-runner-fixtures",
  "cleanliness-worktree": "perf:verify-repository-cleanliness",
});

const REQUIRED_GATE_CONDITIONS = Object.freeze({
  "release-reproducibility": "git-clean-commit",
  "cleanliness-gate-runner-fixtures": "git-repository",
  "cleanliness-worktree": "git-repository",
});

const REQUIRED_WORKFLOW_POLICY = Object.freeze({
  ".github/workflows/governance-admission.yml": {
    triggers: {
      pull_request: ["dev", "main"],
      workflow_dispatch: [],
    },
    jobs: {
      classify: [],
      gates: [],
      admission: [],
      "legacy-contracts": [],
      "legacy-governance": [],
      "legacy-docs": [],
      "legacy-codex": [],
      "legacy-runtime": [],
      "legacy-runtime-ops": [],
      "legacy-runtime-mode": [],
      "legacy-shared-boundary": [],
      "legacy-security": [],
      "legacy-release": [],
      "legacy-cleanliness": [],
    },
  },
  ".github/workflows/release.yml": {
    triggers: {
      push: ["main"],
    },
    jobs: {
      publish: ["verify:release", "perf:verify-release-artifacts"],
    },
  },
  ".github/workflows/runtime-ops-live-smoke.yml": {
    triggers: {
      workflow_dispatch: [],
    },
    jobs: {
      "live-smoke": {
        commands: [
          "perf:verify-postgres-runtime-persistence-live-smoke",
          "perf:verify-postgres-shared-coordination-live-smoke",
        ],
        steps: [
          { uses: "actions/checkout@v4" },
          { uses: "actions/setup-node@v4" },
          {
            run: "npm ci --include=optional --ignore-scripts --no-audit --no-fund",
          },
          {
            run: "node --input-type=module --eval \"await import('pg'); console.log('PostgreSQL driver preflight: PASS')\"",
          },
          { command: "perf:verify-postgres-runtime-persistence-live-smoke" },
          { command: "perf:verify-postgres-shared-coordination-live-smoke" },
        ],
      },
    },
  },
});

function stripComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const token = line[index];
    if (token === "'" && !double) {
      single = !single;
    } else if (token === "\"" && !single && line[index - 1] !== "\\") {
      double = !double;
    } else if (token === "#" && !single && !double) {
      return line.slice(0, index);
    }
  }
  return line;
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function parseInlineList(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith("[") || !normalized.endsWith("]")) {
    return [];
  }
  return normalized.slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function npmCommands(text) {
  return [...String(text ?? "").matchAll(/\bnpm\s+run\s+([a-z0-9:_-]+)/gi)]
    .map((match) => match[1]);
}

function scalarValue(value) {
  const normalized = String(value ?? "").trim();
  const quote = normalized[0];
  if ((quote === "\"" || quote === "'") && normalized.endsWith(quote)) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

export function validateWorkflowYamlSyntax(text, relativePath = "workflow.yml") {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  try {
    const document = parseDocument(String(text ?? ""), {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    return document.errors.map((error) => (
      `${normalizedPath}: invalid YAML (${String(error.message).replace(/\s+/gu, " ").trim()})`
    ));
  } catch (error) {
    return [
      `${normalizedPath}: YAML parser failure (${String(error?.message ?? error).replace(/\s+/gu, " ").trim()})`,
    ];
  }
}

export function parseWorkflowStructure(text, relativePath = "workflow.yml") {
  const rawLines = String(text ?? "").split(/\r?\n/);
  const lines = rawLines.map(stripComment);
  const triggers = {};
  const jobs = {};
  const duplicateJobs = [];
  let section = "";
  let currentTrigger = "";
  let currentJob = "";
  let inSteps = false;
  let currentStep = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = indentation(line);
    if (indent === 0) {
      section = trimmed === "on:" ? "on" : trimmed === "jobs:" ? "jobs" : "";
      currentTrigger = "";
      currentJob = "";
      inSteps = false;
      currentStep = null;
      continue;
    }
    if (section === "on") {
      const triggerMatch = indent === 2 ? trimmed.match(/^([a-z_]+):(?:\s*(.*))?$/) : null;
      if (triggerMatch) {
        currentTrigger = triggerMatch[1];
        triggers[currentTrigger] = {
          branches: parseInlineList(triggerMatch[2]),
        };
        continue;
      }
      const branchesMatch = indent === 4 && currentTrigger
        ? trimmed.match(/^branches:\s*(.*)$/)
        : null;
      if (branchesMatch) {
        triggers[currentTrigger].branches = parseInlineList(branchesMatch[1]);
      }
      continue;
    }
    if (section !== "jobs") {
      continue;
    }
    const jobMatch = indent === 2 ? trimmed.match(/^([a-zA-Z0-9_-]+):\s*$/) : null;
    if (jobMatch) {
      currentJob = jobMatch[1];
      if (jobs[currentJob]) {
        duplicateJobs.push(currentJob);
      }
      jobs[currentJob] = {
        commands: [],
        steps: [],
      };
      inSteps = false;
      currentStep = null;
      continue;
    }
    if (!currentJob) {
      continue;
    }
    if (indent === 4 && trimmed === "steps:") {
      inSteps = true;
      currentStep = null;
      continue;
    }
    if (inSteps && indent <= 4) {
      inSteps = false;
      currentStep = null;
    }
    if (!inSteps) {
      continue;
    }

    let fieldMatch = null;
    const stepMatch = indent === 6
      ? trimmed.match(/^-\s+([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))?$/)
      : null;
    if (stepMatch) {
      currentStep = {
        name: "",
        uses: "",
        run: "",
        commands: [],
      };
      jobs[currentJob].steps.push(currentStep);
      fieldMatch = stepMatch;
    } else if (currentStep && indent >= 8) {
      fieldMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))?$/);
    }
    if (!fieldMatch || !currentStep) {
      continue;
    }

    const field = fieldMatch[1];
    const scalar = String(fieldMatch[2] ?? "").trim();
    if (field === "name") {
      currentStep.name = scalarValue(scalar);
      continue;
    }
    if (field === "uses") {
      currentStep.uses = scalarValue(scalar);
      continue;
    }
    if (field !== "run") {
      continue;
    }

    let commandText = scalarValue(scalar);
    if (scalar === "|" || scalar === ">") {
      const block = [];
      for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
        if (lines[blockIndex].trim() && indentation(lines[blockIndex]) <= indent) {
          break;
        }
        block.push(lines[blockIndex].trim());
        index = blockIndex;
      }
      commandText = block.join("\n").trimEnd();
    }
    currentStep.run = commandText;
    currentStep.commands = npmCommands(commandText);
    jobs[currentJob].commands.push(...currentStep.commands);
  }
  return {
    path: relativePath.replaceAll("\\", "/"),
    triggers,
    jobs,
    duplicate_jobs: duplicateJobs,
  };
}

export function loadWorkflowModels(repoRoot) {
  return loadWorkflowSources(repoRoot)
    .map(({ path: relativePath, text }) => parseWorkflowStructure(text, relativePath));
}

export function loadWorkflowSources(repoRoot) {
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  return fs.readdirSync(workflowRoot)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const relativePath = `.github/workflows/${name}`;
      return {
        path: relativePath,
        text: fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
      };
    });
}

function sameStringSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export function validateGateAndWorkflowPolicy({
  catalog,
  packageJson,
  workflowModels,
}) {
  const issues = [];
  const gates = Array.isArray(catalog?.gates) ? catalog.gates : [];
  const gateById = new Map();
  const gateByScript = new Map();
  for (const gate of gates) {
    if (gateById.has(gate.id)) {
      issues.push(`${gate.id}: duplicate gate id`);
    }
    gateById.set(gate.id, gate);
    if (gateByScript.has(gate.script) && gate.allow_script_reuse !== true) {
      issues.push(
        `${gate.id}: duplicate gate script ${gate.script}; explicit allow_script_reuse is required`,
      );
    } else {
      gateByScript.set(gate.script, gate);
    }
  }
  for (const [gateId, contexts] of Object.entries(REQUIRED_OBLIGATIONS)) {
    const gate = gateById.get(gateId);
    if (!gate) {
      issues.push(`${gateId}: required invariant gate missing`);
      continue;
    }
    for (const context of contexts) {
      if (gate.obligation?.[context] !== "required") {
        issues.push(`${gateId}: immutable ${context} obligation must be required`);
      }
    }
  }
  for (const [gateId, script] of Object.entries(REQUIRED_GATE_SCRIPTS)) {
    if (gateById.get(gateId)?.script !== script) {
      issues.push(`${gateId}: immutable script must be ${script}`);
    }
  }
  for (const [gateId, condition] of Object.entries(REQUIRED_GATE_CONDITIONS)) {
    if (gateById.get(gateId)?.condition !== condition) {
      issues.push(`${gateId}: immutable condition must be ${condition}`);
    }
  }

  const inventory = Array.isArray(catalog?.workflow_inventory)
    ? catalog.workflow_inventory
    : [];
  const inventoryByPath = new Map(inventory.map((item) => [item.path, item]));
  const modelByPath = new Map(workflowModels.map((item) => [item.path, item]));
  for (const model of workflowModels) {
    for (const job of model.duplicate_jobs ?? []) {
      issues.push(`${model.path}: duplicate job ${job}`);
    }
    if (!inventoryByPath.has(model.path)) {
      issues.push(`${model.path}: tracked workflow is absent from workflow_inventory`);
    }
  }
  for (const item of inventory) {
    if (!modelByPath.has(item.path)) {
      issues.push(`${item.path}: inventoried workflow is missing`);
    }
  }

  for (const [workflowPath, policy] of Object.entries(REQUIRED_WORKFLOW_POLICY)) {
    const model = modelByPath.get(workflowPath);
    if (!model) {
      issues.push(`${workflowPath}: required workflow missing`);
      continue;
    }
    for (const [trigger, branches] of Object.entries(policy.triggers)) {
      if (!model.triggers[trigger]) {
        issues.push(`${workflowPath}: missing semantic ${trigger} trigger`);
      } else if (!sameStringSet(model.triggers[trigger].branches, branches)) {
        issues.push(
          `${workflowPath}: ${trigger} branches mismatch `
          + `(${model.triggers[trigger].branches.join(",")} != ${branches.join(",")})`,
        );
      }
    }
    for (const [job, jobPolicy] of Object.entries(policy.jobs)) {
      if (!model.jobs[job]) {
        issues.push(`${workflowPath}: missing job ${job}`);
        continue;
      }
      const commands = Array.isArray(jobPolicy) ? jobPolicy : (jobPolicy.commands ?? []);
      for (const command of commands) {
        if (!model.jobs[job].commands.includes(command)) {
          issues.push(`${workflowPath}/${job}: missing semantic npm command ${command}`);
        }
      }
      const expectedSteps = Array.isArray(jobPolicy) ? null : jobPolicy.steps;
      if (!expectedSteps) {
        continue;
      }
      const actualSteps = model.jobs[job].steps ?? [];
      if (actualSteps.length !== expectedSteps.length) {
        issues.push(
          `${workflowPath}/${job}: semantic step count mismatch `
          + `(${actualSteps.length} != ${expectedSteps.length})`,
        );
        continue;
      }
      for (const [stepIndex, expectedStep] of expectedSteps.entries()) {
        const actualStep = actualSteps[stepIndex];
        const matches = (expectedStep.uses == null || actualStep.uses === expectedStep.uses)
          && (expectedStep.run == null || actualStep.run === expectedStep.run)
          && (expectedStep.command == null
            || actualStep.commands.includes(expectedStep.command));
        if (!matches) {
          const expected = expectedStep.uses ?? expectedStep.run ?? expectedStep.command;
          issues.push(
            `${workflowPath}/${job}: semantic step ${stepIndex + 1} mismatch `
            + `(expected ${expected})`,
          );
        }
      }
    }
  }

  for (const model of workflowModels) {
    for (const [jobName, job] of Object.entries(model.jobs)) {
      const steps = job.steps ?? [];
      for (const [stepIndex, step] of steps.entries()) {
        const dependencyBearingCommand = step.commands.find((command) => (
          DEPENDENCY_BEARING_GATE_COMMANDS.has(command)
        ));
        if (!dependencyBearingCommand) {
          continue;
        }
        const installIndex = steps.findIndex((candidate, candidateIndex) => (
          candidateIndex < stepIndex && candidate.run === LOCKED_GATE_INSTALL_COMMAND
        ));
        if (installIndex < 0) {
          issues.push(
            `${model.path}/${jobName}: ${dependencyBearingCommand} must follow `
            + `locked dev dependency installation`,
          );
        }
      }
    }
  }

  for (const gate of gates) {
    if (!packageJson?.scripts?.[gate.script]) {
      issues.push(`${gate.id}: package script missing: ${gate.script}`);
    }
    const [workflowName, jobName] = String(gate.job ?? "").split("/");
    if (workflowName === "local") {
      continue;
    }
    const workflowPath = `.github/workflows/${workflowName}.yml`;
    const model = modelByPath.get(workflowPath);
    if (!model?.jobs?.[jobName]) {
      issues.push(`${gate.id}: declared job does not exist: ${gate.job}`);
      continue;
    }
    const commands = model.jobs[jobName].commands;
    const dynamicAdmission = gate.job === "governance-admission/gates"
      && (model.jobs[jobName].steps ?? []).some((step) => (
        String(step.run ?? "").trim()
          === "node tools/verify/run-gate-family.mjs \"${{ matrix.family }}\" "
            + "--context \"${{ needs.classify.outputs.context }}\" --admission"
      ));
    if (!commands.includes(gate.script)
      && !commands.includes(`verify:${gate.family}`)
      && !dynamicAdmission) {
      issues.push(`${gate.id}: ${gate.job} does not execute ${gate.script} or verify:${gate.family}`);
    }
    if ((gate.obligation?.dev === "required" || gate.obligation?.release === "required")
      && !sameStringSet(model.triggers.pull_request?.branches ?? [], ["dev", "main"])) {
      issues.push(`${gate.id}: required PR gate workflow must target exactly dev and main`);
    }
  }

  for (const model of workflowModels) {
    const classification = inventoryByPath.get(model.path)?.classification;
    if (!["gate", "release", "optional-live", "observability"].includes(classification)) {
      issues.push(`${model.path}: invalid workflow classification ${String(classification)}`);
    }
    if (classification === "observability") {
      continue;
    }
    for (const [jobName, job] of Object.entries(model.jobs)) {
      for (const command of job.commands.filter((item) => item.startsWith("perf:verify-"))) {
        if (command === "perf:verify-release-artifacts") {
          continue;
        }
        if (!gateByScript.has(command)) {
          issues.push(`${model.path}/${jobName}: verification command is outside gate catalog: ${command}`);
        }
      }
    }
  }
  return issues;
}
