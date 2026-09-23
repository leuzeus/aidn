import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SKILL_IDENTITIES } from "../../core/skills/skill-policy.mjs";

const ledger = JSON.parse(fs.readFileSync(new URL("./codex-legacy-fingerprints.v1.json", import.meta.url), "utf8"));
const hash = (value) => value === null ? null : createHash("sha256").update(value).digest("hex");
const normalizedHash = (text) => hash(text.replace(/\r\n/g, "\n"));
const encode = (text) => text === null ? null : Buffer.from(text, "utf8").toString("base64");
const decode = (data) => data === null ? null : Buffer.from(data, "base64").toString("utf8");
function fail(code, detail = "") { throw Object.assign(new Error(`${code}${detail ? `: ${detail}` : ""}`), { code }); }
function absolute(value) { if (typeof value !== "string" || !path.isAbsolute(value)) fail("EXPLICIT_ABSOLUTE_HOST_PATH_REQUIRED"); return path.resolve(value); }
function safeRead(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) fail("HOST_PATH_ESCAPE", file);
  let current = path.parse(root).root;
  for (const part of path.relative(current, file).split(path.sep)) {
    current = path.join(current, part);
    let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (stat.isSymbolicLink()) fail("HOST_SYMLINK_REQUIRES_INSPECTION", current);
  }
  if (!fs.statSync(file).isFile()) fail("HOST_CONFIG_NOT_FILE", file);
  const bytes = fs.readFileSync(file), text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) fail("HOST_CONFIG_NOT_UTF8", file);
  return text;
}
function pathKey(file) { const resolved = path.resolve(file); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
function classifySkill(skill, text) {
  const fingerprint = normalizedHash(text);
  const historical = ledger.assets[`.agents/skills/${skill.id}/SKILL.md`] ?? [];
  const repair = ledger.repairs?.find((entry) => entry.asset === `.agents/skills/${skill.id}/SKILL.md`);
  if (historical.includes(fingerprint) || repair?.historical_hash === fingerprint || repair?.repaired_hash === fingerprint) return "known-aidn";
  const current = fs.readFileSync(new URL(`../../../scaffold/codex/${skill.publicName}/SKILL.md`, import.meta.url), "utf8");
  if (normalizedHash(current) === fingerprint) return "known-aidn";
  return /(?:\bAIDN\b|\baidn\b|docs\/audit\/)/u.test(text) ? "custom-aidn" : "unknown-homonym";
}

// Keep source spans intact. Multiline strings and comments cannot manufacture
// a skills table. Unsupported representations of the targeted table fail closed.
function tomlLines(text) {
  const lines = []; let offset = 0, multiline = null;
  for (const raw of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!raw) continue;
    let code = "";
    for (let i = 0; i < raw.length;) {
      if (multiline) {
        if (raw.startsWith(multiline, i) && !(multiline === '"""' && /(?<!\\)(?:\\\\)*\\$/u.test(raw.slice(0, i)))) { code += "   "; i += 3; multiline = null; }
        else { code += " "; i += 1; }
        continue;
      }
      if (raw[i] === "#") { code += " ".repeat(raw.length - i); break; }
      if (raw.startsWith('"""', i) || raw.startsWith("'''", i)) { multiline = raw.slice(i, i + 3); code += "   "; i += 3; continue; }
      if (raw[i] === '"' || raw[i] === "'") {
        const quote = raw[i]; code += raw[i++]; let closed = false;
        while (i < raw.length && raw[i] !== "\n" && raw[i] !== "\r") {
          const character = raw[i++]; code += character;
          if (quote === '"' && character === "\\") { if (i < raw.length) code += raw[i++]; }
          else if (character === quote) { closed = true; break; }
        }
        if (!closed) fail("UNSUPPORTED_HOST_TOML_STRING");
      } else code += raw[i++];
    }
    lines.push({ raw, code: code.trim(), start: offset, end: offset + raw.length }); offset += raw.length;
  }
  if (multiline) fail("UNTERMINATED_HOST_TOML_STRING");
  return lines;
}
function tomlString(value) {
  if (/^'[^'\r\n]*'$/u.test(value)) return value.slice(1, -1);
  if (/^"(?:[^"\\\r\n]|\\.)*"$/u.test(value)) {
    try { return JSON.parse(value.replace(/\\U([0-9a-fA-F]{8})/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))); } catch { fail("UNSUPPORTED_HOST_TOML_STRING"); }
  }
  fail("UNSUPPORTED_HOST_TOML_PATH");
}
function keys(value) {
  const parts = []; let tail = value.trim();
  while (tail) {
    const match = /^(?:([A-Za-z0-9_-]+)|("(?:[^"\\]|\\.)*")|('[^']*'))/u.exec(tail);
    if (!match) fail("UNSUPPORTED_HOST_TOML_KEY");
    parts.push(match[1] ?? tomlString(match[2] ?? match[3])); tail = tail.slice(match[0].length).trim();
    if (!tail) break;
    if (!tail.startsWith(".")) fail("UNSUPPORTED_HOST_TOML_KEY");
    tail = tail.slice(1).trim(); if (!tail) fail("UNSUPPORTED_HOST_TOML_KEY");
  }
  return parts;
}
function disabledConfig(before, selectedPaths) {
  if (!selectedPaths.length) return before;
  const text = before ?? "", eol = text.includes("\r\n") ? "\r\n" : "\n";
  const entries = []; let section = [], entry = null;
  for (const line of tomlLines(text)) {
    if (!line.code) continue;
    const header = /^(\[\[?)(.*?)(\]\]?)$/u.exec(line.code);
    if (header) {
      if (entry) { entry.end = line.start; entry = null; }
      section = keys(header[2]);
      if (section[0] === "skills" && section[1] === "config") {
        if (section.length !== 2 || header[1] !== "[[" || header[3] !== "]]") fail("UNSUPPORTED_SKILLS_CONFIG_LAYOUT");
        entry = { start: line.start, end: text.length, fields: {} }; entries.push(entry);
      }
      continue;
    }
    const assignment = /^((?:[^="']|"(?:[^"\\]|\\.)*"|'[^']*')+)\s*=\s*(.*)$/u.exec(line.code);
    if (!assignment) continue;
    const field = keys(assignment[1]);
    if ((!section.length && field[0] === "skills") || (section.join(".") === "skills" && field[0] === "config")) fail("UNSUPPORTED_SKILLS_CONFIG_LAYOUT");
    if (!entry) continue;
    if (field.length !== 1) fail("UNSUPPORTED_SKILLS_CONFIG_LAYOUT");
    if (!["path", "enabled"].includes(field[0])) continue;
    if (entry.fields[field[0]]) fail("DUPLICATE_SKILLS_CONFIG_FIELD", field[0]);
    entry.fields[field[0]] = { value: assignment[2].trim(), line };
  }
  const seen = new Map();
  for (const item of entries) {
    if (!item.fields.path) fail("MISSING_SKILLS_CONFIG_PATH");
    const entryPath = tomlString(item.fields.path.value);
    if (!path.isAbsolute(entryPath)) fail("RELATIVE_SKILLS_CONFIG_PATH_REQUIRES_INSPECTION");
    const key = pathKey(entryPath); if (seen.has(key)) fail("DUPLICATE_SKILLS_CONFIG_PATH", entryPath);
    seen.set(key, item);
    if (item.fields.enabled && !/^(true|false)$/u.test(item.fields.enabled.value)) fail("INVALID_SKILLS_CONFIG_ENABLED");
  }
  const edits = [], missing = [];
  for (const selected of selectedPaths) {
    const item = seen.get(pathKey(selected));
    if (!item) { missing.push(selected); continue; }
    if (item.fields.enabled?.value === "false") continue;
    if (item.fields.enabled) {
      const { line } = item.fields.enabled;
      const trueIndex = line.raw.indexOf("true", line.raw.indexOf("="));
      edits.push({ start: line.start + trueIndex, end: line.start + trueIndex + 4, value: "false" });
    } else {
      const prefix = item.end > 0 && text[item.end - 1] !== "\n" ? eol : "";
      edits.push({ start: item.end, end: item.end, value: `${prefix}enabled = false${eol}` });
    }
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  if (missing.length) {
    if (result && !result.endsWith("\n")) result += eol;
    result += missing.map((file) => `${eol}[[skills.config]]${eol}path = ${JSON.stringify(file)}${eol}enabled = false${eol}`).join("");
  }
  return result;
}
function operation(before, after) {
  return { path: "config.toml", kind: "global-skills-config", before: encode(before), after: encode(after), before_hash: hash(before), after_hash: hash(after) };
}
function result(action, home, candidates, op, conflicts) {
  const plan = { action, codex_home: home, candidates, operations: op && !conflicts.length ? [op] : [], conflicts, written: false, requires_restart: !!op && op.before !== op.after, native_qualification: "NOT_EXECUTED" };
  return { ok: !conflicts.length, plan_id: hash(JSON.stringify(plan)), ...plan };
}
/** Read-only planner. The caller's existing transaction engine owns apply/CAS/recovery. */
export function planGlobalSkillsMigration({ codexHome, skillRoots, selectedPaths } = {}) {
  const home = absolute(codexHome), roots = [...new Set((skillRoots ?? [path.join(home, "skills")]).map(absolute))];
  const candidates = [], conflicts = []; let op = null;
  try {
    const selected = selectedPaths === undefined ? null : new Set(selectedPaths.map((file) => pathKey(absolute(file))));
    for (const root of roots) for (const skill of SKILL_IDENTITIES) for (const name of [skill.id, skill.publicName]) {
      const file = path.join(root, name, "SKILL.md"), text = safeRead(root, file);
      if (text === null) continue;
      const classification = classifySkill(skill, text);
      candidates.push({ id: skill.id, public_name: skill.publicName, path: file, sha256: hash(text), classification, selected: selected ? selected.has(pathKey(file)) : classification === "known-aidn" });
    }
    if (selected) for (const file of selected) if (!candidates.some((item) => pathKey(item.path) === file)) conflicts.push({ code: "GLOBAL_SKILL_OUTSIDE_INVENTORY", path: file });
    for (const candidate of candidates) if (candidate.selected && candidate.classification !== "known-aidn") conflicts.push({ code: "GLOBAL_SKILL_OWNERSHIP_UNKNOWN", path: candidate.path });
    const before = safeRead(home, path.join(home, "config.toml"));
    if (!conflicts.length) op = operation(before, disabledConfig(before, candidates.filter((item) => item.selected).map((item) => item.path)));
  } catch (error) { conflicts.push({ code: error.code ?? "GLOBAL_SKILLS_PLAN_FAILED", message: error.message }); }
  return result("disable-global-skills", home, candidates, op, conflicts);
}
/** Exact post-image comparison; unrelated later edits require re-planning, never overwrite. */
export function planRestoreGlobalSkillsMigration({ codexHome, operation: saved } = {}) {
  const home = absolute(codexHome), conflicts = []; let op = null;
  try {
    if (!saved || saved.path !== "config.toml" || saved.kind !== "global-skills-config") fail("INVALID_GLOBAL_SKILLS_OPERATION");
    const before = decode(saved.before), after = decode(saved.after);
    if (hash(before) !== saved.before_hash || hash(after) !== saved.after_hash) fail("CORRUPT_GLOBAL_SKILLS_PREIMAGE");
    const current = safeRead(home, path.join(home, "config.toml"));
    if (current !== after) fail("GLOBAL_SKILLS_POSTIMAGE_CHANGED");
    op = operation(current, before);
  } catch (error) { conflicts.push({ code: error.code ?? "GLOBAL_SKILLS_RESTORE_FAILED", message: error.message }); }
  return result("restore-global-skills", home, [], op, conflicts);
}