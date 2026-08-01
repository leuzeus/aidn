export function evaluateGovernanceAdmission({
  classificationResult,
  gatesResult,
  familyCount,
  lane,
} = {}) {
  const parsedFamilyCount = Number(familyCount);
  if (classificationResult !== "success") {
    return {
      ok: false,
      status: "FAIL",
      reason: `classification result is ${classificationResult || "missing"}`,
    };
  }
  if (!Number.isInteger(parsedFamilyCount) || parsedFamilyCount < 0) {
    return { ok: false, status: "FAIL", reason: "family count is invalid" };
  }
  if (parsedFamilyCount === 0) {
    if (lane !== "EXPLORE" || gatesResult !== "skipped") {
      return {
        ok: false,
        status: "FAIL",
        reason: "only EXPLORE may omit the gate matrix",
      };
    }
    return { ok: true, status: "PASS", reason: "EXPLORE has no delivery gate matrix" };
  }
  if (gatesResult !== "success") {
    return {
      ok: false,
      status: "FAIL",
      reason: `selected family matrix result is ${gatesResult || "missing"}`,
    };
  }
  return { ok: true, status: "PASS", reason: `${lane} required families succeeded` };
}
