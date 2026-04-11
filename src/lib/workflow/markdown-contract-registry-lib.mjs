import path from "node:path";
import { analyzeStructuredArtifact, inspectStructuredField } from "./structured-artifact-parser-lib.mjs";

const CRITICAL_MARKDOWN_CONTRACT_VERSION = "critical-markdown-v1";

function normalizeScalar(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return normalizeScalar(value).toLowerCase().replace(/\s+/g, "_");
}

function normalizeRelativePath(value) {
  return normalizeScalar(value).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function buildVariant(definition) {
  return Object.freeze({
    id: normalizeScalar(definition?.id),
    description: normalizeScalar(definition?.description),
    required_sections: Object.freeze(Array.isArray(definition?.required_sections) ? definition.required_sections.map(normalizeKey).filter(Boolean) : []),
    required_fields: Object.freeze(Array.isArray(definition?.required_fields) ? definition.required_fields.map(normalizeKey).filter(Boolean) : []),
    field_types: Object.freeze(Object.fromEntries(Object.entries(definition?.field_types ?? {})
      .map(([fieldName, fieldType]) => [normalizeKey(fieldName), normalizeKey(fieldType)])
      .filter((entry) => entry[0] && entry[1]))),
  });
}

function buildContract(definition) {
  return Object.freeze({
    artifact_type: normalizeKey(definition?.artifact_type),
    contract_version: normalizeScalar(definition?.contract_version || CRITICAL_MARKDOWN_CONTRACT_VERSION),
    required_sections: Object.freeze(Array.isArray(definition?.required_sections) ? definition.required_sections.map(normalizeKey).filter(Boolean) : []),
    required_fields: Object.freeze(Array.isArray(definition?.required_fields) ? definition.required_fields.map(normalizeKey).filter(Boolean) : []),
    field_types: Object.freeze(Object.fromEntries(Object.entries(definition?.field_types ?? {})
      .map(([fieldName, fieldType]) => [normalizeKey(fieldName), normalizeKey(fieldType)])
      .filter((entry) => entry[0] && entry[1]))),
    legacy_variants: Object.freeze(Array.isArray(definition?.legacy_variants) ? definition.legacy_variants.map(buildVariant) : []),
  });
}

const CRITICAL_MARKDOWN_CONTRACTS = Object.freeze({
  current_state: buildContract({
    artifact_type: "current_state",
    required_sections: ["summary", "active_context", "blocking_findings"],
    required_fields: [
      "contract_version",
      "updated_at",
      "runtime_state_mode",
      "repair_layer_status",
      "active_session",
      "active_cycle",
      "branch_kind",
      "mode",
      "dor_state",
      "blocking_findings",
    ],
    field_types: {
      contract_version: "scalar",
      updated_at: "scalar",
      runtime_state_mode: "scalar",
      repair_layer_status: "scalar",
      active_session: "scalar",
      active_cycle: "scalar",
      branch_kind: "scalar",
      mode: "scalar",
      dor_state: "scalar",
      blocking_findings: "list",
    },
    legacy_variants: [
      {
        id: "gowire_current_state_minimal",
        description: "Root current-state digest without explicit contract version, accepted from live gowire recovery corpus.",
        required_sections: ["summary", "active_context", "blocking_findings"],
        required_fields: [
          "updated_at",
          "runtime_state_mode",
          "repair_layer_status",
          "active_session",
          "active_cycle",
          "branch_kind",
          "mode",
          "dor_state",
          "blocking_findings",
        ],
        field_types: {
          updated_at: "scalar",
          runtime_state_mode: "scalar",
          repair_layer_status: "scalar",
          active_session: "scalar",
          active_cycle: "scalar",
          branch_kind: "scalar",
          mode: "scalar",
          dor_state: "scalar",
          blocking_findings: "list",
        },
      },
    ],
  }),
  runtime_state: buildContract({
    artifact_type: "runtime_state",
    required_sections: ["summary", "current_state_freshness", "blocking_findings", "prioritized_reads"],
    required_fields: [
      "contract_version",
      "updated_at",
      "runtime_state_mode",
      "repair_layer_status",
      "repair_primary_reason",
      "repair_routing_hint",
      "current_state_freshness",
      "blocking_findings",
      "prioritized_artifacts",
    ],
    field_types: {
      contract_version: "scalar",
      updated_at: "scalar",
      runtime_state_mode: "scalar",
      repair_layer_status: "scalar",
      repair_primary_reason: "scalar",
      repair_routing_hint: "scalar",
      current_state_freshness: "scalar",
      blocking_findings: "list",
      prioritized_artifacts: "list",
    },
    legacy_variants: [
      {
        id: "gowire_runtime_state_minimal",
        description: "Legacy runtime-state digest without explicit contract version.",
        required_sections: ["summary", "current_state_freshness", "blocking_findings", "prioritized_reads"],
        required_fields: [
          "updated_at",
          "runtime_state_mode",
          "repair_layer_status",
          "repair_primary_reason",
          "repair_routing_hint",
          "current_state_freshness",
          "blocking_findings",
          "prioritized_artifacts",
        ],
        field_types: {
          updated_at: "scalar",
          runtime_state_mode: "scalar",
          repair_layer_status: "scalar",
          repair_primary_reason: "scalar",
          repair_routing_hint: "scalar",
          current_state_freshness: "scalar",
          blocking_findings: "list",
          prioritized_artifacts: "list",
        },
      },
    ],
  }),
  handoff_packet: buildContract({
    artifact_type: "handoff_packet",
    required_sections: ["summary", "active_context", "runtime_signals", "blocking_findings", "prioritized_reads"],
    required_fields: [
      "contract_version",
      "updated_at",
      "handoff_status",
      "mode",
      "branch_kind",
      "active_session",
      "active_cycle",
      "runtime_state_mode",
      "repair_layer_status",
      "current_state_freshness",
      "blocking_findings",
      "prioritized_artifacts",
    ],
    field_types: {
      contract_version: "scalar",
      updated_at: "scalar",
      handoff_status: "scalar",
      mode: "scalar",
      branch_kind: "scalar",
      active_session: "scalar",
      active_cycle: "scalar",
      runtime_state_mode: "scalar",
      repair_layer_status: "scalar",
      current_state_freshness: "scalar",
      blocking_findings: "list",
      prioritized_artifacts: "list",
    },
    legacy_variants: [
      {
        id: "gowire_handoff_packet_minimal",
        description: "Legacy handoff packet without explicit contract version.",
        required_sections: ["summary", "active_context", "runtime_signals", "blocking_findings", "prioritized_reads"],
        required_fields: [
          "updated_at",
          "handoff_status",
          "mode",
          "branch_kind",
          "active_session",
          "active_cycle",
          "runtime_state_mode",
          "repair_layer_status",
          "current_state_freshness",
          "blocking_findings",
          "prioritized_artifacts",
        ],
        field_types: {
          updated_at: "scalar",
          handoff_status: "scalar",
          mode: "scalar",
          branch_kind: "scalar",
          active_session: "scalar",
          active_cycle: "scalar",
          runtime_state_mode: "scalar",
          repair_layer_status: "scalar",
          current_state_freshness: "scalar",
          blocking_findings: "list",
          prioritized_artifacts: "list",
        },
      },
    ],
  }),
  session: buildContract({
    artifact_type: "session",
    required_sections: [
      "work_mode_required",
      "session_branch_continuity_required",
      "branch_context_required_for_committing",
      "session_cycle_tracking_required_for_committing",
      "session_close_report_required",
    ],
    required_fields: [
      "contract_version",
      "session_branch",
      "parent_session",
      "branch_kind",
      "integration_target_cycles",
      "primary_focus_cycle",
      "attached_cycles",
      "carry_over_pending",
    ],
    field_types: {
      contract_version: "scalar",
      session_branch: "scalar",
      parent_session: "scalar",
      branch_kind: "scalar",
      integration_target_cycles: "list",
      primary_focus_cycle: "scalar",
      attached_cycles: "list",
      carry_over_pending: "scalar",
    },
    legacy_variants: [
      {
        id: "flattened_session_markdown",
        description: "Flattened one-line session markdown tolerated from recovered live corpora such as gowire.",
        required_sections: [
          "work_mode_-_committing",
          "session_branch_continuity_required",
          "branch_context_required_for_committing",
          "session_cycle_tracking_required_for_committing",
          "session_close_report_required",
        ],
        required_fields: [
          "session_branch",
          "parent_session",
          "branch_kind",
          "attached_cycles",
          "carry_over_pending",
        ],
        field_types: {
          session_branch: "scalar",
          parent_session: "scalar",
          branch_kind: "scalar",
          attached_cycles: "list",
          carry_over_pending: "scalar",
        },
      },
    ],
  }),
  cycle_status: buildContract({
    artifact_type: "cycle_status",
    required_sections: [],
    required_fields: [
      "contract_version",
      "state",
      "branch_name",
      "dor_state",
    ],
    field_types: {
      contract_version: "scalar",
      state: "scalar",
      branch_name: "scalar",
      dor_state: "scalar",
    },
    legacy_variants: [
      {
        id: "flat_cycle_status_minimal",
        description: "Minimal flat cycle status tolerated from live recovery corpora.",
        required_sections: [],
        required_fields: [
          "state",
          "branch_name",
          "dor_state",
        ],
        field_types: {
          state: "scalar",
          branch_name: "scalar",
          dor_state: "scalar",
        },
      },
    ],
  }),
});

function resolveArtifactType(options = {}) {
  const relativePath = normalizeRelativePath(options.relativePath);
  const basename = path.basename(relativePath);
  const subtype = normalizeKey(options.classification?.subtype ?? options.subtype ?? "");
  const kind = normalizeKey(options.classification?.kind ?? options.kind ?? "");
  if (subtype === "current_state" || basename === "CURRENT-STATE.md") {
    return "current_state";
  }
  if (subtype === "runtime_state" || basename === "RUNTIME-STATE.md") {
    return "runtime_state";
  }
  if (subtype === "handoff_packet" || basename === "HANDOFF-PACKET.md") {
    return "handoff_packet";
  }
  if (kind === "session" || subtype === "session" || /^sessions\/S\d+.*\.md$/i.test(relativePath)) {
    return "session";
  }
  if (kind === "cycle_status" || (subtype === "status" && /^cycles\/[^/]+\/status\.md$/i.test(relativePath))) {
    return "cycle_status";
  }
  return null;
}

function createFinding(input = {}) {
  return {
    code: normalizeScalar(input.code) || "UNKNOWN_CONTRACT_FINDING",
    severity: normalizeScalar(input.severity) || "warning",
    message: normalizeScalar(input.message),
    field: normalizeScalar(input.field) || null,
    section: normalizeScalar(input.section) || null,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
  };
}

function validateFieldType(details, expectedType) {
  const scalar = normalizeScalar(details?.scalar);
  switch (normalizeKey(expectedType)) {
    case "scalar":
      return Boolean(details?.present) && Boolean(scalar) && details?.style !== "list";
    case "list":
      return Boolean(details?.present) && (details?.style === "list" || details?.style === "mixed");
    case "list_or_scalar":
      return Boolean(details?.present) && (Boolean(scalar) || details?.style === "list" || details?.style === "mixed");
    default:
      return Boolean(details?.present);
  }
}

function validateDefinition(definition, analysis, options = {}) {
  const sectionKeys = new Set((analysis?.structured_sections ?? []).map((section) => normalizeKey(section?.key ?? section?.text)));
  const skippedFields = new Set(Array.isArray(options.skip_fields) ? options.skip_fields.map(normalizeKey).filter(Boolean) : []);
  const findings = [];
  for (const section of definition.required_sections ?? []) {
    if (!sectionKeys.has(normalizeKey(section))) {
      findings.push(createFinding({
        code: "MISSING_REQUIRED_SECTION",
        severity: "warning",
        section,
        expected: section,
        message: `Missing required section: ${section}`,
      }));
    }
  }
  for (const fieldName of definition.required_fields ?? []) {
    if (skippedFields.has(normalizeKey(fieldName))) {
      continue;
    }
    const details = inspectStructuredField(analysis?.normalized_text ?? "", fieldName);
    if (!details.present) {
      findings.push(createFinding({
        code: "MISSING_REQUIRED_FIELD",
        severity: "warning",
        field: fieldName,
        expected: definition.field_types?.[fieldName] ?? "present",
        message: `Missing required field: ${fieldName}`,
      }));
      continue;
    }
    const expectedType = definition.field_types?.[fieldName];
    if (expectedType && !validateFieldType(details, expectedType)) {
      findings.push(createFinding({
        code: "FIELD_TYPE_MISMATCH",
        severity: "warning",
        field: fieldName,
        expected: expectedType,
        actual: details.style ?? "unknown",
        message: `Field ${fieldName} does not satisfy expected type ${expectedType}`,
      }));
    }
  }
  return {
    pass: findings.length === 0,
    findings,
  };
}

function resolveExplicitVersion(analysis) {
  const direct = normalizeScalar(analysis?.key_values?.contract_version);
  if (direct) {
    return direct;
  }
  return normalizeScalar(analysis?.key_values?.markdown_contract_version);
}

export function listCriticalMarkdownContracts() {
  return Object.values(CRITICAL_MARKDOWN_CONTRACTS);
}

export function resolveCriticalMarkdownContract(options = {}) {
  const artifactType = resolveArtifactType(options);
  if (!artifactType) {
    return null;
  }
  return CRITICAL_MARKDOWN_CONTRACTS[artifactType] ?? null;
}

export function validateCriticalMarkdownContract(content, options = {}) {
  const contract = resolveCriticalMarkdownContract(options);
  if (!contract) {
    return null;
  }
  const analysis = options.analysis ?? analyzeStructuredArtifact(content, options);
  const explicitVersion = resolveExplicitVersion(analysis);
  const baseline = validateDefinition(contract, analysis, {
    skip_fields: explicitVersion ? [] : ["contract_version"],
  });
  const baseOutput = {
    artifact_type: contract.artifact_type,
    contract_version: explicitVersion || contract.contract_version,
    contract_status: "non_conformant",
    contract_findings: [],
    legacy_shape_id: null,
  };

  if (explicitVersion) {
    if (explicitVersion !== contract.contract_version) {
      return {
        ...baseOutput,
        contract_findings: [
          createFinding({
            code: "INVALID_CONTRACT_VERSION",
            severity: "warning",
            field: "contract_version",
            expected: contract.contract_version,
            actual: explicitVersion,
            message: `Explicit contract_version ${explicitVersion} does not match expected ${contract.contract_version}`,
          }),
          ...baseline.findings,
        ],
      };
    }
    if (baseline.pass) {
      return {
        ...baseOutput,
        contract_version: contract.contract_version,
        contract_status: "conformant",
      };
    }
    return {
      ...baseOutput,
      contract_version: contract.contract_version,
      contract_findings: baseline.findings,
    };
  }

  if (baseline.pass) {
    return {
      ...baseOutput,
      contract_version: contract.contract_version,
      contract_status: "legacy_tolerated",
      legacy_shape_id: "implicit_current_contract",
      contract_findings: [
        createFinding({
          code: "MISSING_EXPLICIT_CONTRACT_VERSION",
          severity: "warning",
          field: "contract_version",
          expected: contract.contract_version,
          actual: null,
          message: "Critical artifact matches the current contract shape but does not declare an explicit contract_version",
        }),
      ],
    };
  }

  for (const variant of contract.legacy_variants ?? []) {
    const result = validateDefinition(variant, analysis, {
      skip_fields: explicitVersion ? [] : ["contract_version"],
    });
    if (!result.pass) {
      continue;
    }
    return {
      ...baseOutput,
      contract_version: contract.contract_version,
      contract_status: "legacy_tolerated",
      legacy_shape_id: variant.id || null,
      contract_findings: [
        createFinding({
          code: "MISSING_EXPLICIT_CONTRACT_VERSION",
          severity: "warning",
          field: "contract_version",
          expected: contract.contract_version,
          actual: null,
          message: "Critical artifact matched a tolerated legacy shape without an explicit contract_version",
        }),
      ],
    };
  }

  return {
    ...baseOutput,
    contract_version: contract.contract_version,
    contract_findings: [
      createFinding({
        code: "MISSING_EXPLICIT_CONTRACT_VERSION",
        severity: "warning",
        field: "contract_version",
        expected: contract.contract_version,
        actual: null,
        message: "Critical artifact does not declare an explicit contract_version",
      }),
      ...baseline.findings,
    ],
  };
}
