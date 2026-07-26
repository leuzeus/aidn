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
]);

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
    return typeSpec.map((item) => String(item));
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

export function collectUnsupportedSchemaKeywords(schema, location = "#") {
  const issues = [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${location}: schema must be an object`];
  }
  for (const key of Object.keys(schema)) {
    if (!ANNOTATION_KEYWORDS.has(key) && !VALIDATION_KEYWORDS.has(key)) {
      issues.push(`${schemaLocation(location, key)}: unsupported schema keyword`);
    }
  }
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  for (const [key, child] of Object.entries(properties)) {
    issues.push(...collectUnsupportedSchemaKeywords(child, schemaLocation(`${location}/properties`, key)));
  }
  if (schema.items && typeof schema.items === "object") {
    issues.push(...collectUnsupportedSchemaKeywords(schema.items, `${location}/items`));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    issues.push(...collectUnsupportedSchemaKeywords(
      schema.additionalProperties,
      `${location}/additionalProperties`,
    ));
  }
  return issues;
}

export function validateJsonSchema(value, schema, location = "$") {
  const issues = [];
  const unsupported = collectUnsupportedSchemaKeywords(schema);
  if (unsupported.length > 0) {
    return unsupported;
  }

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

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    for (const [index, item] of value.entries()) {
      issues.push(...validateJsonSchema(item, schema.items, `${location}[${index}]`));
    }
  }

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(`${location}.${key}: missing required property`);
      }
    }
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(...validateJsonSchema(value[key], propertySchema, `${location}.${key}`));
      }
    }
    const unknownKeys = Object.keys(value).filter(
      (key) => !Object.prototype.hasOwnProperty.call(properties, key),
    );
    if (schema.additionalProperties === false) {
      for (const key of unknownKeys) {
        issues.push(`${location}.${key}: additional property is forbidden`);
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of unknownKeys) {
        issues.push(...validateJsonSchema(
          value[key],
          schema.additionalProperties,
          `${location}.${key}`,
        ));
      }
    }
  }
  return issues;
}

export function listSupportedSchemaKeywords() {
  return Object.freeze({
    annotations: [...ANNOTATION_KEYWORDS].sort(),
    validation: [...VALIDATION_KEYWORDS].sort(),
  });
}
