const ensure = condition => {
  if (!condition) throw Object.assign(new Error("AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
};

// Pure declarations, never evidence that a native composition is qualified.
export function describeAgentRunAssurance(plan) {
  if (plan.contract_version === "agent-execution-plan.v1") return {};
  const networkUnassured = plan.contract_version === "agent-execution-plan.v3";
  ensure(networkUnassured ? plan.assurance_profile === "codex-cooperative.v2"
    : plan.contract_version === "agent-execution-plan.v2" && plan.assurance_profile === "codex-cooperative.v1");
  return { assurance_profile: plan.assurance_profile, read_isolation: "not_guaranteed",
    ...(networkUnassured ? { network_isolation: "not_guaranteed" } : {}),
    required_guarantees: ["bounded_writes", ...(networkUnassured ? [] : ["sandboxed_command_network_disabled"]),
      "confirmed_descendant_termination", "exact_sha_validation", "named_resources_preserved"],
    limitations: ["profile_and_supervisor_may_be_read", "on_disk_secrets_not_isolated", "not_a_hostile_worker_boundary",
      ...(networkUnassured ? ["network_isolation_not_guaranteed"] : [])],
    qualification_status: "not_checked" };
}

export function assertAgentRunAssuranceBinding(plan, configuration, qualification) {
  describeAgentRunAssurance(plan);
  if (plan.contract_version === "agent-execution-plan.v1") {
    ensure(["v1", "v2"].some(version => configuration?.contract_version === `codex-sandbox-validation-configuration.${version}`
      && qualification?.contract_version === `agent-verification-boundary.${version}`));
    return true;
  }
  const networkUnassured = plan.contract_version === "agent-execution-plan.v3", version = networkUnassured ? "v4" : "v3";
  ensure(configuration?.contract_version === `codex-sandbox-validation-configuration.${version}`
    && qualification?.contract_version === `agent-verification-boundary.${version}`);
  ensure([configuration, qualification].every(value => value.assurance_profile === plan.assurance_profile
    && value.read_isolation === "not_guaranteed"));
  if (networkUnassured) ensure([configuration, qualification].every(value => value.network_isolation === "not_guaranteed")
    && qualification.network_disabled === false);
  return true;
}
