import { packageJson } from "ember-apply";
import { remove } from "./files.js";

/**
 * Tooling that the old blueprints generate, by the layer that replaces it.
 *
 * When the user selects the layer, the migration removes the old tooling,
 * so that the layer can write its own.
 * Otherwise the old tooling stays as it is.
 *
 * @type {Record<string, { files: string[], scripts: string[], devDependencies: string[] }>}
 */
const REPLACED = {
  "eslint-bundled": {
    files: [
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.js",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc",
      ".eslintignore",
    ],
    scripts: ["lint:js", "lint:js:fix"],
    devDependencies: [
      "@babel/eslint-parser",
      "@eslint/js",
      "@typescript-eslint/eslint-plugin",
      "@typescript-eslint/parser",
      "eslint-config-prettier",
      "eslint-plugin-decorator-position",
      "eslint-plugin-ember",
      "eslint-plugin-import",
      "eslint-plugin-n",
      "eslint-plugin-node",
      "eslint-plugin-prettier",
      "eslint-plugin-qunit",
      "eslint-plugin-warp-drive",
      "globals",
      "typescript-eslint",
    ],
  },
  prettier: {
    files: [
      ".prettierrc.mjs",
      ".prettierrc.cjs",
      ".prettierrc.js",
      ".prettierrc.json",
      ".prettierrc",
    ],
    scripts: ["lint:format"],
    devDependencies: [],
  },
  "github-actions": {
    files: [".github/workflows/ci.yml"],
    scripts: [],
    devDependencies: [],
  },
  // Glint's own CLI and environments, which the typescript layer's setup does not use
  typescript: {
    files: [],
    scripts: [],
    devDependencies: [
      "@glint/core",
      "@glint/environment-ember-loose",
      "@glint/environment-ember-template-imports",
    ],
  },
};

/**
 * @param {import('#utils/project.js').Project} project
 * @param {import('#types').MigrationReport} report
 */
export async function removeToolingOfWantedLayers(project, report) {
  for (let [layer, replaced] of Object.entries(REPLACED)) {
    if (!project.wantsLayer(layer)) continue;

    await remove(project, replaced.files);
    await packageJson.removeDevDependencies(replaced.devDependencies, project.directory);
    await packageJson.modify((json) => {
      for (let script of replaced.scripts) {
        delete json.scripts?.[script];
      }
    }, project.directory);
  }

  if (!project.wantsLayer("typescript")) return;

  let manifest = await packageJson.read(project.directory);
  /** @type {string[]} */
  let glint = [];

  for (let [name, command] of Object.entries(manifest.scripts ?? {})) {
    // the typescript layer writes its own lint:types
    if (name !== "lint:types" && /(^|\s|&&)glint\b/.test(String(command)))
      glint.push(`${name}: ${command}`);
  }

  if (glint.length > 0) {
    report.todo.push({
      title: "Scripts that run the glint CLI",
      where: glint,
      action:
        "Run the checker of the typescript layer instead, the way lint:types does.\n" +
        "The migration removed @glint/core, which has the glint CLI.",
    });
  }
}
