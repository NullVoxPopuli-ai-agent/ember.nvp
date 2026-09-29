import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { generate, expectIsSetup, layers, reapply } from "#test-helpers";
import { writeLibrarySource } from "./library-src-fixtures.ts";
import { execa } from "execa";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageJson } from "ember-apply";

import type { Project } from "ember.nvp";

const typescript7 = layers.find((layer) => layer.name === "typescript-7")!;
const typescript = layers.find((layer) => layer.name === "typescript")!;
const eslint = layers.find((layer) => layer.name === "eslint-bundled-nvp")!;

function run(project: Project, command: string) {
  return execa(command, { cwd: project.directory, shell: true, all: true, reject: false });
}

async function devDependencies(project: Project): Promise<Record<string, string>> {
  let manifest = await packageJson.read(project.directory);

  return manifest.devDependencies ?? {};
}

describe("layer: typescript-7", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    if (process.env.CI) return;

    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  describe("app with eslint", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "app",
        layers: ["typescript-7", "eslint-bundled-nvp", "git"],
      });
      dirs.push(project.directory);
    });

    it("is setup", async () => {
      await expectIsSetup(project, typescript7);
      await expectIsSetup(project, eslint);
    });

    it("installs TypeScript 7 as @typescript/native, and TypeScript 6 for typescript-eslint", async () => {
      let deps = await devDependencies(project);

      expect(deps["@typescript/native"]).toMatch(/^npm:typescript@7\./);
      expect(deps["typescript"]).toMatch(/^npm:@typescript\/typescript6@6\./);
      expect(deps).toHaveProperty("ember-content-mapper");
      expect(deps).not.toHaveProperty("@glint/tsserver-plugin");
    });

    it("reapplying causes no changes", async () => {
      await reapply(project, ["typescript-7", "eslint-bundled-nvp", "git"]);

      expect(await project.gitHasDiff()).toBe(false);
    });

    describe("after install", () => {
      beforeAll(async () => {
        let install = await run(project, "pnpm install");
        expect(install.exitCode, install.all).toBe(0);
      });

      it("type checking works", async () => {
        let result = await run(project, "pnpm lint:types");

        expect(result.exitCode, result.all).toBe(0);
      });

      it("reports template errors in .gts files", async () => {
        let file = "app/templates/application.gts";
        let original = await project.read(file);

        await writeFile(
          join(project.directory, file),
          `const count: number = 1;\n\n<template>{{count.nope}}</template>\n`,
        );

        let result = await run(project, "pnpm lint:types");

        await writeFile(join(project.directory, file), original!);

        expect(result.exitCode).not.toBe(0);
        expect(result.all).toContain("application.gts");
        expect(result.all).toContain("'nope'");
      });

      it("linting works", async () => {
        await run(project, "pnpm lint:eslint --fix");

        let result = await run(project, "pnpm lint:eslint");

        expect(result.exitCode, result.all).toBe(0);
      });

      it("build works", async () => {
        let result = await run(project, "pnpm build");

        expect(result.exitCode, result.all).toBe(0);
      });
    });
  });

  describe("app without eslint", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({ type: "app", layers: ["typescript-7"] });
      dirs.push(project.directory);
    });

    it("is setup", async () => {
      await expectIsSetup(project, typescript7);
    });

    it("has no typescript, because nothing needs TypeScript 6", async () => {
      expect(await devDependencies(project)).not.toHaveProperty("typescript");
    });

    it("type checking works", async () => {
      let install = await run(project, "pnpm install");
      expect(install.exitCode, install.all).toBe(0);

      let result = await run(project, "pnpm lint:types");

      expect(result.exitCode, result.all).toBe(0);
    });
  });

  describe("migrating a TypeScript 6 app", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "app",
        layers: ["typescript", "eslint-bundled-nvp", "git"],
      });
      dirs.push(project.directory);

      await reapply(project, ["typescript", "typescript-7", "eslint-bundled-nvp", "git"]);
    });

    it("is setup", async () => {
      await expectIsSetup(project, typescript7);
      await expectIsSetup(project, typescript);
      await expectIsSetup(project, eslint);
    });

    it("switches to TypeScript 7 and keeps TypeScript 6 for typescript-eslint", async () => {
      let manifest = await packageJson.read(project.directory);

      expect(manifest.scripts?.["lint:types"]).toBe("tsc --noEmit --runExternalCode");
      expect(manifest.devDependencies?.["typescript"]).toMatch(/^npm:@typescript\/typescript6@/);
      expect(manifest.devDependencies).not.toHaveProperty("@glint/tsserver-plugin");
    });

    it("type checking and linting work", async () => {
      let install = await run(project, "pnpm install");
      expect(install.exitCode, install.all).toBe(0);

      let types = await run(project, "pnpm lint:types");
      expect(types.exitCode, types.all).toBe(0);

      await run(project, "pnpm lint:eslint --fix");

      let lint = await run(project, "pnpm lint:eslint");
      expect(lint.exitCode, lint.all).toBe(0);
    });
  });

  describe("library", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({
        type: "library",
        name: "my-lib",
        layers: ["typescript-7", "expect-type"],
      });
      dirs.push(project.directory);

      await writeLibrarySource(project, "typescript");

      let install = await run(project, "pnpm install");
      expect(install.exitCode, install.all).toBe(0);
    });

    it("is setup", async () => {
      await expectIsSetup(project, typescript7);
    });

    it("keeps TypeScript 6 for the build", async () => {
      expect((await devDependencies(project))["typescript"]).toMatch(
        /^npm:@typescript\/typescript6@/,
      );
    });

    it("type checking works", async () => {
      let result = await run(project, "pnpm lint:types");

      expect(result.exitCode, result.all).toBe(0);
    });

    it("type tests resolve .gts modules", async () => {
      await writeFile(
        join(project.directory, "type-tests/greeting.test.ts"),
        `import { expectTypeOf } from "expect-type";
import { Greeting, type GreetingSignature } from "../src/index.ts";

expectTypeOf(Greeting).not.toBeAny();
expectTypeOf<GreetingSignature["Args"]>().toEqualTypeOf<{ name: string }>();
`,
      );

      let result = await run(project, "pnpm lint:type-tests");

      expect(result.exitCode, result.all).toBe(0);
    });

    it("build works", async () => {
      let result = await run(project, "pnpm build");

      expect(result.exitCode, result.all).toBe(0);
    });
  });
});
