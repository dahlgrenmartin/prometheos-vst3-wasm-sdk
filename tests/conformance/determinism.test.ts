import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadFixturePackage } from "./fixture_package_harness.js";
import { rebuildFixturePackage } from "./fixture_build_harness.js";

const packagePath = new URL("../../build/packages/prometheos-fixtures.webvst", import.meta.url);

describe("fixture package determinism", () => {
  it("retains a package build SHA before rebuilding the CMake target", { timeout: 15_000 }, async () => {
    const first = new Uint8Array(await readFile(packagePath));
    const firstSha256 = createHash("sha256").update(first).digest("hex");
    await rebuildFixturePackage();
    const second = new Uint8Array(await readFile(packagePath));
    const fixture = await loadFixturePackage(second);
    expect(createHash("sha256").update(second).digest("hex")).toBe(firstSha256);
    expect(second).toEqual(first);
    expect(fixture.archiveSha256).toBe(firstSha256);
    expect(fixture.entries).toEqual(["plugin.json", "plugin.wasm"]);
  });
});
