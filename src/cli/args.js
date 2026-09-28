import * as p from "@clack/prompts";
import { styleText, parseArgs } from "node:util";
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

/**
 * The CLI options are parsed using Node's `parseArgs` in default strict mode.
 */
const { values } = parseArgs({
  options,
});

const { replaceOrUpdate, name, type, layers = [], packageManager, path, confirm, write } = values;

export const answers = {
  name,
  type,
  layers,
  packageManager,
  path,
  confirm,
  replaceOrUpdate,
  write,
};

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
