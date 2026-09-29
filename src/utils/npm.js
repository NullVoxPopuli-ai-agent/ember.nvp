import latestVersion from "latest-version";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @type {{ [name: string]: { [version: string]: string } }}
 */
const CACHE = {};

/**
 * Local, not-yet-published workspace packages.
 * These must be `link:`ed rather than resolved from the registry.
 *
 * Maps the published package name to its folder under `packages/`.
 *
 * @type {{ [name: string]: string }}
 */
const LOCAL_PACKAGES = {
  "@nullvoxpopuli/ember-vite": "vite",
  "@nullvoxpopuli/ember-rolldown": "rolldown",
};

/**
 * @param {{ [name: string]: string }} deps map of dep name to semver range
 */
export async function getLatest(deps) {
  let needsLocalLink = await needsWorkspace();

  let results = await Promise.all(
    Object.entries(deps).map(async ([dep, range]) => {
      let existing = CACHE[dep]?.[range];

      if (existing) {
        return [dep, existing];
      }

      let version;
      let alias = parseAlias(range);

      /**
       * HACK FOR CI.
       *
       * In practice, these packages will be published separately,
       * and those versions will be used.
       *
       * Only the local, not-yet-published @nullvoxpopuli/ember-* packages need the link.
       * Every other dependency must still resolve its real version.
       *
       * We use `link:` (a symlink) rather than `file:` (a copy into the store) on purpose:
       * - the packages ship TypeScript source
       * - Node 24 refuses to strip types for files physically located under node_modules
       * - a symlink makes Node resolve the realpath to packages/* (outside node_modules),
       *   so its `.ts` runs directly
       */
      if (needsLocalLink && LOCAL_PACKAGES[dep]) {
        version =
          "link:" + resolve(join(import.meta.dirname, "../../packages", LOCAL_PACKAGES[dep]));
      } else if (alias) {
        version = `npm:${alias.name}@${await latestVersion(alias.name, { version: alias.range })}`;
      } else {
        if (range == "workspace:*") {
          range = "latest";
        }
        version = await latestVersion(dep, { version: range });
      }

      CACHE[dep] ||= {};
      CACHE[dep][range] = version;

      return [dep, version];
    }),
  );

  return Object.fromEntries(results);
}

/**
 * An npm alias installs a package under another name:
 *
 *   "@typescript/native": "npm:typescript@^7.1.0-0"
 *
 * The range belongs to the aliased package.
 *
 * @param {string} range
 * @returns {{ name: string; range: string } | undefined}
 */
function parseAlias(range) {
  if (!range.startsWith("npm:")) return;

  let spec = range.slice("npm:".length);
  // The last `@` starts the range. A scope's `@` is at index 0.
  let at = spec.lastIndexOf("@");

  if (at <= 0) {
    return { name: spec, range: "latest" };
  }

  return { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

async function needsWorkspace() {
  if (process.env.GITHUB_REPOSITORY === "NullVoxPopuli/ember.nvp") return true;

  let root = resolve(import.meta.dirname, "../../");

  if (existsSync(join(root, ".git"))) {
    return true;
  }

  return false;
}
