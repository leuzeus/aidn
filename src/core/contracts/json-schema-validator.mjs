const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "x-aidn-command",
  "x-aidn-commands",
  "x-aidn-contract-version",
]);

const VALIDATION_KEYWORDS = new Set([
  "type",
  "required",
  "properties",
  "additionalProperties",
  "const",
  "enum",
  "items",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "oneOf",
  "anyOf",
  "allOf",
]);

const JSON_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);
const FORMATS = new Set(["date-time", "uri", "email"]);
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valueType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function normalizeTypes(typeSpec) {
  if (Array.isArray(typeSpec)) {
    return [...typeSpec];
  }
  return typeof typeSpec === "string" ? [typeSpec] : [];
}

function typeMatches(value, allowedTypes) {
  if (allowedTypes.length === 0) {
    return true;
  }
  const actual = valueType(value);
  if (actual === "number" && Number.isInteger(value) && allowedTypes.includes("integer")) {
    return true;
  }
  return allowedTypes.includes(actual);
}

function deepEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
        && deepEqual(left[key], right[key]));
  }
  return false;
}

function schemaLocation(parent, key) {
  return `${parent}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function validateSchemaNode(schema, location, { root }) {
  const issues = [];
  if (!isPlainObject(schema)) {
    return [`${location}: schema must be a plain object`];
  }
  for (const key of Object.keys(schema)) {
    if (!ANNOTATION_KEYWORDS.has(key) && !VALIDATION_KEYWORDS.has(key)) {
      issues.push(`${schemaLocation(location, key)}: unsupported schema keyword`);
    }
  }

  if (root && !Object.prototype.hasOwnProperty.call(schema, "$schema")) {
    issues.push(`${location}/$schema: root schema declaration is required`);
  } else if (Object.prototype.hasOwnProperty.call(schema, "$schema")) {
    if (!root || schema.$schema !== DRAFT_07) {
      issues.push(`${location}/$schema: expected ${DRAFT_07} on the root schema`);
    }
  }
  if (root && !Object.prototype.hasOwnProperty.call(schema, "$id")) {
    issues.push(`${location}/$id: root schema identifier is required`);
  } else if (Object.prototype.hasOwnProperty.call(schema, "$id")) {
    if (!root || typeof schema.$id !== "string"
      || !schema.$id.startsWith("aidn://contracts/cli-output/")) {
      issues.push(`${location}/$id: expected an AIDN CLI-output contract URI on the root schema`);
    }
  }
  if (schema.title != null && typeof schema.title !== "string") {
    issues.push(`${location}/title: expected string`);
  }
  if (schema["x-aidn-command"] != null && typeof schema["x-aidn-command"] !== "string") {
    issues.push(`${location}/x-aidn-command: expected string`);
  }
  if (schema["x-aidn-commands"] != null
    && (!Array.isArray(schema["x-aidn-commands"])
      || schema["x-aidn-commands"].length === 0
      || schema["x-aidn-commands"].some((item) => typeof item !== "string" || !item.trim())
      || hasDuplicates(schema["x-aidn-commands"]))) {
    issues.push(`${location}/x-aidn-commands: expected a non-empty unique string array`);
  }
  if (schema["x-aidn-contract-version"] != null
    && typeof schema["x-aidn-contract-version"] !== "string") {
    issues.push(`${location}/x-aidn-contract-version: expected string`);
  }

  if (Object.prototype.hasOwnProperty.call(schema, "type")) {
    const types = normalizeTypes(schema.type);
    if (types.length === 0
      || types.some((item) => typeof item !== "string" || !JSON_TYPES.has(item))
      || hasDuplicates(types)) {
      issues.push(`${location}/type: expected a JSON type or non-empty unique JSON type array`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, "required")
    && (!Array.isArray(schema.required)
      || schema.required.some((item) => typeof item !== "string")
      || hasDuplicates(schema.required))) {
    issues.push(`${location}/required: expected a unique string array`);
  }
  if (Object.prototype.hasOwnProperty.call(schema, "properties")) {
    if (!isPlainObject(schema.properties)) {
      issues.push(`${location}/properties: expected a plain object of schemas`);
    } else {
      for (const [key, child] of Object.entries(schema.properties)) {
        issues.push(...validateSchemaNode(
          child,
          schemaLocation(`${location}/properties`, key),
          { root: false },
        ));
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, "enum")
    && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    issues.push(`${location}/enum: expected a non-empty array`);
  }
  if (Object.prototype.hasOwnProperty.call(schema, "items")) {
    if (!isPlainObject(schema.items)) {
      issues.push(`${location}/items: expected one schema object`);
    } else {
      issues.push(...validateSchemaNode(schema.items, `${location}/items`, { root: false }));
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, "additionalProperties")) {
    if (typeof schema.additionalProperties !== "boolean"
      && !isPlainObject(schema.additionalProperties)) {
      issues.push(`${location}/additionalProperties: expected boolean or schema`);
    } else if (isPlainObject(schema.additionalProperties)) {
      issues.push(...validateSchemaNode(
        schema.additionalProperties,
        `${location}/additionalProperties`,
        { root: false },
      ));
    }
  }

  for (const keyword of ["minimum", "maximum"]) {
    if (schema[keyword] != null
      && (typeof schema[keyword] !== "number" || !Number.isFinite(schema[keyword]))) {
      issues.push(`${location}/${keyword}: expected finite number`);
    }
  }
  for (const keyword of [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ]) {
    if (schema[keyword] != null
      && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      issues.push(`${location}/${keyword}: expected non-negative integer`);
    }
  }
  if (schema.pattern != null) {
    if (typeof schema.pattern !== "string") {
      issues.push(`${location}/pattern: expected string`);
    } else {
      try {
        new RegExp(schema.pattern);
      } catch {
        issues.push(`${location}/pattern: invalid regular expression`);
      }
    }
  }
  if (schema.format != null
    && (typeof schema.format !== "string" || !FORMATS.has(schema.format))) {
    issues.push(`${location}/format: unsupported format`);
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (schema[keyword] != null) {
      if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) {
        issues.push(`${location}/${keyword}: expected a non-empty schema array`);
      } else {
        schema[keyword].forEach((child, index) => {
          issues.push(...validateSchemaNode(
            child,
            `${location}/${keyword}/${index}`,
            { root: false },
          ));
        });
      }
    }
  }
  return issues;
}

export function validateJsonSchemaDefinition(schema, location = "#") {
  return validateSchemaNode(schema, location, { root: true });
}

export function collectUnsupportedSchemaKeywords(schema, location = "#") {
  return validateJsonSchemaDefinition(schema, location)
    .filter((issue) => issue.endsWith("unsupported schema keyword"));
}

function validateFormat(value, format) {
  if (format === "date-time") {
    return typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T/.test(value)
      && Number.isFinite(Date.parse(value));
  }
  if (format === "uri") {
    try {
      return typeof value === "string" && Boolean(new URL(value));
    } catch {
      return false;
    }
  }
  if (format === "email") {
    return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }
  return true;
}

function validateValue(value, schema, location) {
  const issues = [];
  const allowedTypes = normalizeTypes(schema.type);
  if (!typeMatches(value, allowedTypes)) {
    issues.push(`${location}: expected ${allowedTypes.join("|")}, got ${valueType(value)}`);
    return issues;
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && !deepEqual(value, schema.const)) {
    issues.push(`${location}: value does not match const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    issues.push(`${location}: value is not in enum`);
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) {
      issues.push(`${location}: number is below minimum`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      issues.push(`${location}: number is above maximum`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      issues.push(`${location}: string is shorter than minLength`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      issues.push(`${location}: string is longer than maxLength`);
    }
    if (schema.pattern != null && !new RegExp(schema.pattern).test(value)) {
      issues.push(`${location}: string does not match pattern`);
    }
    if (schema.format != null && !validateFormat(value, schema.format)) {
      issues.push(`${location}: string does not match format ${schema.format}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      issues.push(`${location}: array is shorter than minItems`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      issues.push(`${location}: array is longer than maxItems`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(...validateValue(item, schema.items, `${location}[${index}]`));
      });
    }
  }

  const isObject = isPlainObject(value);
  if (isObject) {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(`${location}.${key}: missing required property`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(...validateValue(value[key], propertySchema, `${location}.${key}`));
      }
    }
    const unknownKeys = Object.keys(value).filter(
      (key) => !Object.prototype.hasOwnProperty.call(properties, key),
    );
    if (schema.additionalProperties === false) {
      for (const key of unknownKeys) {
        issues.push(`${location}.${key}: additional property is forbidden`);
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of unknownKeys) {
        issues.push(...validateValue(value[key], schema.additionalProperties, `${location}.${key}`));
      }
    }
    if (schema.minProperties != null && Object.keys(value).length < schema.minProperties) {
      issues.push(`${location}: object has fewer than minProperties`);
    }
    if (schema.maxProperties != null && Object.keys(value).length > schema.maxProperties) {
      issues.push(`${location}: object has more than maxProperties`);
    }
  }

  for (const [keyword, expected] of [["oneOf", 1], ["anyOf", 1], ["allOf", schema.allOf?.length]]) {
    if (!schema[keyword]) {
      continue;
    }
    const matches = schema[keyword].filter(
      (candidate) => validateValue(value, candidate, location).length === 0,
    ).length;
    if ((keyword === "oneOf" && matches !== expected)
      || (keyword === "anyOf" && matches < expected)
      || (keyword === "allOf" && matches !== expected)) {
      issues.push(`${location}: ${keyword} constraint failed`);
    }
  }
  return issues;
}

export function validateJsonSchema(value, schema, location = "$") {
  const definitionIssues = validateJsonSchemaDefinition(schema);
  if (definitionIssues.length > 0) {
    return definitionIssues;
  }
  return validateValue(value, schema, location);
}

export function listSupportedSchemaKeywords() {
  return Object.freeze({
    annotations: [...ANNOTATION_KEYWORDS].sort(),
    validation: [...VALIDATION_KEYWORDS].sort(),
    types: [...JSON_TYPES].sort(),
    formats: [...FORMATS].sort(),
  });
}
