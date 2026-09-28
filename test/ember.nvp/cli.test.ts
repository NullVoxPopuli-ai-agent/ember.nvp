import { test, expect as hardExpect } from "vitest";
import { cli } from "#test-helpers";
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
