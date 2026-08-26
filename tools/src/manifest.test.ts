import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateManifest, validateManifest } from "./manifest.js";
import { probeWasm } from "./probe.js";

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
    _initialize: () => undefined,
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
  return exports;
}

const bytes = (...parts: number[][]) => parts.flat();
const u32 = (value: number): number[] => {
  const result: number[] = [];
  do { const byte = value & 0x7f; value >>>= 7; result.push(value === 0 ? byte : byte | 0x80); } while (value !== 0);
  return result;
};
const s32 = (value: number): number[] => {
  const result: number[] = [];
  let more = true;
  while (more) {
    const byte = value & 0x7f;
    value >>= 7;
    more = !((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0));
    result.push(more ? byte | 0x80 : byte);
  }
  return result;
};
const vector = (entries: number[][]) => bytes(u32(entries.length), ...entries);
const ascii = (value: string) => [...Buffer.from(value, "utf8")];
const name = (value: string) => bytes(u32(value.length), ascii(value));
const section = (id: number, content: number[]) => [id, ...u32(content.length), ...content];
const functionType = (parameters: number[], results: number[]) => [0x60, ...vector(parameters.map((item) => [item])), ...vector(results.map((item) => [item]))];
const body = (instructions: number[]) => [...u32(instructions.length + 2), 0, ...instructions, 0x0b];

function standaloneProbeWasm(): Uint8Array {
  const uid = ascii(canonicalInstrument);
  const i32const = (value: number) => [0x41, ...s32(value)];
  const writeUid: number[] = [];
  for (let offset = 0; offset < uid.length; offset += 4) {
    writeUid.push(0x20, 1, ...i32const(offset), 0x6a, ...i32const(64 + offset), 0x28, 2, 0, 0x36, 2, 0);
  }
  writeUid.push(...i32const(0));
  const types = section(1, vector([
    functionType([], []), functionType([], [0x7f]), functionType([0x7f], [0x7f]),
    functionType([0x7f, 0x7f, 0x7f], [0x7f]), functionType([0x7f], []),
    functionType([0x7f, 0x7f], [0x7f]), functionType([0x7f, 0x7f], [0x7d]),
  ]));
  const imports = section(2, vector([[...name("env"), ...name("emscripten_notify_memory_growth"), 0, 0]]));
  const functionTypes = [0, 2, 4, 1, 1, 2, 3, 2, 3, 2, 3, 2, 2, 5, 5, 5, 6, 5].map((type) => u32(type));
  const functions = section(3, vector(functionTypes));
  const memory = section(5, vector([[0, 1]]));
  const globals = section(6, vector([[0x7f, 1, ...i32const(0), 0x0b]]));
  const exports = [
    ["memory", 2, 0], ["_initialize", 0, 1], ["malloc", 0, 2], ["free", 0, 3],
    ["pvst_abi_version", 0, 4], ["pvst_class_count", 0, 5], ["pvst_class_uid_size", 0, 6], ["pvst_class_uid_write", 0, 7],
    ["pvst_class_name_size", 0, 8], ["pvst_class_name_write", 0, 9], ["pvst_class_vendor_size", 0, 10], ["pvst_class_vendor_write", 0, 11],
    ["pvst_class_kind", 0, 12], ["pvst_class_param_count", 0, 13], ["pvst_class_param_id", 0, 14],
    ["pvst_class_param_flags", 0, 15], ["pvst_class_param_step_count", 0, 16], ["pvst_class_param_default", 0, 17],
    ["pvst_class_param_title_size", 0, 18],
  ].map(([label, kind, index]) => [...name(label as string), kind as number, ...u32(index as number)]);
  const exportSection = section(7, vector(exports));
  const code = section(10, vector([
    body([0x23, 0, ...i32const(1), 0x6a, 0x24, 0]), body(i32const(512)), body([]), body(i32const(1)),
    body([0x23, 0, ...i32const(1), 0x46]), body(i32const(32)), body(writeUid), body(i32const(0)), body(i32const(0)),
    body(i32const(0)), body(i32const(0)), body(i32const(1)), body(i32const(1)), body(i32const(-1)),
    body(i32const(1)), body(i32const(0)), body([0x43, 0, 0, 0, 0]), body(i32const(0)),
  ]));
  const data = section(11, vector([[0, ...i32const(64), 0x0b, ...u32(uid.length), ...uid]]));
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...types, ...imports, ...functions, ...memory, ...globals, ...exportSection, ...code, ...data]);
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

  it("uses an actual standalone WASM binary with a supported import and one initialization", async () => {
    const classes = await probeWasm(standaloneProbeWasm());

    expect(classes).toEqual([{
      classUid: canonicalInstrument,
      name: "",
      vendor: "",
      kind: "instrument",
      parameters: [{
        parameterId: 0xffff_ffff,
        flags: 1,
        stepCount: 0,
        defaultValue: 0,
        title: "",
        displayValues: [],
      }],
    }]);
  });

  it("keeps ABI-derived range, default, flags, and type immutable under curation", async () => {
    installWasmProbe(twoClasses);

    await expect(generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
      curation: [{ classUid: canonicalInstrument, parameterId: 0x1001, buzz: { maxValue: 1, defValue: 0, flags: 0, type: "byte" } }],
    } as never)).rejects.toThrow("curation");
  });

  it("rejects malformed curation rather than silently accepting it", async () => {
    installWasmProbe(twoClasses);

    await expect(generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
      curation: [{ classUid: canonicalInstrument, parameterId: 0x1001, expose: "yes", buzz: { display: { choices: ["forged"] } } }],
    } as never)).rejects.toThrow("curation");
  });

  it("rejects malformed author parameter IDs without coercion", async () => {
    for (const id of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000]) {
      await expect(generateManifest({
        wasm: wasmBytes,
        packageId: "org.prometheos.fixtures",
        version: "1.0.0",
        modulePath: "plugin.wasm",
        curation: [{ classUid: canonicalInstrument, parameterId: id }],
      } as never))
        .rejects.toThrow("curation");
    }
  });

  it("rejects negative author parameter IDs without reinterpreting them", async () => {
    await expect(generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
      curation: [{ classUid: canonicalInstrument, parameterId: -1 }],
    } as never)).rejects.toThrow("curation");
  });

  it("maps 254 discrete steps to byte and 255 steps to word", async () => {
    installWasmProbe([{ ...twoClasses[0], parameters: [
      { ...twoClasses[0].parameters[0], id: 1, steps: 254, labels: Array.from({ length: 255 }, (_, index) => `${index}`) },
      { ...twoClasses[0].parameters[0], id: 2, steps: 255, labels: Array.from({ length: 256 }, (_, index) => `${index}`) },
    ] }]);

    const manifest = await generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" });

    expect(manifest.classes[0].exposedParameters.map((entry) => entry.buzz.type)).toEqual(["byte", "word"]);
  });

  it("filters read-only controls even if they are automatable", async () => {
    installWasmProbe([{ ...twoClasses[0], parameters: [{ ...twoClasses[0].parameters[0], flags: 3 }] }]);

    const manifest = await generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" });

    expect(manifest.classes[0].exposedParameters).toEqual([]);
  });

  it("rejects oversized discrete steps and invalid normalized defaults", async () => {
    installWasmProbe([{ ...twoClasses[0], parameters: [{ ...twoClasses[0].parameters[0], steps: 65535 }] }]);
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("unsupported step count");

    vi.restoreAllMocks();
    installWasmProbe([{ ...twoClasses[0], parameters: [{ ...twoClasses[0].parameters[0], defaultValue: Number.NaN }] }]);
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("default");
  });

  it("rejects ABI writes, invalid UTF-8, oversized strings, and out-of-bounds allocations", async () => {
    const writeFailure = installWasmProbe(twoClasses);
    (writeFailure.pvst_class_uid_write as (...args: number[]) => number) = () => -5;
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("ABI write");

    vi.restoreAllMocks();
    installWasmProbe([{ ...twoClasses[0], uid: `${String.fromCharCode(255)}${"0".repeat(31)}` }]);
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("UTF-8");

    vi.restoreAllMocks();
    const oversized = installWasmProbe(twoClasses);
    oversized.pvst_class_uid_size = () => 1_048_577;
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("maximum");

    vi.restoreAllMocks();
    const outOfBounds = installWasmProbe(twoClasses);
    outOfBounds.malloc = () => 65_535;
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("memory bounds");
  });

  it("caps ABI-controlled class and parameter counts", async () => {
    const tooManyClasses = installWasmProbe(twoClasses);
    tooManyClasses.pvst_class_count = () => 1_025;
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("class count exceeds");

    vi.restoreAllMocks();
    const tooManyParameters = installWasmProbe(twoClasses);
    tooManyParameters.pvst_class_param_count = () => 4_097;
    await expect(generateManifest({ wasm: wasmBytes, packageId: "org.prometheos.fixtures", version: "1.0.0", modulePath: "plugin.wasm" }))
      .rejects.toThrow("parameter count exceeds");
  });

  it("permits curation of presentation fields without changing ABI mapping", async () => {
    installWasmProbe(twoClasses);

    const manifest = await generateManifest({
      wasm: wasmBytes,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      modulePath: "plugin.wasm",
      curation: [{ classUid: canonicalInstrument, parameterId: 0x1001, buzz: { name: "Loudness", description: "Output loudness", display: { unit: "dB", precision: 1 } } }],
    });

    expect(manifest.classes[0].exposedParameters[0].buzz).toMatchObject({
      type: "word", minValue: 0, maxValue: 65534, noValue: 65535, defValue: 65534, flags: 1,
      name: "Loudness", description: "Output loudness", display: { unit: "dB", precision: 1 },
    });
  });

  it("rejects malformed final manifest objects through the strict schema", () => {
    expect(() => validateManifest({
      schemaVersion: 1,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      abi: "prometheos-vst3-wasm-1",
      module: { path: "plugin.wasm", sha256: "0".repeat(64), unexpected: true },
      classes: [],
    })).toThrow("strict schema");
  });

  it("rejects duplicate class UIDs and artifact IDs in hand-authored manifests", () => {
    const base = {
      schemaVersion: 1,
      packageId: "org.prometheos.fixtures",
      version: "1.0.0",
      abi: "prometheos-vst3-wasm-1",
      module: { path: "plugin.wasm", sha256: "0".repeat(64) },
      classes: [
        { classUid: canonicalInstrument, name: "First", vendor: "Prometheos", kind: "instrument", exposedParameters: [] },
        { classUid: canonicalInstrument, name: "Second", vendor: "Prometheos", kind: "effect", exposedParameters: [] },
      ],
      artifacts: [
        { id: "preset", path: "presets/one.bin", sha256: "1".repeat(64), role: "preset" },
        { id: "preset", path: "presets/two.bin", sha256: "2".repeat(64), role: "preset" },
      ],
    };

    expect(() => validateManifest(base)).toThrow(/duplicate class UID/i);
    expect(() => validateManifest({ ...base, classes: [base.classes[0]] })).toThrow(/duplicate artifact ID/i);
  });
});
