export function decideReloadOutcome(reasonCodes) {
  const blocking = new Set([
    "REQUIRED_ARTIFACT_MISSING",
    "MAPPING_AMBIGUOUS",
    "MAPPING_MISSING",
  ]);
  if (reasonCodes.some((code) => blocking.has(code))) {
    return {
      decision: "stop",
      fallback: false,
    };
  }
  if (reasonCodes.length === 0) {
    return {
      decision: "incremental",
      fallback: false,
    };
  }
  return {
    decision: "full",
    fallback: true,
  };
}
