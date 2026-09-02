import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadFixturePackage } from "./fixture_package_harness.js";

const packagePath = new URL("../../build/packages/steinberg-adelay.webvst", import.meta.url);

describe("untouched upstream Steinberg ADelay package", () => {
  it("loads through IPluginFactory, processes audio, and restores component state", async () => {
    const fixture = await loadFixturePackage(new Uint8Array(await readFile(packagePath)));
    expect(fixture.classes).toHaveLength(1);
    const [entry] = fixture.classes;
    expect(entry).toMatchObject({
      name: "ADelay",
      vendor: "Steinberg Media Technologies",
      kind: "effect",
    });
    expect(entry.exposedParameters.map((parameter) => parameter.parameterId)).toEqual([100, 101]);

    const effect = await fixture.create(entry.classUid, 48_000, 4);
    try {
      const input = new Float32Array([1, -1, 0, 0, 0, 0, 0, 0]);
      const output = new Float32Array(8);
      expect(effect.setParameter(100, 0)).toBe(0);
      expect(effect.process(input, output, 4)).toBe(0);
      expect([...output.slice(0, 4)]).toEqual([0, 0, 1, -1]);

      expect(effect.setParameter(100, 0.25)).toBe(0);
      expect(effect.process(input, output, 4)).toBe(0);
      const state = effect.saveState();
      const restored = await fixture.create(entry.classUid, 48_000, 4);
      try {
        expect(restored.loadState(state)).toBe(0);
        expect(restored.getParameter(100)).toBeCloseTo(0.25, 5);
      } finally {
        restored.destroy();
      }
    } finally {
      effect.destroy();
    }
  });
});
