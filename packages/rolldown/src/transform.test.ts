import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rolldown } from "rolldown";
import type { Plugin } from "rolldown";
import { describe, expect, it } from "vitest";

import { emberTransform } from "./transform.ts";

/**
 * Drives the plugin through a real rolldown build.
 *
 * `files` is a map of relative path -> source.
 * The build entry is `index.ts`.
 *
 * Every bare (package) specifier is marked external,
 * so the build only exercises the local `.gts` / `.gjs` / `.ts` handling
 * and doesn't need real dependencies installed.
 *
 * Returns the concatenated code of every emitted chunk.
 */
async function bundle(
  files: Record<string, string>,
  {
    input = ["index.ts"],
    plugins = () => [],
  }: { input?: string[]; plugins?: (dir: string) => Plugin[] } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ember-rolldown-build-"));

  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(dir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, source, "utf8");
  }

  const isLocal = (id: string) => id.startsWith(".") || id.startsWith("/") || path.isAbsolute(id);

  const build = await rolldown({
    input: input.map((relative) => path.join(dir, relative)),
    plugins: [emberTransform(), ...plugins(dir)],
    external: (id) => !isLocal(id),
    onwarn() {},
  });

  const { output } = await build.generate({ format: "es" });

  const code = output
    .filter((chunk): chunk is typeof chunk & { code: string } => "code" in chunk)
    .map((chunk) => chunk.code)
    .join("\n");

  // rolldown's `//#region <path>` comments reference the random temp dir.
  // Collapse them to the bare filename so snapshots stay deterministic.
  return code.replace(/(\/\/#region ).*\/([^/\n]+)$/gm, "$1$2");
}

/**
 * Builds `files` with sourcemaps (entry `index.ts`),
 * then follows each needle's first occurrence in the emitted code through the `.js.map`,
 * the way a debugger does.
 *
 * One line per needle: the source the map names, its 1-based line and 0-based column,
 * and the source text from that column on.
 */
async function traced(files: Record<string, string>, needles: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ember-rolldown-trace-"));

  for (const [relative, source] of Object.entries(files)) {
    await writeFile(path.join(dir, relative), source, "utf8");
  }

  const build = await rolldown({
    input: path.join(dir, "index.ts"),
    plugins: [emberTransform()],
    external: (id) => !(id.startsWith(".") || path.isAbsolute(id)),
    onwarn() {},
  });

  const { output } = await build.generate({ format: "es", sourcemap: true });
  const [chunk] = output;
  const lines = chunk.code.split("\n");
  const map = new TraceMap(chunk.map!.toString());

  return needles
    .map((needle) => {
      const line = lines.findIndex((text) => text.includes(needle));
      if (line === -1) throw new Error(`\`${needle}\` is not in the output:\n${chunk.code}`);

      const {
        source,
        line: sourceLine,
        column,
      } = originalPositionFor(map, {
        line: line + 1,
        column: lines[line]!.indexOf(needle),
      });

      if (!source || sourceLine === null || column === null) return `${needle} -> (unmapped)`;

      const file = path.basename(source);
      const text = files[file]?.split("\n")[sourceLine - 1]?.slice(column) ?? "(no such file)";

      return `${needle} -> ${file}:${sourceLine}:${column}  ${text}`;
    })
    .join("\n");
}

describe("emberTransform (full plugin via rolldown)", () => {
  it("compiles a .gts module's <template> and keeps bare imports external", async () => {
    const code = await bundle({
      "index.ts": `export { default as Foo } from './foo.gts';`,
      "foo.gts": [
        `import Component from '@glimmer/component';`,
        `export default class Foo extends Component {`,
        `  <template>Hello</template>`,
        `}`,
      ].join("\n"),
    });

    // <template> is gone, replaced by a content-tag `template(...)` call.
    expect(code).not.toContain("<template>");
    expect(code).toContain("template(");
    // The bare import survived as an external dependency.
    expect(code).toContain(`from "@glimmer/component"`);
    // ...and it pulls in the template-compiler runtime import.
    expect(code).toContain("@ember/template-compiler");

    expect(code).toMatchInlineSnapshot(`
      "import { template } from "@ember/template-compiler";
      import Component from "@glimmer/component";
      //#region foo.ts
      var Foo = class extends Component {
      	static {
      		template(\`Hello\`, {
      			component: this,
      			eval() {
      				return eval(arguments[0]);
      			}
      		});
      	}
      };
      //#endregion
      export { Foo };
      "
    `);
  });

  it("compiles .gjs alongside .gts and plain .ts in one graph", async () => {
    const code = await bundle({
      "index.ts": [
        `export { default as Foo } from './foo.gts';`,
        `export { greet } from './util.gjs';`,
        `export { helper } from './plain.ts';`,
      ].join("\n"),
      "foo.gts": `<template>Foo</template>`,
      "util.gjs": [
        `export function greet() { return 'hi'; }`,
        `<template>{{greet}}</template>`,
      ].join("\n"),
      "plain.ts": `export function helper() { return 1; }`,
    });

    expect(code).not.toContain("<template>");
    expect(code).toContain("function greet()");
    expect(code).toContain("function helper()");
    expect(code).toContain("export {");

    expect(code).toMatchInlineSnapshot(`
      "import { template } from "@ember/template-compiler";
      //#region foo.ts
      var foo_default = template(\`Foo\`, { eval() {
      	return eval(arguments[0]);
      } });
      //#endregion
      //#region util.js
      function greet() {
      	return "hi";
      }
      var util_default = template(\`{{greet}}\`, { eval() {
      	return eval(arguments[0]);
      } });
      //#endregion
      //#region plain.ts
      function helper() {
      	return 1;
      }
      //#endregion
      export { foo_default as Foo, greet, helper };
      "
    `);
  });

  it("resolves a .gts module that imports another .gts relatively", async () => {
    const code = await bundle({
      "index.ts": `export { default as Page } from './page.gts';`,
      "page.gts": [
        `import Widget from './widget.gts';`,
        `export default class Page {`,
        `  Widget = Widget;`,
        `  <template><Widget /></template>`,
        `}`,
      ].join("\n"),
      "widget.gts": `<template>widget</template>`,
    });

    // Both templates compiled, and the relative .gts import resolved (bundled).
    expect(code).not.toContain("<template>");
    expect(code).not.toContain(".gts");
    expect(code).toContain("template(");

    expect(code).toMatchInlineSnapshot(`
      "import { template } from "@ember/template-compiler";
      //#region widget.ts
      var widget_default = template(\`widget\`, { eval() {
      	return eval(arguments[0]);
      } });
      //#endregion
      //#region page.ts
      var Page = class {
      	Widget = widget_default;
      	static {
      		template(\`<Widget />\`, {
      			component: this,
      			eval() {
      				return eval(arguments[0]);
      			}
      		});
      	}
      };
      //#endregion
      export { Page };
      "
    `);
  });

  it("resolves an absolute .gts specifier imported from a plugin's virtual module", async () => {
    /**
     * The shape a code-generating plugin emits:
     * a virtual module (id prefixed with `\0`, so it exists nowhere on disk)
     * whose generated source imports real files by absolute path,
     * because it has no directory to be relative to.
     *
     * `path.dirname` of such an id is `"\0."`,
     * so the specifier must not be resolved against the importer's directory.
     */
    const registry = (dir: string): Plugin[] => {
      const source = "./registry?virtual=views";
      const virtualId = `\0${source}`;

      return [
        {
          name: "test:virtual-registry",
          resolveId(id) {
            return id === source ? virtualId : null;
          },
          load(id) {
            if (id !== virtualId) return null;

            return [
              `import example from '${path.join(dir, "components/view/example.gts")}';`,
              `export const views = { example };`,
            ].join("\n");
          },
        },
      ];
    };

    const code = await bundle(
      {
        "index.ts": `export { views } from './registry?virtual=views';`,
        "components/view/example.gts": `<template>example</template>`,
      },
      { plugins: registry },
    );

    // The absolutely-specified .gts got compiled and bundled in.
    expect(code).not.toContain("<template>");
    expect(code).toContain("template(");
    expect(code).toContain("example");
  });

  it("compiles a .gts module used directly as an entry (no importer)", async () => {
    const code = await bundle(
      {
        // Both an entry .gts and a .ts entry importing it.
        //
        // The shared module must resolve to ONE id
        // (the entry resolution realpaths, matching rolldown's own resolver),
        // so it lands in the entry chunk and the index chunk imports it,
        // rather than duplicating the code.
        "index.ts": `export { default as Foo } from './foo.gts';`,
        "foo.gts": [
          `import Component from '@glimmer/component';`,
          `export default class Foo extends Component {`,
          `  <template>Entry</template>`,
          `}`,
        ].join("\n"),
      },
      { input: ["index.ts", "foo.gts"] },
    );

    expect(code).not.toContain("<template>");
    expect(code).toContain("template(");
    expect(code).toContain(`from "@glimmer/component"`);
    // deduplicated: the class body appears exactly once, in foo's own chunk
    expect(code.match(/extends Component/g)).toHaveLength(1);
    expect(code).toContain(`from "./foo.js"`);

    expect(code).toMatchInlineSnapshot(`
      "import { template } from "@ember/template-compiler";
      import Component from "@glimmer/component";
      //#region foo.ts
      var Foo = class extends Component {
      	static {
      		template(\`Entry\`, {
      			component: this,
      			eval() {
      				return eval(arguments[0]);
      			}
      		});
      	}
      };
      //#endregion
      export { Foo as default };

      import Foo from "./foo.js";
      export { Foo };
      "
    `);
  });

  it("emits sourcemaps for the specifier rewrite (no SOURCEMAP_BROKEN warnings)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ember-rolldown-map-"));

    const files = {
      // index.ts contains a `.gts` specifier, so it goes through the rewrite.
      "index.ts": `export { default as Foo } from './foo.gts';`,
      "foo.gts": `<template>Foo</template>`,
    };

    for (const [relative, source] of Object.entries(files)) {
      await writeFile(path.join(dir, relative), source, "utf8");
    }

    const warnings: string[] = [];
    const build = await rolldown({
      input: path.join(dir, "index.ts"),
      plugins: [emberTransform()],
      external: (id) => !(id.startsWith(".") || path.isAbsolute(id)),
      onwarn(warning) {
        warnings.push(warning.code ?? String(warning));
      },
    });

    const { output } = await build.generate({ format: "es", sourcemap: true });

    expect(warnings.filter((code) => code === "SOURCEMAP_BROKEN")).toEqual([]);

    const chunk = output.find((entry) => entry.type === "chunk" && "map" in entry);
    expect(chunk).toBeDefined();
    // The composed map traces through the rewrite back to the original .gts source.
    // (content-tag's map survives the specifier-rewrite pass)
    const sources = (chunk as { map?: { sources: string[] } }).map?.sources ?? [];
    expect(sources.some((source) => source.endsWith("foo.gts"))).toBe(true);
  });

  it("names the .gts file in the map of a .gts with no <template>", async () => {
    // content-tag doesn't run on such a module, so it has no map from content-tag.
    // It still loads under the virtual .ts id, which is not a file on disk.
    // helpers.gts also goes through the specifier rewrite, and plain.gts doesn't.
    const dir = await mkdtemp(path.join(tmpdir(), "ember-rolldown-map-"));

    const files = {
      "index.ts": [
        `export { double } from './helpers.gts';`,
        `export { half } from './plain.gts';`,
      ].join("\n"),
      "helpers.gts": [
        `import { half } from './plain.gts';`,
        `export function double(value: number): number {`,
        `  return half(value) * 4;`,
        `}`,
      ].join("\n"),
      "plain.gts": `export function half(value: number): number {\n  return value / 2;\n}`,
    };

    for (const [relative, source] of Object.entries(files)) {
      await writeFile(path.join(dir, relative), source, "utf8");
    }

    const build = await rolldown({
      input: path.join(dir, "index.ts"),
      plugins: [emberTransform()],
      onwarn() {},
    });

    const { output } = await build.generate({ format: "es", sourcemap: true });
    const [chunk] = output;

    // index.ts only re-exports, so it contributes no code and no source.
    const sources = chunk.map!.sources.map((source) => path.basename(source)).sort();
    expect(sources).toEqual(["helpers.gts", "plain.gts"]);
  });

  it("maps a rewritten .gts module to its exact source lines and columns", async () => {
    // content-tag reprints the module.
    // A doc comment's closing `*/` and the declaration after it share one line of its output.
    //
    // widget.gts imports another .gts, so the specifier rewrite runs on that output.
    // Its map must keep every column,
    // or the declaration resolves to the `*/` on the line above it.
    const result = await traced(
      {
        "index.ts": `export { Widget } from './widget.ts';`,
        "widget.gts": [
          `import { helper } from './other.gts';`,
          ``,
          `/**`,
          ` * A widget.`,
          ` */`,
          `export class Widget {`,
          `  /**`,
          `   * The name.`,
          `   */`,
          `  get name(): string {`,
          `    return helper();`,
          `  }`,
          ``,
          `  <template>Hello {{this.name}}</template>`,
          `}`,
        ].join("\n"),
        "other.gts": [`export function helper(): string {`, `  return 'x';`, `}`].join("\n"),
      },
      ["Widget = class", "name()", "return helper"],
    );

    expect(result).toMatchInlineSnapshot(`
      "Widget = class -> widget.gts:6:13  Widget {
      name() -> widget.gts:10:6  name(): string {
      return helper -> widget.gts:11:4  return helper();"
    `);
  });

  it("keeps columns in a plain .ts module that imports a .gts", async () => {
    const result = await traced(
      {
        "index.ts": [
          `import { helper } from './other.gts';`,
          ``,
          `export function greet(name: string): string {`,
          `  return helper() + name;`,
          `}`,
        ].join("\n"),
        "other.gts": [`export function helper(): string {`, `  return 'x';`, `}`].join("\n"),
      },
      ["greet", "return helper"],
    );

    expect(result).toMatchInlineSnapshot(`
      "greet -> index.ts:3:16  greet(name: string): string {
      return helper -> index.ts:4:2  return helper() + name;"
    `);
  });

  it("maps .gts modules that the specifier rewrite does not touch", async () => {
    // other.gts has no <template>, and widget.gts imports no .gts.
    // Neither goes through the rewrite, so these maps come from content-tag alone.
    const result = await traced(
      {
        "index.ts": [
          `export { helper } from './other.ts';`,
          `export { Widget } from './widget.ts';`,
        ].join("\n"),
        "widget.gts": [
          `import { helper } from './other.ts';`,
          ``,
          `/**`,
          ` * A widget.`,
          ` */`,
          `export class Widget {`,
          `  get name(): string {`,
          `    return helper();`,
          `  }`,
          ``,
          `  <template>Hello {{this.name}}</template>`,
          `}`,
        ].join("\n"),
        "other.gts": [`export function helper(): string {`, `  return 'x';`, `}`].join("\n"),
      },
      ["helper() {", `return "x"`, "Widget = class", "name()", "return helper"],
    );

    expect(result).toMatchInlineSnapshot(`
      "helper() { -> other.gts:1:16  helper(): string {
      return "x" -> other.gts:2:2  return 'x';
      Widget = class -> widget.gts:6:13  Widget {
      name() -> widget.gts:7:6  name(): string {
      return helper -> widget.gts:8:4  return helper();"
    `);
  });
});
