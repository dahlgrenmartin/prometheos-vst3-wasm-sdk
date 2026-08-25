import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { validateManifest } from "../../tools/src/manifest.js";
import type { WebVstManifestClass, WebVstManifestV1 } from "../../tools/src/types.js";
import { ALLOWED_WASM_IMPORTS, createWebVstEnvironment } from "./webvst_environment.js";

export { ALLOWED_WASM_IMPORTS } from "./webvst_environment.js";

type AbiFunction = (...args: number[]) => number;
type AbiExports = Record<string, unknown>;

export interface FixtureInstance {
  destroy(): void;
  getParameter(parameterId: number): number;
  loadState(state: Uint8Array): number;
  noteOff(note: number): number;
  noteOn(note: number, velocity: number): number;
  process(input: Float32Array | undefined, output: Float32Array, frames: number): number;
  saveState(): Uint8Array;
  setParameter(parameterId: number, value: number): number;
}

export interface FixturePackage {
  archiveSha256: string;
  classes: WebVstManifestClass[];
  create(classUid: string, sampleRate: number, maxFrames: number): FixtureInstance;
  entries: string[];
  imports: WebAssembly.ModuleImportDescriptor[];
}

function fail(message: string): never { throw new Error(`WebVST fixture consumer: ${message}`); }

function required(exports: AbiExports, name: string): AbiFunction {
  const value = exports[name];
  if (typeof value !== "function") fail(`missing ABI export ${name}`);
  return value as AbiFunction;
}

function allocator(exports: AbiExports, name: "malloc" | "free"): AbiFunction {
  const direct = exports[name];
  return typeof direct === "function" ? direct as AbiFunction : required(exports, `_${name}`);
}

function unpack(archive: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) { end = offset; break; }
  }
  if (end < 0) fail("missing ZIP end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (offset > archive.byteLength - 46 || view.getUint32(offset, true) !== 0x0201_4b50) fail("invalid ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameSize));
    if (files.has(name) || !/^(plugin\.json|plugin\.wasm)$/.test(name)) fail(`unexpected archive entry ${name}`);
    if (localOffset > archive.byteLength - 30 || view.getUint32(localOffset, true) !== 0x0403_4b50) fail(`invalid ZIP local entry ${name}`);
    const localNameSize = view.getUint16(localOffset + 26, true);
    const localExtraSize = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameSize + localExtraSize;
    if (dataOffset > archive.byteLength || compressedSize > archive.byteLength - dataOffset) fail(`truncated ZIP entry ${name}`);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed.slice() : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : fail(`unsupported ZIP method ${method}`);
    if (data.byteLength !== expandedSize) fail(`expanded size mismatch for ${name}`);
    files.set(name, data);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return files;
}

function checkManifest(files: Map<string, Uint8Array>): WebVstManifestV1 {
  if (files.size !== 2 || !files.has("plugin.json") || !files.has("plugin.wasm")) fail("fixture archive must contain only plugin.json and plugin.wasm");
  let manifest: WebVstManifestV1;
  try { manifest = validateManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("plugin.json")!))); }
  catch { fail("invalid plugin.json"); }
  if (manifest.module.path !== "plugin.wasm") fail("fixture manifest module path must be plugin.wasm");
  if (createHash("sha256").update(files.get("plugin.wasm")!).digest("hex") !== manifest.module.sha256) fail("plugin.wasm hash mismatch");
  return manifest;
}

function copyToMemory(memory: WebAssembly.Memory, allocate: AbiFunction, bytes: Uint8Array): number {
  const pointer = allocate(bytes.byteLength) >>> 0;
  if (!pointer || pointer > memory.buffer.byteLength || bytes.byteLength > memory.buffer.byteLength - pointer) fail("WASM allocation is outside linear memory");
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

export async function loadFixturePackage(archive: Uint8Array): Promise<FixturePackage> {
  const files = unpack(archive);
  const manifest = checkManifest(files);
  const module = await WebAssembly.compile(files.get("plugin.wasm")!.slice().buffer as ArrayBuffer);
  const imports = WebAssembly.Module.imports(module);
  for (const entry of imports) if (!ALLOWED_WASM_IMPORTS.has(`${entry.module}.${entry.name}`)) fail(`unsupported WASM import ${entry.module}.${entry.name}`);
  const environment = createWebVstEnvironment();
  const instance = await WebAssembly.instantiate(module, environment.imports);
  const exports = instance.exports as AbiExports;
  if (!(exports.memory instanceof WebAssembly.Memory)) fail("missing ABI memory export");
  environment.bindMemory(exports.memory);
  const initialize = exports._initialize;
  if (typeof initialize === "function") (initialize as AbiFunction)();
  const memory = exports.memory;
  const malloc = allocator(exports, "malloc");
  const free = allocator(exports, "free");
  const call = (name: string) => required(exports, name);

  return {
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
    classes: manifest.classes,
    entries: [...files.keys()].sort(),
    imports,
    create(classUid, sampleRate, maxFrames) {
      const classIndex = manifest.classes.findIndex((entry) => entry.classUid === classUid);
      if (classIndex < 0) fail(`unknown fixture class ${classUid}`);
      const handle = call("pvst_create")(classIndex, sampleRate, maxFrames) >>> 0;
      if (!handle) fail(`could not create fixture class ${classUid}`);
      return {
        destroy() { call("pvst_destroy")(handle); },
        getParameter(parameterId) { return call("pvst_param_get")(handle, parameterId); },
        setParameter(parameterId, value) { return call("pvst_param_set")(handle, parameterId, value); },
        noteOn(note, velocity) { return call("pvst_note_on")(handle, note, velocity); },
        noteOff(note) { return call("pvst_note_off")(handle, note); },
        process(input, output, frames) {
          if (frames < 0 || frames > maxFrames || output.length < frames * 2 || (input && input.length < frames * 2)) fail("invalid process buffer");
          const inputPointer = input ? copyToMemory(memory, malloc, new Uint8Array(input.buffer, input.byteOffset, frames * 8)) : 0;
          const outputPointer = copyToMemory(memory, malloc, new Uint8Array(frames * 8));
          try {
            const result = call("pvst_process")(handle, inputPointer, outputPointer, frames);
            output.set(new Float32Array(memory.buffer, outputPointer, frames * 2));
            return result;
          } finally { if (inputPointer) free(inputPointer); free(outputPointer); }
        },
        saveState() {
          const size = call("pvst_state_size")(handle) >>> 0;
          const pointer = copyToMemory(memory, malloc, new Uint8Array(size));
          try {
            if (call("pvst_state_write")(handle, pointer, size) !== 0) fail("could not write state");
            return new Uint8Array(memory.buffer, pointer, size).slice();
          } finally { free(pointer); }
        },
        loadState(state) {
          const pointer = copyToMemory(memory, malloc, state);
          try { return call("pvst_state_load")(handle, pointer, state.byteLength); }
          finally { free(pointer); }
        },
      };
    },
  };
}
