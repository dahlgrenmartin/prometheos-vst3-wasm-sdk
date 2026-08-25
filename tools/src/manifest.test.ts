import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateManifest } from "./manifest.js";

type Parameter = {
  id: number;
  flags: number;
  steps: number;
  defaultValue: number;
  title: string;
  labels?: string[];
};

type Class = {
  uid: string;
  name: string;
  vendor: string;
  kind: number;
  parameters: Parameter[];
};

const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const canonicalInstrument = "00112233445566778899aabbccddeeff";
const canonicalEffect = "ffeeddccbbaa99887766554433221100";

function installWasmProbe(classes: Class[], imports: WebAssembly.ModuleImportDescriptor[] = []) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let cursor = 1024;
  const write = (value: string, pointer: number) => {
    new Uint8Array(memory.buffer, pointer, value.length).set(
      Array.from(value, (character) => character.charCodeAt(0)),
    );
  };
  const writeClassString = (read: (classIndex: number) => string) =>
    (classIndex: number, pointer: number, capacity: number) => {
      const value = read(classIndex);
      if (capacity < value.length) return -6;
      write(value, pointer);
      return 0;
    };
  const writeParameterString = (read: (classIndex: number, parameterIndex: number) => string) =>
    (classIndex: number, parameterIndex: number, pointer: number, capacity: number) => {
      const value = read(classIndex, parameterIndex);
      if (capacity < value.length) return -6;
      write(value, pointer);
      return 0;
    };
  const exports = {
    memory,
    malloc: (size: number) => {
      const allocation = cursor;
      cursor += size;
      return allocation;
    },
    free: () => undefined,
    pvst_abi_version: () => 1,
    pvst_class_count: () => classes.length,
    pvst_class_uid_size: (classIndex: number) => classes[classIndex]?.uid.length ?? 0,
    pvst_class_uid_write: writeClassString((classIndex) => classes[classIndex]?.uid ?? ""),
    pvst_class_name_size: (classIndex: number) => classes[classIndex]?.name.length ?? 0,
    pvst_class_name_write: writeClassString((classIndex) => classes[classIndex]?.name ?? ""),
    pvst_class_vendor_size: (classIndex: number) => classes[classIndex]?.vendor.length ?? 0,
    pvst_class_vendor_write: writeClassString((classIndex) => classes[classIndex]?.vendor ?? ""),
    pvst_class_kind: (classIndex: number) => classes[classIndex]?.kind ?? 0,
    pvst_class_param_count: (classIndex: number) => classes[classIndex]?.parameters.length ?? 0,
    pvst_class_param_id: (classIndex: number, parameterIndex: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.id ?? 0,
    pvst_class_param_flags: (classIndex: number, parameterIndex: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.flags ?? 0,
    pvst_class_param_step_count: (classIndex: number, parameterIndex: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.steps ?? 0,
    pvst_class_param_default: (classIndex: number, parameterIndex: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.defaultValue ?? 0,
    pvst_class_param_title_size: (classIndex: number, parameterIndex: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.title.length ?? 0,
    pvst_class_param_title_write: writeParameterString(
      (classIndex, parameterIndex) => classes[classIndex]?.parameters[parameterIndex]?.title ?? "",
    ),
    pvst_class_param_value_text_size: (classIndex: number, parameterIndex: number, normalized: number) =>
      classes[classIndex]?.parameters[parameterIndex]?.labels?.[Math.round(normalized * (classes[classIndex]?.parameters[parameterIndex]?.steps ?? 0))]?.length ?? 0,
    pvst_class_param_value_text_write: (classIndex: number, parameterIndex: number, normalized: number, pointer: number, capacity: number) => {
      const parameter = classes[classIndex]?.parameters[parameterIndex];
      const value = parameter?.labels?.[Math.round(normalized * (parameter.steps ?? 0))] ?? "";
      if (capacity < value.length) return -6;
      write(value, pointer);
      return 0;
    },
  };
  vi.spyOn(WebAssembly, "compile").mockResolvedValue({} as WebAssembly.Module);
  vi.spyOn(WebAssembly.Module, "imports").mockReturnValue(imports);
  vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({ exports } as unknown as WebAssembly.Instance);
}

const twoClasses: Class[] = [
  {
    uid: canonicalInstrument,
    name: "Fixture Synth",
    vendor: "Prometheos",
    kind: 1,
    parameters: [{ id: 0x1001, flags: 1, steps: 0, defaultValue: 1, title: "Gain" }],
  },
  {
    uid: canonicalEffect,
    name: "Fixture Effect",
    vendor: "Prometheos",
    kind: 0,
    parameters: [{ id: 0x2001, flags: 1, steps: 2, defaultValue: 0.5, title: "Mode", labels: ["Off", "Half", "Full"] }],
  },
];

afterEach(() => vi.restoreAllMocks());

describe("generateManifest", () => {
  it("emits both probed classes and maps continuous and discrete controls", async () => {
    installWasmProbe(twoClasses);

    const manifest = await generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      packageId: "org.prometheos.fixtures",
      abi: "prometheos-vst3-wasm-1",
      module: { path: "plugin.wasm", sha256: createHash("sha256").update(wasmBytes).digest("hex") },
      classes: [
        { classUid: canonicalInstrument, kind: "instrument", exposedParameters: [{ parameterId: 0x1001, buzz: { type: "word", maxValue: 65534, defValue: 65534 } }] },
        { classUid: canonicalEffect, kind: "effect", exposedParameters: [{ parameterId: 0x2001, buzz: { type: "byte", maxValue: 2, defValue: 1, display: { choices: ["Off", "Half", "Full"] } } }] },
      ],
    });
  });

  it("rejects duplicate class UIDs before manifest emission", async () => {
    installWasmProbe([{ ...twoClasses[0] }, { ...twoClasses[0], name: "Other" }]);

    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("duplicate class UID");
  });

  it("rejects duplicate parameter IDs in a class before manifest emission", async () => {
    installWasmProbe([{ ...twoClasses[0], parameters: [twoClasses[0].parameters[0], { ...twoClasses[0].parameters[0], title: "Duplicate" }] }]);

    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("duplicate parameter ID");
  });

  it("rejects package IDs that are not reverse DNS names", async () => {
    installWasmProbe(twoClasses);

    await expect(generateManifest({ wasm: wasmBytes, packageId: "fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("reverse-DNS");
  });

  it("rejects modules whose imports fall outside the ABI environment", async () => {
    installWasmProbe(twoClasses, [{ module: "env", name: "TextEncoder", kind: "function" }]);

    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("unsupported WASM import env.TextEncoder");
  });

  it("rejects noncanonical VST3 class UIDs", async () => {
    installWasmProbe([{ ...twoClasses[0], uid: twoClasses[0].uid.toUpperCase() }]);

    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("canonical");
  });

  it("rejects curation entries for VST3 parameters absent from the probe", async () => {
    installWasmProbe(twoClasses);

    await expect(generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
      curation: [{ classUid: canonicalInstrument, parameterId: 99, expose: true }],
    })).rejects.toThrow("does not exist in the probed module");
  });
});
