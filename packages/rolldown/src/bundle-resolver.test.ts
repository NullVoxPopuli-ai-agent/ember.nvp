import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { emberBundleResolver } from "./bundle-resolver.ts";

let restoreCwd: (() => void) | undefined;
let restoreNodeEnv: (() => void) | undefined;

afterEach(() => {
  restoreCwd?.();
  restoreCwd = undefined;
  restoreNodeEnv?.();
  restoreNodeEnv = undefined;
});

/**
 * An ember-source stub with the real manifest's `renamed-modules` shape:
 * keys are module file paths, values are the same paths under the package.
 */
const EMBER_SOURCE_STUB = {
  name: "ember-source",
  version: "0.0.0",
  "ember-addon": {
    "renamed-modules": {
      "@ember/modifier/index.js": "ember-source/@ember/modifier/index.js",
      "@ember/modifier/on.js": "ember-source/@ember/modifier/on.js",
      "@glimmer/runtime/index.js": "ember-source/@glimmer/runtime/index.js",
      "rsvp/index.js": "ember-source/rsvp/index.js",
    },
  },
};

async function fixture({ emberSource = true } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ember-rolldown-bundle-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));

  if (emberSource) {
    const stubDir = path.join(dir, "node_modules/ember-source");
    await mkdir(stubDir, { recursive: true });
    await writeFile(path.join(stubDir, "package.json"), JSON.stringify(EMBER_SOURCE_STUB));
  }

  const previousCwd = process.cwd();
  process.chdir(dir);
  restoreCwd = () => process.chdir(previousCwd);

  return dir;
}

function withNodeEnv(value: string | undefined) {
  const previous = process.env["NODE_ENV"];

  if (value === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = value;
  }

  restoreNodeEnv = () => {
    if (previous === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = previous;
    }
  };
}

/** Runs the plugin's own hooks directly against the current fixture. */
function resolveWith(source: string): unknown {
  const plugin = emberBundleResolver();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  (plugin.buildStart as any).call({ addWatchFile() {} });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  return (plugin.resolveId as any).handler(source);
}

function emberSourceFile(dir: string, build: "dev" | "prod", modulePath: string) {
  return path.join(dir, "node_modules/ember-source/dist", build, "packages", modulePath);
}

describe("emberBundleResolver", () => {
  it("resolves a provided package to its index in ember-source's production build", async () => {
    const dir = await fixture();
    withNodeEnv(undefined);

    expect(resolveWith("@ember/modifier")).toBe(
      emberSourceFile(dir, "prod", "@ember/modifier/index.js"),
    );
    expect(resolveWith("@glimmer/runtime")).toBe(
      emberSourceFile(dir, "prod", "@glimmer/runtime/index.js"),
    );
    expect(resolveWith("rsvp")).toBe(emberSourceFile(dir, "prod", "rsvp/index.js"));
  });

  it("resolves a provided module file", async () => {
    const dir = await fixture();
    withNodeEnv("production");

    expect(resolveWith("@ember/modifier/on")).toBe(
      emberSourceFile(dir, "prod", "@ember/modifier/on.js"),
    );
  });

  it("selects the development build under NODE_ENV=development", async () => {
    const dir = await fixture();
    withNodeEnv("development");

    expect(resolveWith("@ember/modifier")).toBe(
      emberSourceFile(dir, "dev", "@ember/modifier/index.js"),
    );
  });

  it("leaves everything ember-source does not provide alone", async () => {
    await fixture();

    expect(resolveWith("@glimmer/component")).toBeNull();
    expect(resolveWith("left-pad")).toBeNull();
    expect(resolveWith("./local.js")).toBeNull();
    expect(resolveWith("node:path")).toBeNull();
  });

  it("does nothing without ember-source in the graph", async () => {
    await fixture({ emberSource: false });

    expect(resolveWith("@ember/modifier")).toBeNull();
  });
});
