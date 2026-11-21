import { buildMacros } from "@embroider/macros/babel";

const macros = buildMacros({
  configure(config) {
    if (process.env.EMBER_ENV === "test") {
      config.enableRuntimeMode();
      /**
       * Addons check `isTesting()` when their modules load, before tests/test-helper calls `setTesting(true)`.
       */
      config.setGlobalConfig(import.meta.filename, "@embroider/macros", { isTesting: true });
    }
  },
});

export default {
  plugins: [
    [
      "@babel/plugin-transform-typescript",
      {
        allExtensions: true,
        onlyRemoveTypeImports: true,
        allowDeclareFields: true,
      },
    ],
    [
      "babel-plugin-ember-template-compilation",
      {
        transforms: [...macros.templateMacros],
      },
    ],
    [
      "module:decorator-transforms",
      {
        runtime: {
          import: import.meta.resolve("decorator-transforms/runtime-esm"),
        },
      },
    ],
    ...macros.babelMacros,
  ],

  generatorOpts: {
    compact: false,
  },
};
