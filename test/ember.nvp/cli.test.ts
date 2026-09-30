import { test, expect as hardExpect } from "vitest";
import { cli, mktemp } from "#test-helpers";
import { packageJson } from "ember-apply";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const expect = hardExpect.soft;

test.skip("cli works", async () => {
  let { execaPromise, output, input } = cli();

  await execaPromise;

  expect(execaPromise.exitCode).toBe(0);
});

const BASIC_HELP_OUTPUT = `
    " ember.nvp 

    Usage: npx ember.nvp [options]

    Core Options:
      -h, --help <boolean>
          Show CLI help and option details

          --name <string>
          Name of the project

          --path <string>
          Target directory path for the project

          --type <string>
          Type of project to generate [choices: "app", "addon", "library", "extension", "custom-element"]

          --confirm <string>
          Bypass target confirmation step [choices: "yes", "no"]

          --layers <string>
          Layers to apply to the project (repeat for multiple layers)

          --packageManager <string>
          Package manager to configure for the project [choices: "npm", "pnpm"]

          --replaceOrUpdate <string>
          Strategy to use if target directory exists [choices: "replace", "update"]

          --write <string>
          Confirm writing changes to disk [choices: "yes", "no"]

    Layer Options:
          --eslint-bundled.preset <string>
          Which ESLint config? [choices: "ember", "nvp"] [default: "ember"]

          --typescript.version <string>
          Which TypeScript version? [choices: "7", "6"] [default: "7"]
    "
  `;

test("cli --help outputs usage and core options", async () => {
  let { execaPromise } = cli(["--help"]);

  const res = await execaPromise;

  expect(res.exitCode).toBe(0);
  const outStr = stripVTControlCharacters(res.stdout);
  expect(outStr).toMatchInlineSnapshot(BASIC_HELP_OUTPUT);
});

test("cli -h alias works", async () => {
  let { execaPromise } = cli(["-h"]);

  const res = await execaPromise;

  expect(res.exitCode).toBe(0);
  const outStr = stripVTControlCharacters(res.stdout);
  expect(outStr).toMatchInlineSnapshot(BASIC_HELP_OUTPUT);
});

test("cli prints a message, not a stack trace, for an unknown flag", async () => {
  let { execaPromise } = cli(["--bogus"]);

  const res = await execaPromise.catch((error) => error);

  expect(res.exitCode).toBe(1);
  const outStr = stripVTControlCharacters(`${res.stdout}\n${res.stderr}`);
  expect(outStr).toContain("Unknown option '--bogus'");
  expect(outStr).not.toContain("TypeError");
});

/**
 * Every question has a flag, so nothing prompts.
 * The path does not exist yet, so there is no replace-or-update question either.
 */
async function eslintProjectArgs(preset: string) {
  let parent = await mktemp("cli-layer-options");
  let path = join(parent, "my-app");

  return {
    parent,
    path,
    args: [
      "--name",
      "my-app",
      "--path",
      path,
      "--type",
      "app",
      "--layers",
      "eslint-bundled",
      "--packageManager",
      "pnpm",
      "--confirm",
      "yes",
      "--eslint-bundled.preset",
      preset,
    ],
  };
}

test("cli applies a layer option flag", async () => {
  let { parent, path, args } = await eslintProjectArgs("nvp");

  try {
    let res = await cli(args).execaPromise;

    expect(res.exitCode).toBe(0);

    let manifest = await packageJson.read(path);

    expect(manifest.devDependencies).toHaveProperty("@nullvoxpopuli/eslint-configs");
    expect(manifest.devDependencies).not.toHaveProperty("ember-eslint");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("cli exits on an invalid layer option flag, before writing anything", async () => {
  let { parent, path, args } = await eslintProjectArgs("bogus");

  try {
    const res = await cli(args).execaPromise.catch((error) => error);

    expect(res.exitCode).toBe(1);
    expect(stripVTControlCharacters(res.stdout)).toContain(
      "Invalid CLI argument '--eslint-bundled.preset': Invalid option 'bogus'. Must be one of: ember, nvp",
    );
    expect(existsSync(path)).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
