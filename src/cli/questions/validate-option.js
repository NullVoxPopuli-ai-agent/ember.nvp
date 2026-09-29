/**
 * @typedef {import('#types').LayerOptionSchema} LayerOptionSchema
 *
 * @typedef {{ ok: true, value: any }} ValidationSuccess
 * @typedef {{ ok: false, error: string }} ValidationFailure
 * @typedef {ValidationSuccess | ValidationFailure} ValidationResult
 */

/**
 * Convert a value from a CLI flag or a prompt to the option's type,
 * then run the option's own `validate`.
 *
 * Defaults are not applied here.
 * See `Project#getLayerOptions`.
 *
 * @param {LayerOptionSchema} schema
 * @param {unknown} rawValue
 * @returns {ValidationResult}
 */
export function validateOption(schema, rawValue) {
  const converted = convert(schema, rawValue);

  if (!converted.ok || !schema.validate) return converted;

  const result = schema.validate(converted.value);

  if (typeof result === "string") return { ok: false, error: result };
  if (result === false) return { ok: false, error: "Invalid value" };

  return converted;
}

/**
 * @param {LayerOptionSchema} schema
 * @param {unknown} rawValue
 * @returns {ValidationResult}
 */
function convert(schema, rawValue) {
  switch (schema.type) {
    case "text":
      return { ok: true, value: String(rawValue) };

    case "number": {
      const text = String(rawValue).trim();

      /**
       * Number() also accepts "", "0x10", and "1e3",
       * which nobody means when they type a count.
       */
      if (!/^-?\d+(\.\d+)?$/.test(text)) {
        return { ok: false, error: `'${text}' is not a number` };
      }

      return { ok: true, value: Number(text) };
    }

    case "confirm":
      return typeof rawValue === "boolean"
        ? { ok: true, value: rawValue }
        : { ok: false, error: `'${String(rawValue)}' is not true or false` };

    case "select": {
      const allowed = choicesOf(schema);

      return typeof rawValue === "string" && allowed.includes(rawValue)
        ? { ok: true, value: rawValue }
        : { ok: false, error: notAChoice(rawValue, allowed) };
    }

    case "multiselect": {
      const allowed = choicesOf(schema);

      if (!Array.isArray(rawValue)) {
        return { ok: false, error: `'${String(rawValue)}' is not a list` };
      }

      for (const item of rawValue) {
        if (!allowed.includes(item)) {
          return { ok: false, error: notAChoice(item, allowed) };
        }
      }

      return { ok: true, value: rawValue };
    }

    default:
      return { ok: false, error: `Unknown option type '${String(schema.type)}'` };
  }
}

/**
 * @param {LayerOptionSchema} schema
 * @returns {string[]}
 */
function choicesOf(schema) {
  return (schema.options ?? []).map((choice) => choice.value);
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 */
function notAChoice(value, allowed) {
  return `Invalid option '${String(value)}'. Must be one of: ${allowed.join(", ")}`;
}
