import { createHash } from "node:crypto";
import { JsonValue } from "./types.js";

type JsonObject = { [key: string]: JsonValue };
type UnknownObject = Record<string, unknown>;

const SCALAR_SCHEMA_KEYS = [
  "type",
  "format",
  "title",
  "description",
  "contentEncoding",
  "contentMediaType",
  "unit",
  "x-unit",
  "nullable",
  "readOnly",
  "writeOnly",
  "deprecated",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "minContains",
  "maxContains",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "const",
  "default",
] as const;

const SINGLE_SCHEMA_KEYS = [
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "unevaluatedItems",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
] as const;

const ARRAY_SCHEMA_KEYS = ["oneOf", "anyOf", "allOf", "prefixItems"] as const;
const MAP_SCHEMA_KEYS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
] as const;

export function projectResponseSchema(
  schema: unknown,
  document: UnknownObject
): JsonValue | undefined {
  if (typeof schema === "boolean") return schema;
  if (!isObject(schema)) return undefined;
  return projectSchema(schema, document, new Set(), 0);
}

export function schemaHash(schema: JsonValue | undefined): string | undefined {
  if (schema === undefined) return undefined;
  return createHash("sha256").update(stableStringify(schema)).digest("hex");
}

export function generateSyntheticExample(schema: JsonValue | undefined): JsonValue | undefined {
  if (schema === undefined) return undefined;
  const candidate = synthesize(schema, "response", 0);
  return matchesSchema(candidate, schema) ? candidate : undefined;
}

export function unverifiedResponseSchema(): JsonValue {
  return {
    oneOf: [
      {
        type: "object",
        required: ["code", "data"],
        properties: {
          code: { type: "integer", const: 0 },
          message: { type: ["string", "null"] },
          data: {},
        },
      },
      {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "integer", not: { const: 0 } },
          message: { type: ["string", "null"] },
        },
      },
    ],
  };
}

export function assertVerifiedResponseContract(schema: JsonValue | undefined): void {
  if (!isObject(schema) || !Array.isArray(schema.oneOf) || schema.oneOf.length < 2) {
    throw new Error("Verified response contract must use success and business-error variants");
  }

  const variants = schema.oneOf.filter((variant): variant is JsonObject => isObject(variant));
  const successVariants = variants.filter(isVerifiedSuccessEnvelope);
  const errorVariants = variants.filter(isVerifiedBusinessErrorEnvelope);
  if (successVariants.length !== 1 || errorVariants.length < 1) {
    throw new Error("Verified response contract has an invalid public envelope");
  }
  if (!generateSyntheticExample(schema)) {
    throw new Error("Verified response contract cannot generate a valid synthetic example");
  }
}

function isVerifiedSuccessEnvelope(schema: UnknownObject): boolean {
  const properties = isObject(schema.properties) ? schema.properties : undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!properties || !required.includes("code") || !required.includes("data")) return false;
  return isSuccessCodeSchema(properties.code) && isStrongDataSchema(properties.data);
}

function isVerifiedBusinessErrorEnvelope(schema: UnknownObject): boolean {
  const properties = isObject(schema.properties) ? schema.properties : undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Boolean(properties && required.includes("code") && excludesSuccessCode(properties.code));
}

function isSuccessCodeSchema(schema: unknown): boolean {
  if (!isObject(schema)) return false;
  if (schema.const === 0) return true;
  return Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] === 0;
}

function excludesSuccessCode(schema: unknown): boolean {
  if (!isObject(schema)) return false;
  if (typeof schema.const === "number") return schema.const !== 0;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.every((value) => typeof value === "number" && value !== 0);
  }
  if (isObject(schema.not) && schema.not.const === 0) return true;
  if (typeof schema.minimum === "number" && schema.minimum > 0) return true;
  if (typeof schema.maximum === "number" && schema.maximum < 0) return true;
  return false;
}

function isStrongDataSchema(schema: unknown): boolean {
  if (!isObject(schema) || Object.keys(schema).length === 0) return false;
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const variants = schema[keyword];
    if (Array.isArray(variants)) {
      return variants.length > 0 && variants.every(isStrongDataSchema);
    }
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.some(isStrongDataSchema);
  }
  if (schema.const !== undefined || (Array.isArray(schema.enum) && schema.enum.length > 0)) {
    return true;
  }
  if (schema.type === "object" || isObject(schema.properties)) {
    if (isObject(schema.properties) && Object.keys(schema.properties).length > 0) return true;
    return isStrongDataSchema(schema.additionalProperties);
  }
  if (schema.type === "array" || schema.items !== undefined) {
    return isStrongDataSchema(schema.items);
  }
  return ["string", "number", "integer", "boolean", "null"].includes(String(schema.type));
}

function projectSchema(
  schema: UnknownObject,
  document: UnknownObject,
  resolvingRefs: Set<string>,
  depth: number
): JsonValue {
  if (depth > 24) return { type: "object" };

  const ref = typeof schema.$ref === "string" ? schema.$ref : undefined;
  if (ref) {
    if (!ref.startsWith("#/")) throw new Error("External response schema refs are not allowed");
    if (resolvingRefs.has(ref)) {
      throw new Error("Recursive response schema refs are not supported");
    }
    const target = resolvePointer(document, ref);
    if (!isObject(target)) throw new Error("Unresolvable response schema ref");
    const nextRefs = new Set(resolvingRefs).add(ref);
    const projected = projectSchema(target, document, nextRefs, depth + 1);
    const siblings = { ...schema };
    delete siblings.$ref;
    if (!Object.keys(siblings).length) return projected;
    return {
      allOf: [projected, projectSchema(siblings, document, resolvingRefs, depth + 1)],
    };
  }

  const output: JsonObject = {};
  for (const key of SCALAR_SCHEMA_KEYS) {
    const value = schema[key];
    if (isJsonValue(value)) output[key] = value;
  }
  if (Array.isArray(schema.enum) && schema.enum.every(isJsonValue)) {
    output.enum = schema.enum;
  }

  for (const keyword of MAP_SCHEMA_KEYS) {
    const source = schema[keyword];
    if (!isObject(source)) continue;
    const projectedMap: JsonObject = {};
    for (const [name, child] of Object.entries(source)) {
      if (typeof child === "boolean") projectedMap[name] = child;
      else if (isObject(child)) {
        projectedMap[name] = projectSchema(child, document, resolvingRefs, depth + 1);
      }
    }
    output[keyword] = projectedMap;
  }
  if (Array.isArray(schema.required)) {
    output.required = schema.required.filter((value): value is string => typeof value === "string");
  }
  if (isObject(schema.dependentRequired)) {
    const dependentRequired: JsonObject = {};
    for (const [name, dependencies] of Object.entries(schema.dependentRequired)) {
      if (Array.isArray(dependencies)) {
        dependentRequired[name] = dependencies.filter(
          (value): value is string => typeof value === "string"
        );
      }
    }
    output.dependentRequired = dependentRequired;
  }
  if (isObject(schema.dependencies)) {
    const dependencies: JsonObject = {};
    for (const [name, dependency] of Object.entries(schema.dependencies)) {
      if (Array.isArray(dependency)) {
        dependencies[name] = dependency.filter(
          (value): value is string => typeof value === "string"
        );
      } else if (typeof dependency === "boolean") {
        dependencies[name] = dependency;
      } else if (isObject(dependency)) {
        dependencies[name] = projectSchema(dependency, document, resolvingRefs, depth + 1);
      }
    }
    output.dependencies = dependencies;
  }
  for (const keyword of SINGLE_SCHEMA_KEYS) {
    const child = schema[keyword];
    if (typeof child === "boolean") output[keyword] = child;
    else if (isObject(child)) {
      output[keyword] = projectSchema(child, document, resolvingRefs, depth + 1);
    } else if (keyword === "items" && Array.isArray(child)) {
      output[keyword] = child
        .map((item) =>
          typeof item === "boolean"
            ? item
            : isObject(item)
              ? projectSchema(item, document, resolvingRefs, depth + 1)
              : undefined
        )
        .filter((item): item is JsonValue => item !== undefined);
    }
  }
  for (const keyword of ARRAY_SCHEMA_KEYS) {
    const variants = schema[keyword];
    if (!Array.isArray(variants)) continue;
    output[keyword] = variants
      .map((variant) => {
        if (typeof variant === "boolean") return variant;
        return isObject(variant)
          ? projectSchema(variant, document, resolvingRefs, depth + 1)
          : undefined;
      })
      .filter((variant): variant is JsonValue => variant !== undefined);
  }
  if (isObject(schema.not)) {
    output.not = projectSchema(schema.not, document, resolvingRefs, depth + 1);
  }
  if (isObject(schema.discriminator) && typeof schema.discriminator.propertyName === "string") {
    // Mapping values are refs and may expose component or supplier naming. The
    // discriminator property itself is sufficient for a self-contained schema.
    output.discriminator = { propertyName: schema.discriminator.propertyName };
  }
  return output;
}

function synthesize(schema: JsonValue, propertyName: string, depth: number): JsonValue {
  if (depth > 8 || schema === false) return null;
  if (schema === true || !isObject(schema)) return schema === null ? null : "example";
  if (propertyName === "data" && Object.keys(schema).length === 0) return {};

  const variant = selectVariant(schema);
  if (variant) return synthesize(variant, propertyName, depth + 1);

  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((part) => synthesize(part, propertyName, depth + 1));
    const objects = parts.filter(isObject);
    if (objects.length) return Object.assign({}, ...objects) as JsonObject;
    return parts[0] ?? null;
  }
  if (schema.const !== undefined && isJsonValue(schema.const)) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length && isJsonValue(schema.enum[0])) {
    return schema.enum[0];
  }
  if (schema.default !== undefined && isJsonValue(schema.default)) return schema.default;

  const type = Array.isArray(schema.type)
    ? schema.type.find((value) => value !== "null")
    : schema.type;
  if (type === "array" || schema.items !== undefined) {
    return syntheticArray(schema, propertyName, depth);
  }
  if (
    type === "object" ||
    isObject(schema.properties) ||
    schema.additionalProperties !== undefined ||
    Array.isArray(schema.required)
  ) {
    const output: JsonObject = {};
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [name, child] of Object.entries(properties).slice(0, 20)) {
      if (isJsonValue(child)) output[name] = synthesize(child, name, depth + 1);
    }
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof name !== "string" || output[name] !== undefined) continue;
      const child = properties[name];
      const fallback = isJsonValue(schema.additionalProperties)
        ? schema.additionalProperties
        : ({} as JsonValue);
      output[name] = synthesize(isJsonValue(child) ? child : fallback, name, depth + 1);
    }
    if (isJsonValue(schema.if)) {
      const branch = matchesSchema(output, schema.if) ? schema.then : schema.else;
      if (isJsonValue(branch)) {
        const branchValue = synthesize(branch, propertyName, depth + 1);
        if (isObject(branchValue)) Object.assign(output, branchValue);
      }
    }
    return output;
  }
  if (type === "integer" || type === "number") {
    return syntheticNumber(schema, propertyName, type === "integer");
  }
  if (type === "boolean") return true;
  if (type === "null") return null;
  return constrainedSyntheticString(
    propertyName,
    typeof schema.format === "string" ? schema.format : undefined,
    schema
  );
}

function syntheticArray(schema: UnknownObject, propertyName: string, depth: number): JsonValue[] {
  const output = Array.isArray(schema.prefixItems)
    ? schema.prefixItems.map((item) => synthesize(item, propertyName, depth + 1))
    : [];
  const minimum = integerConstraint(schema.minItems, 0);
  const maximum = integerConstraint(schema.maxItems, Number.POSITIVE_INFINITY);
  const containsSchema = isJsonValue(schema.contains) ? schema.contains : undefined;
  const minimumContains = containsSchema ? integerConstraint(schema.minContains, 1) : 0;
  const itemSchema = isJsonValue(schema.items) ? schema.items : ({} as JsonValue);

  while (
    containsSchema &&
    output.filter((item) => matchesSchema(item, containsSchema)).length < minimumContains &&
    output.length < Math.min(maximum, 20)
  ) {
    output.push(synthesize(containsSchema, `${propertyName}Item${output.length + 1}`, depth + 1));
  }
  const targetLength = Math.min(Math.max(output.length, minimum), maximum, 20);
  while (output.length < targetLength) {
    output.push(synthesize(itemSchema, `${propertyName}Item${output.length + 1}`, depth + 1));
  }
  if (!output.length && schema.items !== false && minimum === 0) {
    output.push(synthesize(itemSchema, `${propertyName}Item1`, depth + 1));
  }
  if (schema.uniqueItems === true) {
    for (let index = 1; index < output.length; index += 1) {
      if (output.slice(0, index).some((item) => deepEqual(item, output[index]))) {
        output[index] = makeSyntheticValueUnique(output[index], index + 1);
      }
    }
  }
  return output;
}

function syntheticNumber(schema: UnknownObject, propertyName: string, integer: boolean): number {
  const multiple =
    typeof schema.multipleOf === "number" && schema.multipleOf > 0 ? schema.multipleOf : undefined;
  let lower = typeof schema.minimum === "number" ? schema.minimum : Number.NEGATIVE_INFINITY;
  let upper = typeof schema.maximum === "number" ? schema.maximum : Number.POSITIVE_INFINITY;
  if (typeof schema.exclusiveMinimum === "number") lower = schema.exclusiveMinimum;
  if (typeof schema.exclusiveMaximum === "number") upper = schema.exclusiveMaximum;
  const lowerExclusive =
    typeof schema.exclusiveMinimum === "number" || schema.exclusiveMinimum === true;
  const upperExclusive =
    typeof schema.exclusiveMaximum === "number" || schema.exclusiveMaximum === true;
  const step = multiple ?? (integer ? 1 : 0.5);
  let candidate = /^code$/i.test(propertyName) ? 0 : 1;
  if (Number.isFinite(lower) && (candidate < lower || (lowerExclusive && candidate <= lower))) {
    candidate = lower + (lowerExclusive ? step : 0);
  }
  if (multiple) candidate = Math.ceil(candidate / multiple) * multiple;
  if (integer) candidate = Math.ceil(candidate);
  if (candidate > upper || (upperExclusive && candidate >= upper)) {
    candidate = upper - (upperExclusive ? step : 0);
    if (multiple) candidate = Math.floor(candidate / multiple) * multiple;
    if (integer) candidate = Math.floor(candidate);
  }
  return Number.isFinite(candidate) ? candidate : 0;
}

function constrainedSyntheticString(
  propertyName: string,
  format: string | undefined,
  schema: UnknownObject
): string {
  let value =
    schema.contentEncoding === "base64" ? "ZXhhbXBsZQ==" : syntheticString(propertyName, format);
  const minimum = integerConstraint(schema.minLength, 0);
  const maximum = integerConstraint(schema.maxLength, Number.POSITIVE_INFINITY);
  if (value.length < minimum) value += "x".repeat(Math.min(minimum - value.length, 256));
  if (value.length > maximum) value = value.slice(0, Math.max(0, maximum));
  return value;
}

function matchesSchema(value: JsonValue, schema: JsonValue): boolean {
  if (schema === true) return true;
  if (schema === false || !isObject(schema)) return false;

  if (Array.isArray(schema.allOf) && !schema.allOf.every((item) => matchesSchema(value, item))) {
    return false;
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((item) => matchesSchema(value, item))) {
    return false;
  }
  if (
    Array.isArray(schema.oneOf) &&
    schema.oneOf.filter((item) => matchesSchema(value, item)).length !== 1
  ) {
    return false;
  }
  if (isJsonValue(schema.not) && matchesSchema(value, schema.not)) return false;
  if (schema.const !== undefined && isJsonValue(schema.const) && !deepEqual(value, schema.const)) {
    return false;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => isJsonValue(candidate) && deepEqual(value, candidate))
  ) {
    return false;
  }

  const allowedTypes = Array.isArray(schema.type)
    ? schema.type.filter((item): item is string => typeof item === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (value === null && schema.nullable === true) return true;
  if (allowedTypes.length && !allowedTypes.some((type) => valueMatchesType(value, type))) {
    return false;
  }

  if (typeof value === "number" && !matchesNumericConstraints(value, schema)) return false;
  if (typeof value === "string" && !matchesStringConstraints(value, schema)) return false;
  if (Array.isArray(value) && !matchesArrayConstraints(value, schema)) return false;
  if (isObject(value) && !matchesObjectConstraints(value, schema)) return false;

  if (isJsonValue(schema.if)) {
    const branch = matchesSchema(value, schema.if) ? schema.then : schema.else;
    if (isJsonValue(branch) && !matchesSchema(value, branch)) return false;
  }
  return true;
}

function valueMatchesType(value: JsonValue, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      return false;
  }
}

function matchesNumericConstraints(value: number, schema: UnknownObject): boolean {
  if (typeof schema.minimum === "number" && value < schema.minimum) return false;
  if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
    return false;
  }
  if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
    return false;
  }
  if (
    schema.exclusiveMinimum === true &&
    typeof schema.minimum === "number" &&
    value <= schema.minimum
  ) {
    return false;
  }
  if (
    schema.exclusiveMaximum === true &&
    typeof schema.maximum === "number" &&
    value >= schema.maximum
  ) {
    return false;
  }
  if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
    const quotient = value / schema.multipleOf;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return false;
  }
  return true;
}

function matchesStringConstraints(value: string, schema: UnknownObject): boolean {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern, "u").test(value)) return false;
    } catch {
      return false;
    }
  }
  if (schema.contentEncoding === "base64" && !isCanonicalBase64(value)) return false;
  return true;
}

function matchesArrayConstraints(value: JsonValue[], schema: UnknownObject): boolean {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
  if (schema.uniqueItems === true) {
    const uniqueValues = new Set(value.map(stableStringify));
    if (uniqueValues.size !== value.length) return false;
  }
  const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
  for (let index = 0; index < Math.min(prefixItems.length, value.length); index += 1) {
    const prefixSchema = prefixItems[index];
    if (isJsonValue(prefixSchema) && !matchesSchema(value[index], prefixSchema)) return false;
  }
  if (Array.isArray(schema.items)) {
    for (let index = 0; index < Math.min(schema.items.length, value.length); index += 1) {
      const itemSchema = schema.items[index];
      if (isJsonValue(itemSchema) && !matchesSchema(value[index], itemSchema)) return false;
    }
    if (value.length > schema.items.length) {
      if (schema.additionalItems === false) return false;
      if (isJsonValue(schema.additionalItems)) {
        for (const item of value.slice(schema.items.length)) {
          if (!matchesSchema(item, schema.additionalItems)) return false;
        }
      }
    }
  } else if (isJsonValue(schema.items)) {
    for (const item of value.slice(prefixItems.length)) {
      if (!matchesSchema(item, schema.items)) return false;
    }
  }
  if (isJsonValue(schema.contains)) {
    const count = value.filter((item) => matchesSchema(item, schema.contains as JsonValue)).length;
    const minimum = integerConstraint(schema.minContains, 1);
    const maximum = integerConstraint(schema.maxContains, Number.POSITIVE_INFINITY);
    if (count < minimum || count > maximum) return false;
  }
  return true;
}

function matchesObjectConstraints(value: UnknownObject, schema: UnknownObject): boolean {
  const keys = Object.keys(value);
  if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) return false;
  if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) return false;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  if (required.some((name) => !(name in value))) return false;

  const properties = isObject(schema.properties) ? schema.properties : {};
  const patternProperties = isObject(schema.patternProperties) ? schema.patternProperties : {};
  const patterns: Array<[RegExp, JsonValue]> = [];
  try {
    for (const [pattern, child] of Object.entries(patternProperties)) {
      if (isJsonValue(child)) patterns.push([new RegExp(pattern, "u"), child]);
    }
  } catch {
    return false;
  }

  for (const [name, childValue] of Object.entries(value)) {
    const propertySchema = properties[name];
    if (isJsonValue(propertySchema) && !matchesSchema(childValue as JsonValue, propertySchema)) {
      return false;
    }
    const matchingPatterns = patterns.filter(([pattern]) => pattern.test(name));
    if (
      matchingPatterns.some(
        ([, childSchema]) => !matchesSchema(childValue as JsonValue, childSchema)
      )
    ) {
      return false;
    }
    if (propertySchema === undefined && matchingPatterns.length === 0) {
      const additional = schema.additionalProperties ?? schema.unevaluatedProperties;
      if (additional === false) return false;
      if (isJsonValue(additional) && !matchesSchema(childValue as JsonValue, additional)) {
        return false;
      }
    }
  }
  if (isJsonValue(schema.propertyNames)) {
    for (const name of keys) {
      if (!matchesSchema(name, schema.propertyNames)) return false;
    }
  }
  if (isObject(schema.dependentRequired)) {
    for (const [name, dependencies] of Object.entries(schema.dependentRequired)) {
      if (!(name in value) || !Array.isArray(dependencies)) continue;
      if (
        dependencies.some((dependency) => typeof dependency === "string" && !(dependency in value))
      ) {
        return false;
      }
    }
  }
  if (isObject(schema.dependentSchemas)) {
    for (const [name, dependency] of Object.entries(schema.dependentSchemas)) {
      if (
        name in value &&
        isJsonValue(dependency) &&
        !matchesSchema(value as JsonValue, dependency)
      ) {
        return false;
      }
    }
  }
  if (isObject(schema.dependencies)) {
    for (const [name, dependency] of Object.entries(schema.dependencies)) {
      if (!(name in value)) continue;
      if (Array.isArray(dependency)) {
        if (dependency.some((item) => typeof item === "string" && !(item in value))) return false;
      } else if (isJsonValue(dependency) && !matchesSchema(value as JsonValue, dependency)) {
        return false;
      }
    }
  }
  return true;
}

function integerConstraint(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return true;
}

function makeSyntheticValueUnique(value: JsonValue, index: number): JsonValue {
  if (typeof value === "string") return `${value}-${index}`;
  if (typeof value === "number") return value + index;
  if (isObject(value)) return { ...value, syntheticIndex: index };
  return value;
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  return stableStringify(left) === stableStringify(right);
}

function selectVariant(schema: UnknownObject): JsonValue | undefined {
  const variants = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null;
  if (!variants?.length) return undefined;
  const success = variants.find(
    (variant) => isObject(variant) && isVerifiedSuccessEnvelope(variant)
  );
  const selected = success ?? variants[0];
  return isJsonValue(selected) ? selected : undefined;
}

function syntheticString(name: string, format?: string): string {
  if (format === "date") return "2026-01-01";
  if (format === "date-time") return "2026-01-01T00:00:00Z";
  if (format === "time") return "00:00:00Z";
  if (format === "email") return "user@example.com";
  if (format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (format === "ipv4") return "192.0.2.1";
  if (format === "ipv6") return "2001:db8::1";
  if (format === "hostname") return "example.com";
  if (format === "uri" || format === "url" || /(?:url|uri|link)$/i.test(name)) {
    return "https://example.com/resource";
  }
  if (/message/i.test(name)) return "Success";
  if (/(?:^|_)(?:id|uuid)$/i.test(name) || /Id$/.test(name)) return "example-id";
  if (/name|title|nickname/i.test(name)) return "Example";
  if (/phone|mobile/i.test(name)) return "+1-202-555-0100";
  return "example";
}

function resolvePointer(document: UnknownObject, ref: string): unknown {
  let current: unknown = document;
  for (const rawPart of ref.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isObject(value: unknown): value is UnknownObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}
