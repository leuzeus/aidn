import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { agenticSegmentArtifact, agenticSegmentEnds } from "../ci/agentic-fixture-segments-lib.mjs";

const qualification = ".github/workflows/agentic-fixture-qualification.yml";
const leaf = ".github/workflows/agentic-fixture-segment.yml";
const requiredString = { required: true, type: "string" };
const inputs = { source: requiredString, context: requiredString };
const contentsRead = { contents: "read" };

export const hostedPublicationVerification = "node tools/ci/run-hosted-gate-family.mjs obligations main";

export function expectedAgenticQualificationJob({ needs, source, context, condition }) {
  return { name: "Qualify Required Agentic Fixtures", needs, ...(condition ? { if: condition } : {}),
    uses: `./${qualification}`, with: { source, context } };
}

export function expectedAgenticReceiptDownload(condition) {
  return { name: "Download Agentic Fixture Receipts", ...(condition ? { if: condition } : {}),
    uses: "actions/download-artifact@v4", with: {
      pattern: agenticSegmentArtifact + "*", path: "${{ runner.temp }}/aidn-agentic-segments",
    } };
}

export function readHostedAgenticWorkflowGraph(repoRoot) {
  return [qualification, leaf].map(relative => {
    const document = parseDocument(fs.readFileSync(path.join(repoRoot, relative), "utf8"), { strict: true, uniqueKeys: true });
    if (document.errors.length) throw Error(`${relative}: invalid hosted agentic workflow YAML`);
    return document.toJS();
  });
}

export function hostedAgenticWorkflowIssues([chain, job]) {
  const expectedChain = {
    name: "Required Agentic Fixture Qualification",
    on: { workflow_call: { inputs } },
    permissions: contentsRead,
    jobs: Object.fromEntries(agenticSegmentEnds.map((_, index) => [`segment_${index + 1}`, {
      ...(index ? { needs: `segment_${index}` } : {}), uses: `./${leaf}`,
      with: { source: "${{ inputs.source }}", context: "${{ inputs.context }}", segment: index + 1 },
    }])),
  };
  const expectedJob = {
    name: "Agentic Fixture Segment",
    on: { workflow_call: { inputs: { ...inputs, segment: { required: true, type: "number" } } } },
    permissions: contentsRead,
    jobs: { fixtures: {
      name: "Run Required Agentic Fixture Segment",
      "runs-on": "ubuntu-latest",
      steps: [
        { name: "Checkout Exact Candidate", uses: "actions/checkout@v4", with: { ref: "${{ inputs.source }}", "fetch-depth": 0 } },
        { name: "Setup Node", uses: "actions/setup-node@v4", with: { "node-version": "22.13" } },
        { name: "Install Locked Gate Dependencies", run: "npm ci --include=dev --include=optional --ignore-scripts --no-audit --no-fund" },
        { name: "Resolve Ephemeral PostgreSQL Runtime", run: "node tools/ci/resolve-postgres-test-runtime.mjs" },
        { name: "Run Required Segment", env: { AIDN_AGENTIC_SOURCE_SHA: "${{ inputs.source }}",
          AIDN_AGENTIC_SEGMENT: "${{ inputs.segment }}", AIDN_GATE_CONTEXT: "${{ inputs.context }}" },
        run: "node tools/ci/run-agentic-fixture-segment.mjs" },
        { name: "Retain Required Segment Receipt", uses: "actions/upload-artifact@v4", with: {
          name: agenticSegmentArtifact + "${{ inputs.segment }}", path: "${{ runner.temp }}/aidn-agentic-segment.json",
          "if-no-files-found": "error", overwrite: true,
        } },
      ],
    } },
  };
  const issues = [];
  if (!isDeepStrictEqual(chain, expectedChain)) issues.push("hosted agentic qualification must run every required segment in order on the same source");
  if (!isDeepStrictEqual(job, expectedJob)) issues.push("hosted agentic segments require blocking exact checkout, execution and receipt upload");
  return issues;
}
