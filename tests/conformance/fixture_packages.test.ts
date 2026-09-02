import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadFixturePackage } from "./fixture_package_harness.js";

const packagePath = new URL("../../build/packages/webvst-fixtures.webvst", import.meta.url);
const frameCounts = [0, 1, 31, 32, 63, 64, 127, 128] as const;

describe("Emscripten fixture package", () => {
  it("loads both VST3 classes, processes every boundary frame count, and round-trips state", async () => {
    const fixture = await loadFixturePackage(new Uint8Array(await readFile(packagePath)));
    expect(fixture.classes.map((entry) => entry.kind)).toEqual(["instrument", "effect"]);
    const wasmInstances = new Set<WebAssembly.Instance>();
    const memories = new Set<WebAssembly.Memory>();

    for (const entry of fixture.classes) {
      const instance = fixture.create(entry.classUid, 48_000, 128);
      const live = await instance;
      try {
        expect(live.wasmInstance).toBeInstanceOf(WebAssembly.Instance);
        expect(wasmInstances.has(live.wasmInstance)).toBe(false);
        expect(memories.has(live.memory)).toBe(false);
        wasmInstances.add(live.wasmInstance);
        memories.add(live.memory);
        for (const parameter of entry.exposedParameters) {
          expect(live.setParameter(parameter.parameterId, 0.625)).toBe(0);
          expect(live.getParameter(parameter.parameterId)).toBeCloseTo(0.625, 5);
        }

        for (const frames of frameCounts) {
          const input = entry.kind === "effect" ? new Float32Array(frames * 2).fill(0.5) : undefined;
          const output = new Float32Array(frames * 2);
          if (entry.kind === "instrument" && frames > 0) expect(live.noteOn(69, 1)).toBe(0);
          expect(live.process(input, output, frames)).toBe(0);
          if (entry.kind === "instrument" && frames > 0) expect(live.noteOff(69)).toBe(0);
          if (entry.kind === "instrument" && frames > 1) expect(output.some((sample) => Math.abs(sample) > 0.0001)).toBe(true);
          if (entry.kind === "effect" && frames > 0) expect(output[0]).toBeCloseTo(0.3125, 5);
        }

        const state = live.saveState();
        expect(state.byteLength).toBeGreaterThan(0);
        const restored = await fixture.create(entry.classUid, 48_000, 128);
        try {
          expect(restored.wasmInstance).toBeInstanceOf(WebAssembly.Instance);
          expect(restored.wasmInstance).not.toBe(live.wasmInstance);
          expect(restored.memory).not.toBe(live.memory);
          expect(wasmInstances.has(restored.wasmInstance)).toBe(false);
          expect(memories.has(restored.memory)).toBe(false);
          wasmInstances.add(restored.wasmInstance);
          memories.add(restored.memory);
          expect(restored.loadState(state)).toBe(0);
          for (const parameter of entry.exposedParameters) expect(restored.getParameter(parameter.parameterId)).toBeCloseTo(0.625, 5);
        } finally {
          restored.destroy();
        }
      } finally {
        live.destroy();
      }
    }
    expect(wasmInstances.size).toBe(fixture.classes.length * 2);
    expect(memories.size).toBe(fixture.classes.length * 2);
  });
});
