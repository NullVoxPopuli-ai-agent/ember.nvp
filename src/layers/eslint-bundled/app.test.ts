import { beforeAll, describe, it, expect as hardExpect, afterAll } from "vitest";
import { expectIsSetup, generate, layers, reapply } from "#test-helpers";
import { packageJson } from "ember-apply";

import type { Project } from "ember.nvp";
import { rm } from "node:fs/promises";

const expect = hardExpect.soft;

let layer = layers.find((layer) => layer.name === "eslint-bundled")!;

const CONFIG_PACKAGES = {
  ember: "ember-eslint",
  nvp: "@nullvoxpopuli/eslint-configs",
};

describe.each(Object.entries(CONFIG_PACKAGES))("preset: %s", (preset, configPackage) => {
  const options = { "eslint-bundled": { preset } };

  describe("starting without eslint-bundled", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "app",
        packageManager: "pnpm",
        layers: ["git"],
        options,
      });
    });

    afterAll(async () => {
      await rm(project.directory, { recursive: true, force: true });
    });

    it("applying eslint-bundled", async () => {
      await reapply(project, ["eslint-bundled"]);

      await expectIsSetup(project, layer);
      expect(await project.gitHasDiff()).toBe(false);
    });
  });

  describe("starting with eslint-bundled", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "app",
        packageManager: "pnpm",
        layers: ["eslint-bundled", "git"],
        options,
      });
    });

    afterAll(async () => {
      await rm(project.directory, { recursive: true, force: true });
    });

    it("installs only this preset's config package", async () => {
      let manifest = await packageJson.read(project.directory);
      let installed = Object.values(CONFIG_PACKAGES).filter(
        (name) => manifest.devDependencies?.[name],
      );

      expect(installed).toEqual([configPackage]);
    });

    it("detects the preset", async () => {
      expect(await layer.options?.preset?.detect?.(project)).toBe(preset);
    });

    it("reapplying eslint-bundled causes no changes", async () => {
      await reapply(project, ["eslint-bundled"]);

      await expectIsSetup(project, layer);
      expect(await project.gitHasDiff()).toBe(false);
    });
  });

  describe("package.json scripts", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "app",
        packageManager: "pnpm",
        layers: ["eslint-bundled", "git"],
        options,
      });

      let { exitCode } = await project.run("pnpm install");

      hardExpect(exitCode).toBe(0);

      await expectIsSetup(project, layer);
    });

    afterAll(async () => {
      await rm(project.directory, { recursive: true, force: true });
    });

    it("linting and fixing works", async () => {
      {
        let { exitCode } = await project.run("pnpm lint:eslint --fix");

        expect(exitCode).toBe(0);
      }

      {
        let { exitCode } = await project.run("pnpm lint:eslint");

        expect(exitCode).toBe(0);
      }
    });
  });
});

describe.each([
  ["ember", "nvp"],
  ["nvp", "ember"],
] as const)("switching presets: %s to %s", (from, to) => {
  let project: Project;

  beforeAll(async () => {
    let before = await generate({
      type: "app",
      packageManager: "pnpm",
      layers: ["eslint-bundled", "git"],
      options: { "eslint-bundled": { preset: from } },
    });

    project = await generate({
      directory: before.directory,
      type: "app",
      packageManager: "pnpm",
      layers: ["eslint-bundled", "git"],
      options: { "eslint-bundled": { preset: to } },
    });
  });

  afterAll(async () => {
    await rm(project.directory, { recursive: true, force: true });
  });

  it("replaces the config package and the config", async () => {
    let manifest = await packageJson.read(project.directory);

    expect(manifest.devDependencies).toHaveProperty(CONFIG_PACKAGES[to]);
    expect(manifest.devDependencies).not.toHaveProperty(CONFIG_PACKAGES[from]);
    expect(await project.read("eslint.config.js")).toContain(CONFIG_PACKAGES[to]);
    expect(await project.read("eslint.config.js")).not.toContain(CONFIG_PACKAGES[from]);
  });

  it("is setup, and detects the new preset", async () => {
    await expectIsSetup(project, layer);
    expect(await layer.options?.preset?.detect?.(project)).toBe(to);
  });

  it("reapplying causes no changes", async () => {
    await reapply(project, ["eslint-bundled", "git"]);

    expect(await project.gitHasDiff()).toBe(false);
  });

  it("linting and fixing works", async () => {
    let install = await project.run("pnpm install");
    hardExpect(install.exitCode).toBe(0);

    {
      let { exitCode } = await project.run("pnpm lint:eslint --fix");

      expect(exitCode).toBe(0);
    }

    {
      let { exitCode } = await project.run("pnpm lint:eslint");

      expect(exitCode).toBe(0);
    }
  });
});
