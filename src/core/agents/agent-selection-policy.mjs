function getAdapterHealth(adapterId, adapterHealth) {
  if (!adapterId || !adapterHealth) {
    return null;
  }
  if (adapterHealth instanceof Map) {
    return adapterHealth.get(adapterId) ?? null;
  }
  return adapterHealth[adapterId] ?? null;
}

function isAdapterSelectableHealth(health) {
  if (!health) {
    return true;
  }
  return health.health_status !== "unavailable" && health.health_status !== "disabled";
}

export function scoreAgentAdapter(adapter, { role, action, health = null } = {}) {
  const profile = adapter.getProfile();
  let score = 0;
  if (profile.default_role === role) {
    score += 100;
  }
  if (profile.supported_roles.length === 1 && profile.supported_roles[0] === role) {
    score += 50;
  }
  if (adapter.canHandleRole({ role, action })) {
    score += 25;
  }
  if (health?.health_status === "ready") {
    score += 10;
  } else if (health?.health_status === "degraded") {
    score -= 20;
  }
  score -= profile.supported_roles.length;
  return score;
}

export function rankAgentAdapters({
  role,
  action,
  adapters = [],
  roster = null,
  adapterHealth = null,
} = {}) {
  const filteredAdapters = adapters.filter((adapter) => {
    const profile = adapter.getProfile();
    const override = roster?.agents?.[profile.id] ?? null;
    const health = getAdapterHealth(profile.id, adapterHealth);
    if (override?.enabled === false) {
      return false;
    }
    if (!isAdapterSelectableHealth(health)) {
      return false;
    }
    if (Array.isArray(override?.roles) && override.roles.length > 0 && !override.roles.includes(role)) {
      return false;
    }
    return true;
  });
  return filteredAdapters
    .filter((adapter) => adapter.canHandleRole({ role, action }))
    .map((adapter) => ({
      adapter,
      profile: adapter.getProfile(),
      health: getAdapterHealth(adapter.getProfile().id, adapterHealth),
      score: scoreAgentAdapter(adapter, {
        role,
        action,
        health: getAdapterHealth(adapter.getProfile().id, adapterHealth),
      })
        + Number.parseInt(String(roster?.agents?.[adapter.getProfile().id]?.priority ?? 0), 10),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.profile.id.localeCompare(right.profile.id);
    });
}

export function selectAgentAdapter({
  requestedAgent = "auto",
  role,
  action,
  adapters = [],
  roster = null,
  adapterHealth = null,
} = {}) {
  const rosterDefault = String(roster?.default_requested_agent ?? "").trim().toLowerCase();
  const normalizedRequestedAgent = String(
    requestedAgent === "auto" && rosterDefault ? rosterDefault : (requestedAgent ?? "auto"),
  ).trim().toLowerCase() || "auto";
  const rankedCandidates = rankAgentAdapters({
    role,
    action,
    adapters,
    roster,
    adapterHealth,
  });
  const filteredAdapters = adapters.filter((adapter) => {
    const profile = adapter.getProfile();
    const override = roster?.agents?.[profile.id] ?? null;
    const health = getAdapterHealth(profile.id, adapterHealth);
    if (override?.enabled === false) {
      return false;
    }
    if (!isAdapterSelectableHealth(health)) {
      return false;
    }
    if (Array.isArray(override?.roles) && override.roles.length > 0 && !override.roles.includes(role)) {
      return false;
    }
    return true;
  });
  const candidates = rankedCandidates.map((entry) => entry.adapter);

  if (normalizedRequestedAgent !== "auto") {
    const explicitAdapter = adapters.find((adapter) => adapter.getProfile().id === normalizedRequestedAgent);
    if (!explicitAdapter) {
      const explicitHealth = getAdapterHealth(normalizedRequestedAgent, adapterHealth);
      if (explicitHealth) {
        return {
          status: "unsupported",
          requested_agent: normalizedRequestedAgent,
          selected_adapter: null,
          selected_profile: null,
          candidate_profiles: candidates.map((adapter) => adapter.getProfile()),
          reason: `${normalizedRequestedAgent} is ${explicitHealth.health_status ?? "unavailable"}: ${explicitHealth.health_reason ?? "adapter health check failed"}`,
        };
      }
      throw new Error(`Unsupported or disabled agent adapter: ${requestedAgent}`);
    }
    const explicitProfile = explicitAdapter.getProfile();
    const explicitHealth = getAdapterHealth(explicitProfile.id, adapterHealth);
    const explicitOverride = roster?.agents?.[explicitProfile.id] ?? null;
    if (explicitOverride?.enabled === false) {
      throw new Error(`Unsupported or disabled agent adapter: ${requestedAgent}`);
    }
    if (!isAdapterSelectableHealth(explicitHealth)) {
      return {
        status: "unsupported",
        requested_agent: normalizedRequestedAgent,
        selected_adapter: explicitAdapter,
        selected_profile: explicitProfile,
        candidate_profiles: candidates.map((adapter) => adapter.getProfile()),
        reason: `${explicitProfile.id} is ${explicitHealth?.health_status ?? "unavailable"}: ${explicitHealth?.health_reason ?? "adapter health check failed"}`,
      };
    }
    if (!explicitAdapter.canHandleRole({ role, action })) {
      return {
        status: "unsupported",
        requested_agent: normalizedRequestedAgent,
        selected_adapter: explicitAdapter,
        selected_profile: explicitProfile,
        candidate_profiles: candidates.map((adapter) => adapter.getProfile()),
        reason: `${explicitProfile.id} cannot handle ${role} + ${action}`,
      };
    }
    return {
      status: "selected",
      requested_agent: normalizedRequestedAgent,
      selected_adapter: explicitAdapter,
      selected_profile: explicitProfile,
      candidate_profiles: candidates.map((adapter) => adapter.getProfile()),
      reason: `explicit agent selection kept ${explicitProfile.id}`,
    };
  }

  if (candidates.length === 0) {
    return {
      status: "unsupported",
      requested_agent: "auto",
      selected_adapter: null,
      selected_profile: null,
      candidate_profiles: [],
      reason: `no available adapter can handle ${role} + ${action}`,
    };
  }

  const selected = rankedCandidates[0];
  return {
    status: "selected",
    requested_agent: "auto",
    selected_adapter: selected.adapter,
    selected_profile: selected.profile,
    candidate_profiles: rankedCandidates.map((entry) => entry.profile),
    reason: `auto selected ${selected.profile.id} for ${role} + ${action}`,
  };
}
