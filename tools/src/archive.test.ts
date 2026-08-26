import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_LIMITS,
  inspectWebVst,
  packWebVst,
  verifyWebVst,
} from "./archive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roots: string[] = [];
const classUid = "00112233445566778899aabbccddeeff";

const bytes = (...parts: number[][]) => parts.flat();
const u32leb = (initial: number): number[] => {
  let value = initial;
  const result: number[] = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    result.push(value === 0 ? byte : byte | 0x80);
  } while (value !== 0);
  return result;
};
const s32leb = (initial: number): number[] => {
  let value = initial;
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
const vector = (entries: number[][]) => bytes(u32leb(entries.length), ...entries);
const ascii = (value: string) => [...Buffer.from(value, "utf8")];
const name = (value: string) => bytes(u32leb(value.length), ascii(value));
const section = (id: number, content: number[]) => [id, ...u32leb(content.length), ...content];
const functionType = (parameters: number[], results: number[]) => [0x60, ...vector(parameters.map((item) => [item])), ...vector(results.map((item) => [item]))];
const body = (instructions: number[]) => [...u32leb(instructions.length + 2), 0, ...instructions, 0x0b];

function probeableWasm(includeInitializer = true): Uint8Array {
  const uid = ascii(classUid);
  const i32const = (value: number) => [0x41, ...s32leb(value)];
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
  const functions = section(3, vector([0, 2, 4, 1, 1, 2, 3, 2, 3, 2, 3, 2, 2, 5, 5, 5, 6, 5].map((type) => u32leb(type))));
  const memory = section(5, vector([[0, 1]]));
  const globals = section(6, vector([[0x7f, 1, ...i32const(0), 0x0b]]));
  const exported = [
    ["memory", 2, 0], ["_initialize", 0, 1], ["malloc", 0, 2], ["free", 0, 3],
    ["pvst_abi_version", 0, 4], ["pvst_class_count", 0, 5], ["pvst_class_uid_size", 0, 6], ["pvst_class_uid_write", 0, 7],
    ["pvst_class_name_size", 0, 8], ["pvst_class_name_write", 0, 9], ["pvst_class_vendor_size", 0, 10], ["pvst_class_vendor_write", 0, 11],
    ["pvst_class_kind", 0, 12], ["pvst_class_param_count", 0, 13], ["pvst_class_param_id", 0, 14],
    ["pvst_class_param_flags", 0, 15], ["pvst_class_param_step_count", 0, 16], ["pvst_class_param_default", 0, 17],
    ["pvst_class_param_title_size", 0, 18],
  ].filter(([label]) => includeInitializer || label !== "_initialize")
    .map(([label, kind, index]) => [...name(label as string), kind as number, ...u32leb(index as number)]);
  const exports = section(7, vector(exported));
  const code = section(10, vector([
    body([0x23, 0, ...i32const(1), 0x6a, 0x24, 0]), body(i32const(512)), body([]), body(i32const(1)),
    body([0x23, 0, ...i32const(1), 0x46]), body(i32const(32)), body(writeUid), body(i32const(0)), body(i32const(0)),
    body(i32const(0)), body(i32const(0)), body(i32const(1)), body(i32const(1)), body(i32const(-1)),
    body(i32const(1)), body(i32const(0)), body([0x43, 0, 0, 0, 0]), body(i32const(0)),
  ]));
  const data = section(11, vector([[0, ...i32const(64), 0x0b, ...u32leb(uid.length), ...uid]]));
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...types, ...imports, ...functions, ...memory, ...globals, ...exports, ...code, ...data]);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifest(module: Uint8Array, overrides: Record<string, unknown> = {}) {
  const resource = encoder.encode("resource");
  return {
    schemaVersion: 1,
    packageId: "com.prometheos.fixture",
    version: "1.2.3",
    abi: "prometheos-vst3-wasm-1",
    module: { path: "module.wasm", sha256: sha256(module) },
    classes: [{
      classUid,
      name: "",
      vendor: "",
      kind: "instrument",
      exposedParameters: [{
        parameterId: 0xffff_ffff,
        buzz: { type: "word", name: "", description: "", minValue: 0, maxValue: 65534, noValue: 65535, defValue: 0, flags: 1 },
      }],
    }],
    artifacts: [{ id: "fixture-resource", path: "resources/data.bin", sha256: sha256(resource), role: "resource" }],
    ...overrides,
  };
}

async function staging(order: "forward" | "reverse" = "forward"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "webvst-archive-"));
  roots.push(root);
  const module = probeableWasm();
  const files: Array<[string, Uint8Array]> = [
    ["plugin.json", encoder.encode(`${JSON.stringify(manifest(module), null, 2)}\n`)],
    ["module.wasm", module],
    ["resources/data.bin", encoder.encode("resource")],
    ["licenses/LICENSE.txt", encoder.encode("fixture license")],
  ];
  for (const [relativePath, content] of order === "forward" ? files : [...files].reverse()) {
    await mkdir(join(root, relativePath, ".."), { recursive: true });
    await writeFile(join(root, relativePath), content);
  }
  return root;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb8_8320 : 0);
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffff_ffff) >>> 0;
}

type StoredEntry = {
  name: string;
  localName?: string;
  data?: Uint8Array;
  compressedSize?: number;
  uncompressedSize?: number;
  unixMode?: number;
};

function storedZip(entries: StoredEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? new Uint8Array());
    const entryName = Buffer.from(entry.name, "utf8");
    const localEntryName = Buffer.from(entry.localName ?? entry.name, "utf8");
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(localEntryName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x0201_4b50, 0);
    central.writeUInt16LE(3 << 8, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(entryName.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, localEntryName, data);
    centralParts.push(central, entryName);
    offset += local.length + localEntryName.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...localParts, central, end]));
}

function deflatedZip(name: string, data: Uint8Array, declaredSize: number): Uint8Array {
  const compressed = deflateRawSync(data);
  const entryName = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x0403_4b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(entryName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x0201_4b50, 0);
  central.writeUInt16LE(3 << 8, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(entryName.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + entryName.length, 12);
  end.writeUInt32LE(local.length + entryName.length + compressed.length, 16);
  return new Uint8Array(Buffer.concat([local, entryName, compressed, central, entryName, end]));
}

function centralMetadata(archive: Uint8Array): Array<{ name: string; dosTime: number; dosDate: number }> {
  const view = Buffer.from(archive);
  const result: Array<{ name: string; dosTime: number; dosDate: number }> = [];
  for (let offset = 0; offset <= view.length - 46;) {
    if (view.readUInt32LE(offset) !== 0x0201_4b50) {
      offset += 1;
      continue;
    }
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    result.push({
      name: decoder.decode(view.subarray(offset + 46, offset + 46 + nameLength)),
      dosTime: view.readUInt16LE(offset + 12),
      dosDate: view.readUInt16LE(offset + 14),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packWebVst", () => {
  it("produces identical bytes independent of creation order and source timestamps", async () => {
    const first = await staging("forward");
    const second = await staging("reverse");
    await utimes(join(second, "module.wasm"), new Date("2025-05-06T07:08:09Z"), new Date("2025-05-06T07:08:09Z"));

    expect(await packWebVst(first)).toEqual(await packWebVst(second));
  });

  it("sorts entry names and fixes every DOS timestamp to 1980-01-01", async () => {
    const archive = await packWebVst(await staging("reverse"));
    const entries = centralMetadata(archive);

    expect(entries.map(({ name: entryName }) => entryName)).toEqual([
      "licenses/LICENSE.txt", "module.wasm", "plugin.json", "resources/data.bin",
    ]);
    expect(entries.every(({ dosTime, dosDate }) => dosTime === 0 && dosDate === 0x21)).toBe(true);
  });

  it("rejects an unexpected root file", async () => {
    const root = await staging();
    await writeFile(join(root, "README.txt"), "not package content");

    await expect(packWebVst(root)).rejects.toThrow(/unexpected.*README\.txt/i);
  });

  it("rejects a manifest whose referenced module is missing", async () => {
    const root = await staging();
    await rm(join(root, "module.wasm"));

    await expect(packWebVst(root)).rejects.toThrow(/module.*missing/i);
  });

  it("rejects a manifest hash mismatch", async () => {
    const root = await staging();
    await writeFile(join(root, "resources/data.bin"), "tampered");

    await expect(packWebVst(root)).rejects.toThrow(/hash mismatch.*resources\/data\.bin/i);
  });

  it("rejects program entries whose artifact is absent or range exceeds the artifact", async () => {
    const root = await staging();
    const module = probeableWasm();
    const base = manifest(module);
    const withProgram = (artifactId: string, offset: number, size: number) => manifest(module, {
      classes: [{ ...base.classes[0], programs: { categories: [{ name: "Factory", entries: [{ name: "Init", artifactId, offset, size }] }] } }],
    });

    await writeFile(join(root, "plugin.json"), `${JSON.stringify(withProgram("missing", 0, 0))}\n`);
    await expect(packWebVst(root)).rejects.toThrow(/program.*artifact.*missing|artifact.*missing/i);

    await writeFile(join(root, "plugin.json"), `${JSON.stringify(withProgram("fixture-resource", 7, 2))}\n`);
    await expect(packWebVst(root)).rejects.toThrow(/program.*range|program.*artifact/i);
  });

  it("rejects modules without the runtime-required standalone initializer", async () => {
    const root = await staging();
    const module = probeableWasm(false);
    await writeFile(join(root, "module.wasm"), module);
    await writeFile(join(root, "plugin.json"), `${JSON.stringify(manifest(module))}\n`);

    await expect(packWebVst(root)).rejects.toThrow(/missing ABI export _initialize/i);
  });

  it("rejects executable JavaScript sidecars under approved roots", async () => {
    const root = await staging();
    await writeFile(join(root, "resources/payload.js"), "console.log('sidecar')");

    await expect(packWebVst(root)).rejects.toThrow(/executable.*javascript|javascript.*sidecar/i);
  });

  it("rejects staging content over the total expanded-byte limit before packing", async () => {
    const root = await staging();
    const previousLimit = ARCHIVE_LIMITS.maxExpandedBytes;
    (ARCHIVE_LIMITS as { maxExpandedBytes: number }).maxExpandedBytes = 8;
    try {
      await writeFile(join(root, "resources/a.bin"), "1234");
      await writeFile(join(root, "resources/b.bin"), "5678");
      await expect(packWebVst(root)).rejects.toThrow(/total expanded.*1 GiB/i);
    } finally {
      (ARCHIVE_LIMITS as { maxExpandedBytes: number }).maxExpandedBytes = previousLimit;
    }
  });

  it("rejects a manifest class vendor mismatch", async () => {
    const root = await staging();
    const module = probeableWasm();
    const value = manifest(module);
    value.classes[0].vendor = "Wrong vendor";
    await writeFile(join(root, "plugin.json"), `${JSON.stringify(value)}\n`);

    await expect(packWebVst(root)).rejects.toThrow(/class.*mismatch|vendor/i);
  });

  it("accepts supported presentation curation in generated manifests", async () => {
    const root = await staging();
    const module = probeableWasm();
    const base = manifest(module);
    const value = manifest(module, {
      classes: [{
        ...base.classes[0],
        exposedParameters: [{
          ...base.classes[0].exposedParameters[0],
          buzz: { ...base.classes[0].exposedParameters[0].buzz, name: "Curated name", description: "Curated description", display: { unit: "dB", precision: 1 } },
        }],
      }],
    });
    await writeFile(join(root, "plugin.json"), `${JSON.stringify(value)}\n`);

    await expect(packWebVst(root)).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each([
    ["resource", "licenses/data.bin", "resource"],
    ["preset", "resources/data.bin", "preset"],
  ] as const)("enforces the %s artifact root layout", async (_label, artifactPath, role) => {
    const root = await staging();
    const module = probeableWasm();
    const content = encoder.encode("artifact");
    await mkdir(join(root, artifactPath, ".."), { recursive: true });
    await writeFile(join(root, artifactPath), content);
    const value = manifest(module, {
      artifacts: [{ id: "bad-layout", path: artifactPath, sha256: sha256(content), role }],
    });
    await writeFile(join(root, "plugin.json"), `${JSON.stringify(value)}\n`);

    await expect(packWebVst(root)).rejects.toThrow(/artifact.*root|artifact.*path|layout/i);
  });
});

describe("archive validation", () => {
  it.each(["../plugin.json", "resources\\data.bin", "/plugin.json", "C:/plugin.json", "C:plugin.json"])(
    "rejects unsafe entry path %s",
    async (entryName) => {
      const entries = entryName === "C:plugin.json" ? [{ name: "plugin.json" }, { name: entryName }] : [{ name: entryName }];
      await expect(verifyWebVst(storedZip(entries))).rejects.toThrow(/unsafe.*path/i);
    },
  );

  it("rejects duplicate entry names", async () => {
    await expect(verifyWebVst(storedZip([{ name: "plugin.json" }, { name: "plugin.json" }]))).rejects.toThrow(/duplicate.*plugin\.json/i);
  });

  it("rejects a local-header name that differs from the central-directory name", async () => {
    await expect(verifyWebVst(storedZip([{ name: "plugin.json", localName: "../plugin.json" }]))).rejects.toThrow(/unsafe.*path/i);
  });

  it("rejects symlink entries", async () => {
    await expect(verifyWebVst(storedZip([{ name: "plugin.json", unixMode: 0o120777 }]))).rejects.toThrow(/symlink.*plugin\.json/i);
  });

  it("rejects 4,097 entries", async () => {
    const entries = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({ name: `resources/${index}.bin` }));

    await expect(verifyWebVst(storedZip(entries))).rejects.toThrow(/entry count.*4,096/i);
  });

  it("rejects oversized declared compressed content before extraction", async () => {
    const archive = storedZip([{ name: "plugin.json", compressedSize: ARCHIVE_LIMITS.maxCompressedBytes + 1 }]);

    await expect(verifyWebVst(archive)).rejects.toThrow(/compressed.*512 MiB/i);
  });

  it("rejects an oversized expanded entry before extraction", async () => {
    const archive = storedZip([{ name: "plugin.json", uncompressedSize: ARCHIVE_LIMITS.maxExpandedEntryBytes + 1 }]);

    await expect(verifyWebVst(archive)).rejects.toThrow(/expanded entry.*512 MiB/i);
  });

  it("rejects more than 1 GiB total declared expanded content", async () => {
    const size = 400 * 1024 * 1024;
    const archive = storedZip([0, 1, 2].map((index) => ({ name: `resources/${index}.bin`, uncompressedSize: size })));

    await expect(verifyWebVst(archive)).rejects.toThrow(/total expanded.*1 GiB/i);
  });

  it("stops deflate extraction at the declared expanded size", async () => {
    const archive = deflatedZip("plugin.json", encoder.encode("x".repeat(4096)), 32);

    await expect(verifyWebVst(archive)).rejects.toThrow(/cannot decompress/i);
  });
});

describe("inspectWebVst", () => {
  it("reports package, ABI, class, parameter, artifact, and archive hash details", async () => {
    const archive = await packWebVst(await staging());

    await expect(inspectWebVst(archive)).resolves.toEqual({
      packageId: "com.prometheos.fixture",
      version: "1.2.3",
      archiveSha256: sha256(archive),
      abi: "prometheos-vst3-wasm-1",
      classes: [{ classUid, name: "", kind: "instrument", parameterCount: 1 }],
      artifacts: [{ id: "fixture-resource", path: "resources/data.bin", sha256: sha256(encoder.encode("resource")) }],
    });
  });

  it("rejects an ABI-derived parameter descriptor mismatch", async () => {
    const root = await staging();
    const module = probeableWasm();
    const value = manifest(module);
    value.classes[0].exposedParameters[0].buzz.maxValue = 1;
    await writeFile(join(root, "plugin.json"), `${JSON.stringify(value)}\n`);
    await expect(packWebVst(root)).rejects.toThrow(/parameter.*mismatch|descriptor/i);
  });
});
