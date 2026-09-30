import { describe, it, expect } from "vitest";
import { getLatest } from "#utils/npm.js";

describe("getLatest", () => {
  it("resolves a range where every version is deprecated", async () => {
    // ESLint deprecated all of 9.x once 10 was out
    const { eslint } = await getLatest({ eslint: "^9.39.2" });

    expect(eslint).toMatch(/^9\.39\.\d+$/);
  });

  it("still prefers versions that are not deprecated", async () => {
    const { eslint } = await getLatest({ eslint: "^10.0.0" });

    expect(eslint).toMatch(/^10\.\d+\.\d+$/);
  });

  it("keeps specs that do not come from the registry", async () => {
    const specs = {
      "@embroider/try": "github:NullVoxPopuli/try#768631a",
      "my-local": "file:../my-local",
      "my-linked": "link:../my-linked",
      "my-tarball": "https://example.com/my-tarball.tgz",
      "my-catalog": "catalog:",
    };

    expect(await getLatest(specs)).toEqual(specs);
  });
});
