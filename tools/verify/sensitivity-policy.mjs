const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const joinedToken = (...parts) => parts.join("");
const exactToken = (...parts) => new RegExp(`\\b${escapeRegExp(joinedToken(...parts))}\\b`, "i");
const exactPath = (...parts) => new RegExp(escapeRegExp(joinedToken(...parts)), "i");

export const SENSITIVITY_RULES = Object.freeze([
  Object.freeze({
    id: "named-external-client",
    pattern: exactToken("go", "wire"),
    probe: joinedToken("go", "wire"),
  }),
  Object.freeze({
    id: "local-project-root",
    pattern: /[a-z]:[\\/](?:projets|projects)[\\/]/i,
    probe: joinedToken("X:", "\\", "projects", "\\", "client"),
  }),
  Object.freeze({
    id: "pilot-runtime-technology",
    pattern: exactToken("Tiny", "Go"),
    probe: joinedToken("Tiny", "Go"),
  }),
  Object.freeze({
    id: "pilot-rendering-acronym",
    pattern: exactToken("S", "S", "R"),
    probe: joinedToken("S", "S", "R"),
  }),
  Object.freeze({
    id: "pilot-ci-provider",
    pattern: exactToken("Dro", "ne"),
    probe: joinedToken("Dro", "ne"),
  }),
  Object.freeze({
    id: "pilot-language-contract",
    pattern: exactToken("TC", "39", "-", "Go"),
    probe: joinedToken("TC", "39", "-", "Go"),
  }),
  Object.freeze({
    id: "pilot-dependency-automation",
    pattern: exactToken("Dependa", "bot"),
    probe: joinedToken("Dependa", "bot"),
    allowed_paths: Object.freeze([
      joinedToken(".github", "/", "dependa", "bot.yml"),
    ]),
  }),
  Object.freeze({
    id: "pilot-generator-source-path",
    pattern: exactPath("internal", "/", "builder", "/", "engines", "/", "components.go"),
    probe: joinedToken("internal", "/", "builder", "/", "engines", "/", "components.go"),
  }),
  Object.freeze({
    id: "pilot-generator-contract-path",
    pattern: exactPath("internal", "/", "components", "/", "manifest.json"),
    probe: joinedToken("internal", "/", "components", "/", "manifest.json"),
  }),
  Object.freeze({
    id: "pilot-generator-output-path",
    pattern: exactPath("web", "/", "ce", "/", "elements.js"),
    probe: joinedToken("web", "/", "ce", "/", "elements.js"),
  }),
]);

export function findSensitivityMatches(value) {
  const text = String(value ?? "");
  return SENSITIVITY_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.id);
}

export function sensitivityRuleAllowedAtPath(ruleId, relativePath) {
  const normalizedPath = String(relativePath ?? "").replaceAll("\\", "/").toLowerCase();
  const rule = SENSITIVITY_RULES.find((candidate) => candidate.id === ruleId);
  return Array.isArray(rule?.allowed_paths)
    && rule.allowed_paths.some((allowedPath) => allowedPath.toLowerCase() === normalizedPath);
}

export function verifySensitivityNegativeProbes() {
  const checks = Object.fromEntries(
    SENSITIVITY_RULES.map((rule) => [
      rule.id,
      findSensitivityMatches(rule.probe).includes(rule.id),
    ]),
  );
  checks.neutral_control =
    findSensitivityMatches("synthetic fixture with neutral paths and generic constraints").length === 0;
  return checks;
}
