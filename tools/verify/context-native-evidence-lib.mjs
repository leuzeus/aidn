// Assess observed order, never mere model statements about tool execution.
export function assessNativeContextRound(events, threadId) {
  const rows = events.filter(event => event.params?.threadId === threadId);
  const completed = name => rows.findIndex(event => event.method === "item/completed"
    && event.params.item?.type === "dynamicToolCall" && event.params.item.tool === name && event.params.item.success === true);
  const requests = rows.map((event, index) => ({ event, index })).filter(({ event }) => event.method === "rawResponseItem/completed"
    && event.params.item?.type === "function_call" && event.params.item.name === "new_context");
  const request = requests[0]?.index ?? -1;
  const requestCallId = requests[0]?.event.params.item.call_id;
  const acknowledgement = rows.findIndex(event => event.method === "rawResponseItem/completed"
    && event.params.item?.type === "function_call_output" && event.params.item.call_id === requestCallId
    && typeof event.params.item.output === "string" && event.params.item.output.includes("new context window will start"));
  const capture = completed("aidn_checkpoint"), resume = completed("aidn_resume"), fetch = completed("aidn_fetch"), submit = completed("aidn_submit");
  const order = requests.length === 1 && capture >= 0 && request > capture && acknowledgement > request
    && resume > acknowledgement && fetch > acknowledgement && submit > resume && submit > fetch;
  return { status: order ? "PASS" : "FAIL", native_requests: requests.length,
    checkpoint_before_dispatch: capture >= 0 && request > capture, acknowledged: acknowledgement > request,
    fresh_restore_after_dispatch: resume > acknowledgement && acknowledgement >= 0,
    exact_retrieval_after_dispatch: fetch > acknowledgement && acknowledgement >= 0,
    continuation_submitted: submit > resume && submit > fetch && submit >= 0 };
}

export function assessNativeHookLifecycle(observations, sessionId) {
  const rows = observations.filter(row => row.session_id === sessionId);
  const startup = rows.findIndex(row => row.event === "SessionStart" && row.source === "startup" && row.status === "current");
  const before = rows.findIndex(row => row.event === "PreCompact" && row.status === "captured");
  const after = rows.findIndex(row => row.event === "PostCompact" && row.status === "current");
  const restored = rows.findIndex(row => row.event === "SessionStart" && row.source === "compact" && row.status === "current");
  return { status: startup >= 0 && before > startup && after > before && restored > after ? "PASS" : "FAIL",
    startup: startup >= 0, checkpoint_before_compact: before >= 0, fresh_after_compact: after > before && before >= 0,
    restored_on_continuation: restored > after && after >= 0 };
}
