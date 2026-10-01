import packageJson from "package-json";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import semver from "semver";
import { readJSON } from "#utils/fs.js";

/**
 * @typedef {object} Dependency
 * @property {string} name
 * @property {Record<string, any>} manifest
 * @property {string | undefined} directory where it is installed, when it is
 */

/**
 * @typedef {object} V1Addon
 * @property {string} name
 * @property {string} version the version that the project uses
 * @property {string} [v2] the newest version, when that version is a v2 addon
 */

/**
 * Packages with the shape of a v1 addon that work without ember-cli
 */
const WORKS_WITHOUT_EMBER_CLI = new Set(["@embroider/macros"]);

/**
 * ember-cli runs v1 addons as part of its build.
 * ember.nvp builds without ember-cli, so a v1 addon never loads.
 *
 * @param {Record<string, any>} manifest
 */
export function isV1Addon(manifest) {
  return (
    Boolean(manifest.keywords?.includes("ember-addon")) &&
    manifest["ember-addon"]?.version !== 2 &&
    !WORKS_WITHOUT_EMBER_CLI.has(manifest.name)
  );
}

/**
 * Where a dependency is installed.
 *
 * Looks in `node_modules` of `directory` and of every parent, like Node does,
 * so that hoisted monorepo installs are found.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {string | undefined}
 */
export function installedDirectory(directory, name) {
  let current = directory;

  while (true) {
    let candidate = join(current, "node_modules", name);

    if (existsSync(join(candidate, "package.json"))) return candidate;

    let parent = dirname(current);

    if (parent === current) return;

    current = parent;
  }
}

/**
 * One request per package and range, for the whole process.
 * A CLI run checks the project before and during generation.
 *
 * @type {Map<string, Promise<Record<string, any> | undefined>>}
 */
const REGISTRY = new Map();

/**
 * @param {string} name
 * @param {string} range
 * @returns {Promise<Record<string, any> | undefined>} undefined when the registry has no match
 */
function registryManifest(name, range) {
  let key = `${name}@${range}`;
  let existing = REGISTRY.get(key);

  if (existing) return existing;

  // a range can cover only deprecated versions, such as all of ESLint 9
  let request = packageJson(name, {
    version: range,
    fullMetadata: true,
    omitDeprecated: false,
  }).then(
    (manifest) => /** @type {Record<string, any>} */ (manifest),
    () => undefined,
  );

  REGISTRY.set(key, request);

  return request;
}

/**
 * An npm alias installs another package under this name:
 *
 *   "ember-source": "npm:ember-source@~6.4.0"
 *
 * @param {string} name
 * @param {string} range
 * @returns {{ name: string, range: string } | undefined} undefined when the registry cannot answer
 */
function registryQuery(name, range) {
  if (range.startsWith("npm:")) {
    let spec = range.slice("npm:".length);
    let at = spec.lastIndexOf("@");

    return at <= 0
      ? { name: spec, range: "latest" }
      : { name: spec.slice(0, at), range: spec.slice(at + 1) };
  }

  if (semver.validRange(range) || /^[a-z][\w.-]*$/i.test(range)) {
    return { name, range };
  }
}

/**
 * Reads the manifest of each dependency.
 *
 * The installed version wins, because it is the one the project builds with.
 * Without an install, the registry answers for the declared range.
 *
 * @param {string} installDirectory where the project's node_modules can be
 * @param {Record<string, string>} dependencies name → range
 * @returns {Promise<{ found: Dependency[], unchecked: string[] }>}
 *   `unchecked` lists dependencies that are not installed and not on the registry
 */
export async function readDependencies(installDirectory, dependencies) {
  /** @type {Dependency[]} */
  let found = [];
  /** @type {string[]} */
  let unchecked = [];

  await Promise.all(
    Object.entries(dependencies).map(async ([name, range]) => {
      let directory = installedDirectory(installDirectory, name);
      let manifest = directory ? readJSON(join(directory, "package.json")) : undefined;

      if (!manifest) {
        let query = registryQuery(name, range);

        manifest = query && (await registryManifest(query.name, query.range));
      }

      if (!manifest) {
        unchecked.push(name);
        return;
      }

      found.push({ name, manifest, directory });
    }),
  );

  found.sort((a, b) => a.name.localeCompare(b.name));
  unchecked.sort();

  return { found, unchecked };
}

/**
 * @param {Dependency[]} dependencies
 * @returns {Promise<V1Addon[]>}
 */
export async function v1AddonsIn(dependencies) {
  /** @type {V1Addon[]} */
  let v1 = [];

  await Promise.all(
    dependencies.map(async ({ name, manifest }) => {
      if (!isV1Addon(manifest)) return;

      let latest = await registryManifest(name, "latest");
      let v2 = latest && !isV1Addon(latest) ? latest.version : undefined;

      v1.push({ name, version: manifest.version, v2 });
    }),
  );

  return v1.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {V1Addon} addon
 * @returns {string} such as `ember-power-select@6.0.1: upgrade to 8.9.0, a v2 addon`
 */
export function describeV1Addon(addon) {
  if (addon.v2) {
    return `${addon.name}@${addon.version}: upgrade to ${addon.v2}, a v2 addon`;
  }

  return `${addon.name}@${addon.version}: no v2 version on npm`;
}

/**
 * @typedef {object} AppModule
 * @property {string} addon the package that provides it
 * @property {string} path such as `services/session`
 * @property {string | undefined} specifier the module to import it from
 */

/**
 * Modules that v2 addons merge into an app through `ember-addon.app-js`.
 *
 * `@embroider/compat` merges them.
 * An ember.nvp app does not, so the app must register the ones it looks up by name.
 *
 * @param {Dependency[]} dependencies
 * @returns {AppModule[]}
 */
export function appModulesIn(dependencies) {
  /** @type {AppModule[]} */
  let modules = [];

  for (let { name, manifest, directory } of dependencies) {
    let appJs = manifest["ember-addon"]?.["app-js"] ?? {};

    for (let [appPath, file] of Object.entries(appJs)) {
      let target = String(file);
      let installed = directory ? reexportedFrom(join(directory, target)) : undefined;

      modules.push({
        addon: name,
        path: appPath.replace(/^\.\//, "").replace(/\.\w+$/, ""),
        specifier: installed ?? exportedAs(name, manifest, target),
      });
    }
  }

  return modules;
}

/**
 * @param {string} file an app-js module, such as `export { default } from "ember-page-title/services/page-title";`
 * @returns {string | undefined}
 */
function reexportedFrom(file) {
  if (!existsSync(file)) return;

  let match = /from\s+["']([^"']+)["']/.exec(readFileSync(file, "utf-8"));

  return match?.[1];
}

/**
 * The specifier that reaches `target` through the package's `exports`.
 *
 *   exports: { "./*": "./dist/*.js" }, target: ./dist/_app_/services/x.js
 *     → pkg/_app_/services/x
 *
 * @param {string} name
 * @param {Record<string, any>} manifest
 * @param {string} target a file in the package, such as `./dist/_app_/services/x.js`
 * @returns {string | undefined}
 */
function exportedAs(name, manifest, target) {
  let exports = manifest.exports;

  if (!exports) return `${name}/${target.replace(/^\.\//, "")}`;
  if (typeof exports !== "object") return;

  for (let [key, value] of Object.entries(exports)) {
    let path = typeof value === "string" ? value : (value?.import ?? value?.default);

    if (typeof path !== "string" || typeof key !== "string") continue;

    if (!path.includes("*")) {
      if (path === target) return `${name}/${key.replace(/^\.\//, "")}`;
      continue;
    }

    let [before = "", after = ""] = path.split("*");

    if (
      target.startsWith(before) &&
      target.endsWith(after) &&
      target.length >= before.length + after.length
    ) {
      let matched = target.slice(before.length, target.length - after.length);

      return `${name}/${key.replace(/^\.\//, "").replace("*", matched)}`;
    }
  }
}
