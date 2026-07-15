import { describe, expect, it } from "vitest";
import { generateSyntheticExample, projectResponseSchema } from "../src/catalog/schema.js";

describe("schema-valid synthetic response generation", () => {
  it("honors const, enum, allOf, and disjoint oneOf variants", () => {
    expect(
      generateSyntheticExample({
        oneOf: [
          {
            type: "object",
            required: ["code", "data"],
            properties: {
              code: { const: 0 },
              data: {
                allOf: [
                  { type: "object", required: ["kind"], properties: { kind: { const: "ok" } } },
                  { type: "object", properties: { state: { enum: ["ready"] } } },
                ],
              },
            },
          },
          {
            type: "object",
            required: ["code"],
            properties: { code: { enum: [1, 2] } },
          },
        ],
        discriminator: { propertyName: "code" },
      })
    ).toEqual({ code: 0, data: { kind: "ok", state: "ready" } });
  });

  it("honors numeric ranges and multiples and omits impossible values", () => {
    expect(
      generateSyntheticExample({
        type: "number",
        minimum: 10,
        maximum: 20,
        multipleOf: 5,
      })
    ).toBe(10);
    expect(
      generateSyntheticExample({
        type: "number",
        minimum: 1,
        exclusiveMinimum: true,
        maximum: 2,
      })
    ).toBe(1.5);
    expect(generateSyntheticExample({ type: "integer", minimum: 2, maximum: 1 })).toBeUndefined();
  });

  it("honors string lengths and encoding and omits an unsupported pattern candidate", () => {
    expect(generateSyntheticExample({ type: "string", minLength: 10, maxLength: 12 })).toHaveLength(
      10
    );
    expect(generateSyntheticExample({ type: "string", contentEncoding: "base64" })).toBe(
      "ZXhhbXBsZQ=="
    );
    expect(generateSyntheticExample({ type: "string", pattern: "^\\d{4}$" })).toBeUndefined();
  });

  it("honors prefix items, contains, item bounds, and uniqueness", () => {
    expect(
      generateSyntheticExample({
        type: "array",
        prefixItems: [{ const: "primary" }],
        contains: { const: "featured" },
        minContains: 1,
        minItems: 2,
        maxItems: 3,
        uniqueItems: true,
      })
    ).toEqual(["primary", "featured"]);
    expect(
      generateSyntheticExample({
        type: "array",
        items: { const: "same" },
        minItems: 2,
        uniqueItems: true,
      })
    ).toBeUndefined();
  });

  it("omits examples for conflicting allOf constraints", () => {
    expect(
      generateSyntheticExample({
        allOf: [
          { type: "string", const: "left" },
          { type: "string", const: "right" },
        ],
      })
    ).toBeUndefined();
  });

  it("fails closed instead of weakening recursive response schemas", () => {
    const document = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };

    expect(() => projectResponseSchema({ $ref: "#/components/schemas/Node" }, document)).toThrow(
      /Recursive response schema refs are not supported/
    );
  });
});
