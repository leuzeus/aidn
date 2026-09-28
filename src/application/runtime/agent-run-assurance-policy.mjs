const ensure = condition => {
  if (!condition) throw Object.assign(new Error("AGENT_RUN_ASSURANCE_PROFILE_MISMATCH"), { code: "AGENT_RUN_ASSURANCE_PROFILE_MISMATCH" });
};

// Pure declarations, never evidence that a native composition is qualified.
export function describeAgentRunAssurance(plan) {
  if (plan.contract_version === "agent-execution-plan.v1") return {};
  ensure(plan.contract_version === "agent-execution-plan.v2" && plan.assurance_profile === "codex-cooperative.v1");
  return { assurance_profile: plan.assurance_profile, read_isolation: "not_guaranteed",
    required_guarantees: ["bounded_writes", "sandboxed_command_network_disabled", "confirmed_descendant_termination", "exact_sha_validation", "named_resources_preserved"],
    limitations: ["profile_and_supervisor_may_be_read", "on_disk_secrets_not_isolated", "not_a_hostile_worker_boundary"],
    qualification_status: "not_checked" };
}

export function assertAgentRunAssuranceBinding(plan, configuration, qualification) {
  describeAgentRunAssurance(plan);
  const cooperative = plan.contract_version === "agent-execution-plan.v2";
  ensure(cooperative === (configuration.contract_version === "codex-sandbox-validation-configuration.v3")
    && cooperative === (qualification.contract_version === "agent-verification-boundary.v3"));
  if (cooperative) ensure([configuration, qualification].every(value => value.assurance_profile === plan.assurance_profile
    && value.read_isolation === "not_guaranteed"));
  return true;
}
