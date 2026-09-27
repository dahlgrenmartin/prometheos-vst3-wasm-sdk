import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadFixtureModule } from "./package_consumer.js";

const consumerPath = new URL("./package_consumer.ts", import.meta.url);

describe("worklet-facing package consumer", () => {
  it("has no Node, DOM, or text codec dependency and evaluates with restricted globals", async () => {
    const source = await readFile(consumerPath, "utf8");
    expect(source).not.toMatch(/(?:from\s+["']node:|\b(?:TextEncoder|TextDecoder|document|window|Buffer)\b|\bprocess\s*\.)/);

    const blocked = ["document", "window", "TextEncoder", "TextDecoder"] as const;
    const original = new Map<string, PropertyDescriptor | undefined>();
    for (const name of blocked) {
      original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
    }
    try {
      vi.resetModules();
      await import("./package_consumer.js");
    } finally {
      for (const name of blocked) {
        const descriptor = original.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  it("rejects every fresh instance whose standalone initializer is absent", async () => {
    const realWebAssembly = WebAssembly;
    vi.stubGlobal("WebAssembly", {
      Memory: realWebAssembly.Memory,
      Module: { imports: () => [] },
      compile: async () => ({}) as WebAssembly.Module,
      instantiate: async () => ({ exports: { memory: new realWebAssembly.Memory({ initial: 1 }) } }) as unknown as WebAssembly.Instance,
    });
    try {
      const fixture = await loadFixtureModule({
        schemaVersion: 1,
        packageId: "org.webvst.initializer-test",
        version: "1.0.0",
        abi: "webvst-vst3-wasm-1",
        module: { path: "plugin.wasm", sha256: "0".repeat(64) },
        classes: [{ classUid: "0".repeat(32), name: "Test", vendor: "WebVST SDK", kind: "effect", exposedParameters: [] }],
      }, new Uint8Array());
      await expect(fixture.create("0".repeat(32), 48_000, 128)).rejects.toThrow("missing ABI export _initialize");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
