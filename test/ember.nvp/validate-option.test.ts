import { describe, it, expect } from "vitest";
import { validateOption } from "../../src/cli/questions/validate-option.js";
import type { LayerOptionSchema } from "../../src/utils/types.js";

describe("validateOption", () => {
  describe("number validation", () => {
    const schema: LayerOptionSchema = {
      type: "number",
      prompt: "Enter number",
      default: 10,
      validate: (val: number) => val > 0 || "Must be greater than 0",
    };

    it("validates valid numbers", () => {
      expect(validateOption(schema, 5)).toEqual({ ok: true, value: 5 });
      expect(validateOption(schema, "42")).toEqual({ ok: true, value: 42 });
      expect(validateOption(schema, " 2.5 ")).toEqual({ ok: true, value: 2.5 });
    });

    it.each(["", "abc", "0x10", "1e3"])("fails on '%s'", (input) => {
      expect(validateOption(schema, input)).toEqual({
        ok: false,
        error: `'${input}' is not a number`,
      });
    });

    it("fails custom validate function", () => {
      expect(validateOption(schema, -5)).toEqual({ ok: false, error: "Must be greater than 0" });
    });
  });

  describe("text validation", () => {
    const schema: LayerOptionSchema = {
      type: "text",
      prompt: "Enter text",
      default: "default-title",
      validate: (val: string) => val.length >= 3 || "Minimum 3 chars",
    };

    it("validates valid text", () => {
      expect(validateOption(schema, "hello")).toEqual({ ok: true, value: "hello" });
    });

    it("fails custom validate function", () => {
      expect(validateOption(schema, "hi")).toEqual({ ok: false, error: "Minimum 3 chars" });
    });

    it("fails with a generic message when validate returns false", () => {
      const strict: LayerOptionSchema = { ...schema, validate: () => false };

      expect(validateOption(strict, "hello")).toEqual({ ok: false, error: "Invalid value" });
    });
  });

  describe("confirm validation", () => {
    const schema: LayerOptionSchema = {
      type: "confirm",
      prompt: "Confirm action",
      default: true,
    };

    it("validates booleans", () => {
      expect(validateOption(schema, true)).toEqual({ ok: true, value: true });
      expect(validateOption(schema, false)).toEqual({ ok: true, value: false });
    });

    it("fails on strings", () => {
      expect(validateOption(schema, "yes")).toEqual({
        ok: false,
        error: "'yes' is not true or false",
      });
    });
  });

  describe("select validation", () => {
    const schema: LayerOptionSchema = {
      type: "select",
      prompt: "Select option",
      default: "standard",
      options: [
        { label: "Standard", value: "standard" },
        { label: "Deluxe", value: "deluxe" },
      ],
    };

    it("validates valid option choice", () => {
      expect(validateOption(schema, "deluxe")).toEqual({ ok: true, value: "deluxe" });
    });

    it("fails unlisted choice", () => {
      expect(validateOption(schema, "ultra")).toEqual({
        ok: false,
        error: "Invalid option 'ultra'. Must be one of: standard, deluxe",
      });
    });
  });

  describe("multiselect validation", () => {
    const schema: LayerOptionSchema = {
      type: "multiselect",
      prompt: "Select options",
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
      validate: (val: string[]) => val.length > 0 || "Select at least one",
    };

    it("validates listed choices", () => {
      expect(validateOption(schema, ["a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    });

    it("fails unlisted choice", () => {
      expect(validateOption(schema, ["a", "c"])).toEqual({
        ok: false,
        error: "Invalid option 'c'. Must be one of: a, b",
      });
    });

    it("fails custom validate function", () => {
      expect(validateOption(schema, [])).toEqual({ ok: false, error: "Select at least one" });
    });
  });
});
