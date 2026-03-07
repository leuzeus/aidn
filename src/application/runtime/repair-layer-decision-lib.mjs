export function upsertRepairDecision(existing, nextDecision) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const index = list.findIndex((row) =>
    String(row?.relation_scope ?? "") === String(nextDecision.relation_scope)
    && String(row?.source_ref ?? "") === String(nextDecision.source_ref)
    && String(row?.target_ref ?? "") === String(nextDecision.target_ref)
    && String(row?.relation_type ?? "") === String(nextDecision.relation_type));
  if (index >= 0) {
    list[index] = nextDecision;
  } else {
    list.push(nextDecision);
  }
  return list.sort((a, b) => `${a.relation_scope}:${a.source_ref}:${a.target_ref}:${a.relation_type}`.localeCompare(`${b.relation_scope}:${b.source_ref}:${b.target_ref}:${b.relation_type}`));
}
