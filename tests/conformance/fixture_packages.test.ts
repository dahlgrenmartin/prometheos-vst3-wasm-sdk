import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadFixturePackage } from "./package_consumer.js";

const packagePath = new URL("../../build/packages/prometheos-fixtures.webvst", import.meta.url);
const frameCounts = [0, 1, 31, 32, 63, 64, 127, 128] as const;

describe("Emscripten fixture package", () => {
  it("loads both VST3 classes, processes every boundary frame count, and round-trips state", async () => {
    const fixture = await loadFixturePackage(new Uint8Array(await readFile(packagePath)));
    expect(fixture.classes.map((entry) => entry.kind)).toEqual(["instrument", "effect"]);

    for (const entry of fixture.classes) {
      const instance = fixture.create(entry.classUid, 48_000, 128);
      try {
        for (const parameter of entry.exposedParameters) {
          expect(instance.setParameter(parameter.parameterId, 0.625)).toBe(0);
          expect(instance.getParameter(parameter.parameterId)).toBeCloseTo(0.625, 5);
        }

        for (const frames of frameCounts) {
          const input = entry.kind === "effect" ? new Float32Array(frames * 2).fill(0.5) : undefined;
          const output = new Float32Array(frames * 2);
          if (entry.kind === "instrument" && frames > 0) expect(instance.noteOn(69, 1)).toBe(0);
          expect(instance.process(input, output, frames)).toBe(0);
          if (entry.kind === "instrument" && frames > 0) expect(instance.noteOff(69)).toBe(0);
          if (entry.kind === "instrument" && frames > 1) expect(output.some((sample) => Math.abs(sample) > 0.0001)).toBe(true);
          if (entry.kind === "effect" && frames > 0) expect(output[0]).toBeCloseTo(0.3125, 5);
        }

        const state = instance.saveState();
        expect(state.byteLength).toBeGreaterThan(0);
        const restored = fixture.create(entry.classUid, 48_000, 128);
        try {
          expect(restored.loadState(state)).toBe(0);
          for (const parameter of entry.exposedParameters) expect(restored.getParameter(parameter.parameterId)).toBeCloseTo(0.625, 5);
        } finally {
          restored.destroy();
        }
      } finally {
        instance.destroy();
      }
    }
  });
});
