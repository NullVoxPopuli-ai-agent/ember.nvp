import { getLatest } from "#utils/npm.js";
import { files, packageJson } from "ember-apply";
import { formatLabel } from "#utils/cli.js";
import { maybeLintWithConcurrently } from "#consolidators/linting.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hasDevDeps, readManifest } from "#utils/manifest.js";
import { hasTypeScript6, syncTypeScript6, usesTypeScript7 } from "#utils/typescript.js";

/**
 * The config package of each preset.
 *
 * Each preset also has a folder in `files/`.
 *
 * @type {Record<string, Record<string, string>>}
 */
const PRESETS = {
  ember: { "ember-eslint": "^1.0.0" },
  nvp: { "@nullvoxpopuli/eslint-configs": "^7.0.0" },
};

/**
 * @param {Record<string, any>} manifest
 * @returns {string | undefined}
 */
function presetIn(manifest) {
  for (const [preset, deps] of Object.entries(PRESETS)) {
    if (hasDevDeps(manifest, deps)) return preset;
  }

  return undefined;
}

/**
 * @param {import('#utils/project.js').Project} project
 * @returns {string | undefined} undefined when the layer is not selected
 */
function wantedPreset(project) {
  if (!project.wantsLayer("eslint-bundled")) return undefined;

  return project.getLayerOptions("eslint-bundled").preset;
}

/**
 * @type {import('#types').Layer}
 */
export default {
  label: formatLabel("ESLint", "encapsulated config"),
  hint: `Minimal dependencies added to package.json`,

  options: {
    preset: {
      type: "select",
      prompt: "Which ESLint config?",
      default: "ember",
      options: [
        {
          value: "ember",
          label: "ember-eslint",
          hint: "Not official, but follows the official configuration",
        },
        {
          value: "nvp",
          label: "@nullvoxpopuli/eslint-configs",
          hint: "NullVoxPopuli's config for apps, libraries, TypeScript, and more",
        },
      ],
      async detect(project) {
        return presetIn(await readManifest(project));
      },
    },
  },

  async run(project, { preset }) {
    await files.applyFolder(join(import.meta.dirname, "files", preset), project.directory);

    // Only one preset at a time, so that switching presets leaves nothing behind
    for (const [other, deps] of Object.entries(PRESETS)) {
      if (other === preset) continue;

      await packageJson.removeDevDependencies(Object.keys(deps), project.directory);
    }

    await packageJson.addDevDependencies(
      await getLatest({
        ...PRESETS[preset],
        eslint: "^10.9.1",
      }),
      project.directory,
    );

    await packageJson.addScripts(
      {
        "lint:eslint": "eslint . --cache",
        "lint:eslint:fix": "eslint . --fix",
      },
      project.directory,
    );

    // typescript-eslint needs TypeScript 6
    await syncTypeScript6(project);

    await maybeLintWithConcurrently(project);
  },

  /**
   * @overload
   * @param {import('#utils/project.js').Project} project
   * @param {true} explain
   * @returns {Promise<{ isSetup: boolean; reasons: string[] }>}
   */
  /**
   * @overload
   * @param {import('#utils/project.js').Project} project
   * @param {boolean | undefined} [explain]
   * @returns {Promise<boolean>}
   */
  async isSetup(project, explain) {
    const reasons = [];

    if (!existsSync(join(project.directory, "eslint.config.js"))) {
      reasons.push("eslint.config.js is missing");

      if (!explain) return false;
    }

    let manifest = await packageJson.read(project.directory);
    let wanted = wantedPreset(project);

    if (!hasDevDeps(manifest, ["eslint"])) {
      reasons.push("missing required dependency: eslint");

      if (!explain) return false;
    }

    if (wanted ? !hasDevDeps(manifest, PRESETS[wanted] ?? {}) : !presetIn(manifest)) {
      reasons.push(`missing the config package of the ${wanted ?? "ember or nvp"} preset`);

      if (!explain) return false;
    }

    if (usesTypeScript7(project, manifest) && !hasTypeScript6(manifest)) {
      reasons.push("missing typescript (TypeScript 6) for typescript-eslint");

      if (!explain) return false;
    }

    let scripts = Object.values(manifest.scripts ?? {}).filter((script) =>
      script.includes("eslint"),
    );

    if (!scripts.some((script) => script.includes("--cache"))) {
      reasons.push("missing eslint script with --cache flag");

      if (!explain) return false;
    }
    if (!scripts.some((script) => script.includes("--fix"))) {
      reasons.push("missing eslint script with --fix flag");

      if (!explain) return false;
    }

    if (explain) {
      return {
        isSetup: reasons.length === 0,
        reasons,
      };
    }

    return reasons.length === 0;
  },
};
