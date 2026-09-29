import remapping, { type EncodedSourceMap } from "@jridgewell/remapping";
import { Preprocessor } from "content-tag";
import MagicString from "magic-string";
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "rolldown";

const processor = new Preprocessor();

/**
 * `.d.ts` files emitted for `.gts` source reference the original `.gts` specifiers.
 *
 * Consumers can't resolve those,
 * so we rewrite them back to extension-less specifiers.
 */
function fixDeclarationImports(content: string): string {
  return content
    .replace(/from\s+'([^']+)\.gts'/g, "from '$1'")
    .replace(/from\s+"([^"]+)\.gts"/g, 'from "$1"')
    .replace(/import\("([^"]+)\.gts"\)/g, 'import("$1")')
    .replace(/import\('([^']+)\.gts'\)/g, "import('$1')");
}

async function fixDtsExtensionsInDir(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await fixDtsExtensionsInDir(fullPath);
    } else if (entry.name.endsWith(".d.ts")) {
      const content = await readFile(fullPath, { encoding: "utf8" });
      const fixed = fixDeclarationImports(content);

      if (fixed !== content) {
        await writeFile(fullPath, fixed);
      }
    }
  }
}

/**
 * The `.gts` / `.gjs` file behind a virtual `.ts` / `.js` id,
 * and content-tag's map back to it (absent when there was no `<template>` to compile).
 */
interface Backing {
  fileName: string;
  map?: string;
}

/**
 * Points a declaration map at the `.gts` / `.gjs` files behind its virtual sources.
 *
 * rolldown-plugin-dts generates declarations from the loaded module (content-tag's output).
 * So its maps name:
 * - the virtual id, a file that does not exist
 * - content-tag's line numbers, which do not match the source
 *
 * Tracing through content-tag's map gives the file and line
 * that a consumer's "go to definition" can open.
 *
 * Returns `undefined` when no source is virtual.
 */
function remapDeclarationMap(
  json: string,
  mapDir: string,
  backings: Map<string, Backing>,
): string | undefined {
  const map = JSON.parse(json) as EncodedSourceMap;

  if (!map.sources.some((source) => source && backings.has(path.resolve(mapDir, source)))) {
    return undefined;
  }

  const remapped = remapping(
    map,
    (source, context) => {
      // Only the declaration map's own sources can be virtual.
      if (context.depth > 1) return null;

      const backing = backings.get(path.resolve(mapDir, source));
      if (!backing) return null;

      context.source = backing.fileName;
      return backing.map ?? null;
    },
    // Like the rest of the declaration map, point at the published sources.
    // Do not embed them.
    { excludeContent: true },
  );

  // Backing files come back absolute.
  // The other sources are relative to the map's directory.
  remapped.sources = remapped.sources.map((source) =>
    source && path.isAbsolute(source)
      ? path.relative(mapDir, source).split(path.sep).join("/")
      : source,
  );

  return remapped.toString();
}

/**
 * Preprocesses `<template>` via content-tag, and maps
 *   `.gts` → `.ts`
 *   `.gjs` → `.js`
 * so rolldown can identify them as ts / js.
 */
export function emberTransform(): Plugin {
  // virtual id -> what it was loaded from
  const backings = new Map<string, Backing>();

  return {
    name: "ember:transform",

    resolveId: {
      order: "pre",
      handler(id, importer) {
        // Entries have no importer.
        // Their ids come straight from the build config
        // (tsdown expands entry globs to on-disk paths).
        //
        // Resolve a `.gts` / `.gjs` entry to the same virtual `.ts` / `.js` id
        // an imported module gets, so the load hook compiles it via content-tag
        // instead of the raw `<template>` source hitting the parser.
        //
        // Entries may be any extension.
        // The emitted `.js` / `.d.ts` paths mirror the entry paths either way
        // (that's how tsdown's dts support works).
        if (!importer) {
          if (!id.endsWith(".gts") && !id.endsWith(".gjs")) return null;
          if (!existsSync(id)) return null;

          // rolldown's default resolver realpaths entry ids
          // (e.g. macOS /var -> /private/var).
          //
          // Match it, or this same file imported from another entry
          // resolves to a second module id and gets duplicated into both chunks.
          const fileName = realpathSync(path.resolve(id));

          return {
            id: fileName.replace(/\.gts$/, ".ts").replace(/\.gjs$/, ".js"),
            meta: { fileName },
          };
        }

        // An absolute specifier already names the file,
        // so it needs no importer-relative resolution.
        // Joining it onto the importer's directory would corrupt it.
        //
        // That is not hypothetical.
        // A plugin's virtual module (id prefixed with `\0`)
        // can generate imports of on-disk files by absolute path,
        // and `path.dirname("\0./registry")` is `"\0."`.
        // Joining then yields `"\0./Users/.../thing.gts"`:
        // a path no `existsSync` / `readFile` can accept (it has a null byte in it).
        const fileName = path.isAbsolute(id) ? id : path.join(path.dirname(importer), id);

        if (id.endsWith(".gts")) {
          return {
            id: fileName.replace(/\.gts$/, ".ts"),
            meta: { fileName },
          };
        }

        if (id.endsWith(".gjs")) {
          return {
            id: fileName.replace(/\.gjs$/, ".js"),
            meta: { fileName },
          };
        }

        // A `.ts` / `.js` specifier whose only backing file is a `.gts` / `.gjs`
        // resolves to the virtual module.
        //
        // This must also serve `.d.ts` importers.
        // rolldown-plugin-dts resolves a declaration module's imports
        // through the plugin pipeline (`this.resolve`).
        // When the resolution is a source file, it loads it (registering its declaration)
        // before mapping the import to the declaration id.
        //
        // Virtual modules exist nowhere else.
        // If we don't answer here, the import either:
        // - fails to resolve (no file on disk)
        // - or, worse, resolves to a declaration id that was never registered
        if (id.endsWith(".ts")) {
          const gtsFileName = fileName.replace(/\.ts$/, ".gts");
          if (existsSync(gtsFileName) && !existsSync(fileName)) {
            return { id: fileName, meta: { fileName: gtsFileName } };
          }
        }

        if (id.endsWith(".js")) {
          const gjsFileName = fileName.replace(/\.js$/, ".gjs");
          if (existsSync(gjsFileName) && !existsSync(fileName)) {
            return { id: fileName, meta: { fileName: gjsFileName } };
          }
        }

        return null;
      },
    },

    load: {
      order: "pre",
      filter: {
        id: /\.(ts|js)$/,
      },
      async handler(id) {
        const meta = this.getModuleInfo(id)?.meta ?? {};
        let fileName = meta?.fileName;

        // A virtual id can be loaded without having passed through our resolveId
        // (rolldown-plugin-dts calls `this.load({ id })` with just the id),
        // so no meta is attached.
        //
        // Recover the backing file from disk.
        if (!fileName && !existsSync(id)) {
          if (id.endsWith(".ts") && existsSync(id.replace(/\.ts$/, ".gts"))) {
            fileName = id.replace(/\.ts$/, ".gts");
          } else if (id.endsWith(".js") && existsSync(id.replace(/\.js$/, ".gjs"))) {
            fileName = id.replace(/\.js$/, ".gjs");
          }
        }

        if (fileName) {
          this.addWatchFile(fileName);
          const source = await readFile(fileName, { encoding: "utf8" });

          if (source.includes("<template>")) {
            const { code, map } = processor.process(source, {
              filename: fileName,
            });
            backings.set(id, { fileName, map });
            return { code, map };
          }

          // No map here would attribute the code to the virtual id,
          // a file that does not exist.
          // An identity map names the real file instead.
          // It needs a segment for every column (`hires`), like the specifier rewrite's.
          //
          // The backing gets no map: declaration lines already match the source.
          backings.set(id, { fileName });
          return {
            code: source,
            map: new MagicString(source).generateMap({
              source: fileName,
              includeContent: true,
              hires: true,
            }),
          };
        }

        return null;
      },
    },

    transform: {
      order: "pre",
      filter: {
        code: /\.gts/,
        id: /\.(js|ts)$/,
      },
      handler(input, id) {
        // Rewrite `.gts` specifiers to `.ts`, the (virtual) source id,
        // in runtime modules AND declaration modules alike.
        //
        // Declaration modules must NOT be rewritten to `.d.ts`.
        // rolldown-plugin-dts's resolver treats a source-file resolution as
        // "load it (registering its declaration), then map to the declaration id".
        // A `.d.ts` id is returned as-is: unloadable when the module isn't registered yet
        // (e.g. the `.gts` is only ever type-imported).
        const output = new MagicString(input);

        for (const match of input.matchAll(
          /(['"`])((?:\.\.?\/|\/|@|[A-Za-z0-9_\-])[^'"]*?\.gts)\1/g,
        )) {
          // `.gts` ends the specifier, just before the closing quote.
          const end = match.index + match[0].length - 1;
          output.overwrite(end - ".gts".length, end, ".ts");
        }

        if (!output.hasChanged()) {
          return null;
        }

        // rolldown traces each output position back through this map
        // (then through content-tag's, for a .gts module).
        // A position between two segments resolves to the one before it,
        // so this map needs a segment for every column (`hires`).
        //
        // With one segment per line, every position resolves to the start of its line.
        // In content-tag's output, that is often a doc comment's `*/`
        // rather than the declaration after it on the same line.
        return {
          code: output.toString(),
          map: output.generateMap({ source: id, includeContent: true, hires: true }),
        };
      },
    },

    generateBundle(options, bundle) {
      const outDir = options.dir ?? (options.file && path.dirname(options.file));
      if (!outDir || backings.size === 0) return;

      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".d.ts.map")) continue;
        if (typeof output.source !== "string") continue;

        const mapDir = path.dirname(path.resolve(outDir, output.fileName));
        const remapped = remapDeclarationMap(output.source, mapDir, backings);

        if (remapped) output.source = remapped;
      }
    },

    writeBundle: {
      async handler(options) {
        const outDir = (options as { dir?: string }).dir;
        if (outDir) {
          await fixDtsExtensionsInDir(path.resolve(outDir));
        }
      },
    },
  };
}
