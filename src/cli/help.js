import { styleText } from "node:util";

/**
 * Print help text to stdout.
 *
 * @param {Record<string, any>} coreOptions
 */
export function printHelp(coreOptions) {
  const title = styleText(["bgCyan", "black"], " ember.nvp ");
  console.log(`${title}\n`);
  console.log(`${styleText("bold", "Usage:")} npx ember.nvp [options]\n`);

  console.log(styleText("bold", "Core Options:"));
  for (const [name, config] of Object.entries(coreOptions)) {
    const flag = `--${name}`;
    const alias = config.short ? `-${config.short}, ` : "    ";
    const typeStr = config.type ? styleText("dim", `<${config.type}>`) : "";
    const desc = config.description || "";
    const choices = config.choices
      ? styleText(
          "yellow",
          ` [choices: ${config.choices.map((/** @type {string} */ c) => `"${c}"`).join(", ")}]`,
        )
      : "";

    console.log(`  ${alias}${styleText("cyan", flag)} ${typeStr}`);
    if (desc || choices) {
      console.log(`      ${desc}${choices}`);
    }
    console.log("");
  }
}
