import { extensions } from "@embroider/vite";
import type { ConfigEnv, ConfigPluginContext } from "vite";
import { describe, expect, it } from "vitest";

import { ember } from "./ember.ts";

const ROLLDOWN = { meta: { rolldownVersion: "1.0.0" } } as ConfigPluginContext;

async function configure(env: ConfigEnv) {
  const config: any = {};
  const [plugin] = ember();

  // @ts-expect-error the first entry is the config plugin
  await plugin.config.call(ROLLDOWN, config, env);

  return config;
}

describe("ember", () => {
  /**
   * These values come from the config hook of `@embroider/vite`.
   * They are missing when that hook does not run.
   */
  it("applies the config from @embroider/vite", async () => {
    const config = await configure({ command: "build", mode: "production" });

    expect(config.resolve.extensions).toEqual(extensions);
    expect(config.server.port).toBe(4200);
    expect(config.optimizeDeps.exclude).toContain("@embroider/macros");
  });

  it("gives @embroider/vite the plugin context, so that it configures rolldown", async () => {
    const config = await configure({ command: "build", mode: "production" });

    expect(config.build.rolldownOptions.moduleTypes).toEqual({ ".ts": "js" });
    expect(config.optimizeDeps.rolldownOptions.resolve.extensions).toEqual(extensions);
  });
});
