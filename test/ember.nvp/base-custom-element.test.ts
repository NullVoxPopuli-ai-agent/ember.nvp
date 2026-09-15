import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { generate, listFiles } from "#test-helpers";
import { tagNameFor } from "#bases/minimal-custom-element";
import { execa } from "execa";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Project } from "ember.nvp";

/**
 * The minimal-custom-element base ships a working pattern (a counter
 * component wrapped in a custom element), so unlike the library base
 * there is no example source to write in: these tests build the
 * generated project as-is, and run the element in a real browser through
 * the vitest layer.
 */

async function install(project: Project) {
  let result = await execa("pnpm install", { cwd: project.directory, shell: true });
  expect(result.exitCode).toBe(0);
}

async function build(project: Project) {
  let result = await execa("pnpm build", { cwd: project.directory, shell: true });
  expect(result.exitCode).toBe(0);
}

async function emit(project: Project, files: Record<string, string>) {
  for (let [path, contents] of Object.entries(files)) {
    let filePath = join(project.directory, path);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
}

/**
 * Drives the generated element the way a consumer would: import the
 * register entry, put the tag on the page, click, change attributes.
 */
function elementTests(ext: "ts" | "js", tagName: string) {
  return {
    [`tests/element-test.${ext}`]: `import { describe, test, expect, afterEach } from "vitest";
import { renderSettled } from "@ember/renderer";

import "../src/register.${ext}";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(attributes${ext === "ts" ? ": Record<string, string>" : ""} = {}) {
  let element = document.createElement("${tagName}");

  for (let [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  document.body.appendChild(element);

  return element;
}

describe("<${tagName}>", () => {
  test("renders the counter with default args", async () => {
    let element = mount();

    await renderSettled();

    expect(element.querySelector(".label")?.textContent).toBe("Count");
    expect(element.querySelector("output")?.textContent).toBe("0");
    expect(element.querySelector("button")?.textContent).toBe("+1");
  });

  test("counts clicks", async () => {
    let element = mount();

    await renderSettled();

    element.querySelector("button")?.click();
    await renderSettled();
    element.querySelector("button")?.click();
    await renderSettled();

    expect(element.querySelector("output")?.textContent).toBe("2");
  });

  test("passes initial attributes as args", async () => {
    let element = mount({ label: "Clicks", step: "5" });

    await renderSettled();

    expect(element.querySelector(".label")?.textContent).toBe("Clicks");
    expect(element.querySelector("button")?.textContent).toBe("+5");

    element.querySelector("button")?.click();
    await renderSettled();

    expect(element.querySelector("output")?.textContent).toBe("5");
  });

  test("re-renders when attributes change", async () => {
    let element = mount();

    await renderSettled();

    element.setAttribute("label", "Taps");
    element.setAttribute("step", "3");
    await renderSettled();

    expect(element.querySelector(".label")?.textContent).toBe("Taps");
    expect(element.querySelector("button")?.textContent).toBe("+3");

    element.querySelector("button")?.click();
    await renderSettled();

    expect(element.querySelector("output")?.textContent).toBe("3");
  });

  test("renders again after being moved", async () => {
    let element = mount();

    await renderSettled();

    element.querySelector("button")?.click();
    await renderSettled();

    element.remove();
    document.body.appendChild(element);
    await renderSettled();

    expect(element.querySelector("output")?.textContent).toBe("0");
  });
});
`,
  };
}

describe("base: minimal-custom-element", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    if (process.env.CI) return;

    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  describe("tag name", () => {
    it("is the package name", () => {
      expect(tagNameFor("my-counter")).toBe("my-counter");
    });

    it("drops the scope", () => {
      expect(tagNameFor("@acme/my-counter")).toBe("my-counter");
    });

    it("gets a suffix when the name has no hyphen", () => {
      expect(tagNameFor("counter")).toBe("counter-element");
      expect(tagNameFor("@acme/counter")).toBe("counter-element");
    });
  });

  describe("JavaScript", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({ type: "custom-element", name: "my-counter", layers: [] });
      dirs.push(project.directory);
    });

    it("generates the expected files", async () => {
      expect(await listFiles(project.directory)).toMatchInlineSnapshot(`
        [
          ".gitignore",
          "README.md",
          "package.json",
          "src/components/counter.gjs",
          "src/element.js",
          "src/index.js",
          "src/register.js",
          "tsdown.config.js",
        ]
      `);
    });

    it("registers the tag under the project name", async () => {
      expect(await project.read("src/register.js")).toMatchInlineSnapshot(`
        "import { CounterElement } from "./index.js";
        if (!customElements.get('my-counter')) {
          customElements.define('my-counter', CounterElement);
        }"
      `);
      expect(await project.read("README.md")).toContain("<my-counter label=");
    });

    it("exports the element and the component", async () => {
      expect(await project.read("src/index.js")).toMatchInlineSnapshot(`
        "export { CounterElement } from "./element.js";
        export { default as Counter } from "./components/counter.gjs";"
      `);
    });

    it("is publishable", async () => {
      let manifest = JSON.parse((await project.read("package.json"))!);

      expect(manifest).not.toHaveProperty("private");
      expect(manifest.exports["./register"]).toEqual({ default: "./dist/register.js" });
    });

    it("has no TypeScript leftovers", async () => {
      let manifest = JSON.parse((await project.read("package.json"))!);

      expect(manifest.devDependencies).not.toHaveProperty("typescript");
      expect(manifest.devDependencies).not.toHaveProperty("@ember/library-tsconfig");
      expect(JSON.stringify(manifest.exports)).not.toContain("types");

      expect(await project.read("tsdown.config.js")).toMatchInlineSnapshot(`
        "import { defineConfig } from "tsdown";
        import { ember } from "@nullvoxpopuli/ember-rolldown";

        export default defineConfig({
          entry: ["./src/index.js", "./src/register.js"],
          dts: false,
          unbundle: true,
          plugins: [ember()],
        });
        "
      `);
    });

    it("builds both entries", async () => {
      await install(project);
      await build(project);

      expect(await listFiles(join(project.directory, "dist"))).toMatchInlineSnapshot(`
        [
          "components/counter.js",
          "components/counter.js.map",
          "element.js",
          "element.js.map",
          "index.js",
          "register.js",
          "register.js.map",
        ]
      `);

      // The register entry shares the element with the index entry
      // instead of bundling its own copy
      expect(await project.read("dist/register.js")).toMatchInlineSnapshot(`
        "import { CounterElement } from "./element.js";
        import "./index.js";
        //#region src/register.js
        if (!customElements.get("my-counter")) customElements.define("my-counter", CounterElement);
        //#endregion
        export {};

        //# sourceMappingURL=register.js.map"
      `);

      let component = await project.read("dist/components/counter.js");

      // Published libraries ship precompileTemplate (the consuming app does
      // the final compile), never wire format
      expect(component).toContain("precompileTemplate");
      expect(component).not.toContain("createTemplateFactory");

      expect(await project.read("dist/element.js")).toContain('from "@ember/renderer"');
    });
  });

  describe("TypeScript", () => {
    let project: Project;

    beforeAll(async () => {
      project = await generate({ type: "custom-element", name: "counter", layers: ["typescript"] });
      dirs.push(project.directory);
    });

    it("generates the expected files", async () => {
      expect(await listFiles(project.directory)).toMatchInlineSnapshot(`
        [
          ".gitignore",
          "README.md",
          "package.json",
          "src/components/counter.gts",
          "src/element.ts",
          "src/index.ts",
          "src/register.ts",
          "tsconfig.json",
          "tsdown.config.js",
        ]
      `);
    });

    it("registers the tag with a suffix when the name has no hyphen", async () => {
      expect(await project.read("src/register.ts")).toMatchInlineSnapshot(`
        "import { CounterElement } from "./index.ts";

        if (!customElements.get("counter-element")) {
          customElements.define("counter-element", CounterElement);
        }
        "
      `);
    });

    it("type checks", async () => {
      await install(project);

      let types = await execa("pnpm lint:types", { cwd: project.directory, shell: true });
      expect(types.exitCode).toBe(0);
    });

    it("builds, including declarations", async () => {
      await build(project);

      expect(await listFiles(join(project.directory, "dist"))).toMatchInlineSnapshot(`
        [
          "components/counter.d.ts",
          "components/counter.d.ts.map",
          "components/counter.js",
          "components/counter.js.map",
          "element.d.ts",
          "element.d.ts.map",
          "element.js",
          "element.js.map",
          "index.d.ts",
          "index.js",
          "register.d.ts",
          "register.js",
          "register.js.map",
        ]
      `);

      expect(await project.read("dist/index.d.ts")).toMatchInlineSnapshot(`
        "import { CounterElement } from "./element.js";
        import Counter, { CounterSignature } from "./components/counter.js";
        export { Counter, CounterElement, type CounterSignature };"
      `);
      expect(await project.read("dist/register.d.ts")).toMatchInlineSnapshot(`"export {}"`);
    });
  });

  describe("in a browser (vitest layer)", () => {
    describe("TypeScript", () => {
      let project: Project;

      beforeAll(async () => {
        project = await generate({
          type: "custom-element",
          name: "my-counter",
          layers: ["typescript", "vitest"],
        });
        dirs.push(project.directory);
      });

      it("renders, counts, and reacts to attributes", { timeout: 300_000 }, async () => {
        await emit(project, elementTests("ts", "my-counter"));
        await install(project);

        let test = await execa("pnpm test", { cwd: project.directory, shell: true });
        expect(test.exitCode).toBe(0);
      });
    });

    describe("JavaScript", () => {
      let project: Project;

      beforeAll(async () => {
        project = await generate({
          type: "custom-element",
          name: "my-counter",
          layers: ["vitest"],
        });
        dirs.push(project.directory);
      });

      it("renders, counts, and reacts to attributes", { timeout: 300_000 }, async () => {
        await emit(project, elementTests("js", "my-counter"));
        await install(project);

        let test = await execa("pnpm test", { cwd: project.directory, shell: true });
        expect(test.exitCode).toBe(0);
      });
    });
  });
});
