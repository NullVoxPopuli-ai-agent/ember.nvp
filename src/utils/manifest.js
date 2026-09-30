import { packageJson } from "ember-apply";
import { hasAllKeys } from "./object.js";

/**
 * @param {Record<string, any>} manifest
 * @param {string[] | Record<string, unknown>} listOrObject
 */
export function hasDevDeps(manifest, listOrObject) {
  return hasAllKeys(manifest.devDependencies ?? {}, listOrObject);
}

/**
 * Like `packageJson.read`, but an empty object when there is no package.json yet
 *
 * @param {import('./project.js').Project} project
 * @returns {Promise<Record<string, any>>}
 */
export async function readManifest(project) {
  if (!project.hasFile("package.json")) return {};

  return packageJson.read(project.directory);
}
