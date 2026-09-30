import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TSDOWN_CONFIGS = [
  "tsdown.config.js",
  "tsdown.config.ts",
  "tsdown.config.mjs",
  "tsdown.config.mts",
];

/**
 * Guesses the type of an existing project, so an update can default to it.
 *
 * The order matters:
 * - extensions and web apps both have an index.html and an app/ folder
 * - custom elements and libraries both build with tsdown
 * - a library can have an index.html for its docs app
 *
 * @param {string} directory
 * @returns {import('#types').ProjectType | undefined}
 */
export function detectProjectType(directory) {
  let manifest = readJSON(join(directory, "package.json")) ?? {};
  let emberAddonType = manifest["ember-addon"]?.type;

  if (isExtension(directory)) return "extension";
  if (isCustomElement(directory)) return "custom-element";

  if (
    emberAddonType === "addon" ||
    manifest.keywords?.includes("ember-addon") ||
    TSDOWN_CONFIGS.some((file) => existsSync(join(directory, file)))
  ) {
    return "library";
  }

  if (emberAddonType === "app" || existsSync(join(directory, "app"))) {
    return "app";
  }
}

/**
 * A web app can have a manifest.json too (for a PWA),
 * but only a browser extension's manifest has `manifest_version`.
 *
 * @param {string} directory
 */
function isExtension(directory) {
  return ["manifest.json", "public/manifest.json"].some(
    (file) => readJSON(join(directory, file))?.manifest_version,
  );
}

/**
 * @param {string} directory
 */
function isCustomElement(directory) {
  return ["src/register.ts", "src/register.js"].some((file) => {
    let path = join(directory, file);

    return existsSync(path) && readFileSync(path, "utf-8").includes("customElements.define");
  });
}

/**
 * A broken file makes no guess, rather than stopping the CLI.
 *
 * @param {string} path
 * @returns {any}
 */
function readJSON(path) {
  if (!existsSync(path)) return;

  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return;
  }
}
