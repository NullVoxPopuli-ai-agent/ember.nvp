import path from "node:path";

import type { Plugin } from "rolldown";

import { emberSource } from "./externals.ts";

/**
 * ember-source ships two builds of every module. The development build keeps
 * assertions and deprecation messages; the production build strips them.
 */
function distFolder(): "dev" | "prod" {
  return process.env["NODE_ENV"] === "development" ? "dev" : "prod";
}

/**
 * Resolves the modules ember-source provides (`@ember/*`, `@glimmer/*`,
 * `rsvp`, `backburner.js`, …) to the files inside ember-source's `dist`, so
 * that a bundle-mode build can include them.
 *
 * These specifiers are not resolvable by node: ember-source lists them in
 * `ember-addon.renamed-modules` and expects the app's build tooling to map
 * each one to `dist/<dev|prod>/packages/<module path>`. This plugin is that
 * mapping for rolldown. Which of the two builds it maps to follows
 * `NODE_ENV`: `development` selects the development build, anything else
 * the production build.
 */
export function emberBundleResolver(): Plugin {
  let source: ReturnType<typeof emberSource>;
  let folder: string;

  return {
    name: "ember:bundle-resolver",

    buildStart() {
      this.addWatchFile("package.json");
      source = emberSource();
      folder = distFolder();
    },

    resolveId: {
      order: "pre",
      handler(specifier) {
        if (!source) {
          return null;
        }

        if (specifier.includes(":") || specifier.startsWith(".") || path.isAbsolute(specifier)) {
          return null;
        }

        // The map is keyed by module file path, and a specifier can name a
        // file (`@ember/modifier/on`) or a directory's index
        // (`@ember/modifier`).
        for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
          const renamed = source.renamedModules[candidate];

          if (renamed) {
            const modulePath = renamed.replace(/^ember-source\//, "");

            return path.join(source.directory, "dist", folder, "packages", modulePath);
          }
        }

        return null;
      },
    },
  };
}
