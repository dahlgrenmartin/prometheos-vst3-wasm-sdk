import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALLOWED_WASM_IMPORTS } from "./package_consumer.js";
import { loadFixturePackage } from "./fixture_package_harness.js";

const packagePath = new URL("../../build/packages/webvst-fixtures.webvst", import.meta.url);

describe("fixture WASM imports", () => {
  it("uses only the documented AudioWorklet-compatible imports", async () => {
    const fixture = await loadFixturePackage(new Uint8Array(await readFile(packagePath)));
    expect(fixture.imports.every((entry) => ALLOWED_WASM_IMPORTS.has(`${entry.module}.${entry.name}`))).toBe(true);
  });
});
