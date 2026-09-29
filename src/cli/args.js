import * as p from "@clack/prompts";
import { styleText, parseArgs } from "node:util";
import { layers as discoveredLayers } from "#layers";
import { validateOption } from "./questions/validate-option.js";
import { printHelp } from "./help.js";

export const coreOptions = /** @type {const} */ ({
  help: {
    type: "boolean",
    short: "h",
    description: "Show CLI help and option details",
  },

  name: {
    type: "string",
    description: "Name of the project",
  },

  path: {
    type: "string",
    description: "Target directory path for the project",
  },

  type: {
    type: "string",
    choices: ["app", "addon", "library", "extension", "custom-element"],
    description: "Type of project to generate",
  },

  confirm: {
    type: "string",
    choices: ["yes", "no"],
    description: "Bypass target confirmation step",
  },

  layers: {
    type: "string",
    multiple: true,
    description: "Layers to apply to the project (repeat for multiple layers)",
  },

  packageManager: {
    type: "string",
    choices: ["npm", "pnpm"],
    description: "Package manager to configure for the project",
  },

  replaceOrUpdate: {
    type: "string",
    choices: ["replace", "update"],
    description: "Strategy to use if target directory exists",
  },

  write: {
    type: "string",
    choices: ["yes", "no"],
    description: "Confirm writing changes to disk",
  },
});

/**
 * This lightweight check is here because Node's `parseArgs` is in strict mode.
 * If a user runs `npx ember.nvp --help` alongside invalid or unknown flags,
 * standard strict parsing would throw a `TypeError (ERR_PARSE_ARGS_UNKNOWN_OPTION)`
 * before reaching any help handler. Pre-checking raw arguments ensures `--help`
 * always prints successfully regardless of invalid flags.
 */
const isHelpRequested = process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h");
if (isHelpRequested) {
  printHelp(coreOptions);
  process.exit(0);
}

/** @type {Record<string, import("node:util").ParseArgsOptionDescriptor>} */
const options = { ...coreOptions };

for (const layer of discoveredLayers) {
  if (!layer.options) continue;
  for (const [optionKey, schema] of Object.entries(layer.options)) {
    options[`${layer.name}.${optionKey}`] = {
      type: schema.type === "confirm" ? "boolean" : "string",
      ...(schema.type === "multiselect" ? { multiple: true } : {}),
    };
  }
}

/**
 * The CLI options are parsed by combining the static core flags (--name, --type, etc.) with
 * dynamic options discovered at startup from each layer in #layers (formatted as
 * --<layerName>.<optionKey>).  This lets us use Node's `parseArgs` in default strict mode.
 */
const { values } = parseArgs({
  args: process.argv.slice(2),
  options,
});

const typedValues =
  /** @type {ReturnType<typeof parseArgs<{ options: typeof coreOptions }>>['values']} */ (values);

export const answers = {
  ...typedValues,
  layers: typedValues.layers ?? [],
};

/**
 * Extract layer options from parsed CLI values.
 *
 * @param {import('#types').DiscoveredLayer[]} layers
 * @param {Record<string, any>} [parsedValues] Defaults to module-level `values` from parseArgs
 * @returns {Record<string, Record<string, any>>}
 */
export function parseLayerOptionsFromParsedArgs(layers = [], parsedValues = values) {
  /** @type {Record<string, Record<string, any>>} */
  const result = {};

  for (const layer of layers) {
    if (!layer.options) continue;

    for (const [optionKey, schema] of Object.entries(layer.options)) {
      const flagKey = `${layer.name}.${optionKey}`;
      const rawVal = parsedValues[flagKey];

      if (rawVal !== undefined) {
        const validation = validateOption(schema, rawVal);
        if (!validation.ok) {
          p.cancel(`Invalid CLI argument '--${flagKey}': ${validation.error}`);
          process.exit(1);
        }

        const layerObj = (result[layer.name] ??= {});
        // validation.value contains the coerced value (e.g. string to number) produced by validateOption
        layerObj[optionKey] = validation.value;
      }
    }
  }

  return result;
}

/**
 *
 * @param {string} label
 * @param {string} value
 */
export function printArgInUse(label, value) {
  let l = styleText(["gray", "bold"], label);
  let v = styleText(["yellow", "italic"], value);
  let u = styleText("dim", "using");
  p.log.info(`${u} ${l}: ${v}`);
}
