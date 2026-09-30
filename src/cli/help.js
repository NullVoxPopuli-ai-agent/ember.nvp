import { styleText } from "node:util";

/**
 * CLI flags only carry strings and booleans
 *
 * @type {Record<import('#types').LayerOptionType, string>}
 */
const FLAG_TYPES = {
  text: "string",
  number: "number",
  confirm: "boolean",
  select: "string",
  multiselect: "string",
};

/**
 * Print help text to stdout.
 *
 * @param {Record<string, any>} coreOptions
 * @param {import('#types').DiscoveredLayer[]} [layers]
 */
export function printHelp(coreOptions, layers = []) {
  const title = styleText(["bgCyan", "black"], " ember.nvp ");
  console.log(`${title}\n`);
  console.log(`${styleText("bold", "Usage:")} npx ember.nvp [options]\n`);

  console.log(styleText("bold", "Core Options:"));
  for (const [name, config] of Object.entries(coreOptions)) {
    printOption({
      flag: `--${name}`,
      alias: config.short ? `-${config.short}, ` : "    ",
      type: config.type,
      multiple: config.multiple,
      description: config.description,
      choices: config.choices,
    });
  }

  const withOptions = layers.filter((layer) => layer.options);

  if (withOptions.length === 0) return;

  console.log(styleText("bold", "Layer Options:"));
  for (const layer of withOptions) {
    console.log(`  Layer: ${styleText(["cyan", "bold"], layer.name)}`);
    for (const [key, schema] of Object.entries(layer.options ?? {})) {
      const name = `${layer.name}.${key}`;

      printOption({
        flag: schema.type === "confirm" ? `--[no-]${name}` : `--${name}`,
        alias: "    ",
        type: FLAG_TYPES[schema.type],
        multiple: schema.type === "multiselect",
        description: schema.prompt,
        choices: schema.options?.map((choice) => choice.value),
        fallback: schema.default,
      });
    }
  }
}

/**
 * @param {{
 *   flag: string,
 *   alias: string,
 *   type?: string,
 *   multiple?: boolean,
 *   description?: string,
 *   choices?: string[],
 *   fallback?: unknown,
 * }} option
 */
function printOption({ flag, alias, type, multiple, description = "", choices, fallback }) {
  const typeStr = type ? styleText("dim", `<${type}>`) : "";
  const repeatStr = multiple
    ? type
      ? ` ${styleText("dim", "[")}${styleText("cyan", flag)} ${typeStr}${styleText("dim", " ...]")}`
      : ` ${styleText("dim", "[")}${styleText("cyan", flag)}${styleText("dim", " ...]")}`
    : "";
  const flagAndType = [styleText("cyan", flag), typeStr].filter(Boolean).join(" ");
  const choicesStr = choices
    ? styleText("yellow", ` [choices: ${choices.map((c) => `"${c}"`).join(", ")}]`)
    : "";
  const fallbackStr =
    fallback === undefined ? "" : styleText("dim", ` [default: ${JSON.stringify(fallback)}]`);

  console.log(`  ${styleText("cyan", alias)}${flagAndType}${repeatStr}`);
  if (description || choicesStr || fallbackStr) {
    console.log(`      ${description}${choicesStr}${fallbackStr}`);
  }
  console.log("");
}
