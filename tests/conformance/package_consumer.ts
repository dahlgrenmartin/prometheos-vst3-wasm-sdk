import type { WebVstManifestClass, WebVstManifestV1 } from "../../tools/src/types.js";
import { ALLOWED_WASM_IMPORTS, createWebVstEnvironment } from "./webvst_environment.js";

export { ALLOWED_WASM_IMPORTS } from "./webvst_environment.js";

type AbiFunction = (...args: number[]) => number;
type AbiExports = Record<string, unknown>;

export interface FixtureInstance {
  readonly memory: WebAssembly.Memory;
  readonly wasmInstance: WebAssembly.Instance;
  destroy(): void;
  getParameter(parameterId: number): number;
  loadState(state: Uint8Array): number;
  noteOff(note: number): number;
  noteOn(note: number, velocity: number): number;
  process(input: Float32Array | undefined, output: Float32Array, frames: number): number;
  saveState(): Uint8Array;
  setParameter(parameterId: number, value: number): number;
}

export interface FixtureModule {
  classes: WebVstManifestClass[];
  create(classUid: string, sampleRate: number, maxFrames: number): Promise<FixtureInstance>;
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

function copyToMemory(memory: WebAssembly.Memory, allocate: AbiFunction, bytes: Uint8Array): number {
  const pointer = allocate(bytes.byteLength) >>> 0;
  if (!pointer || pointer > memory.buffer.byteLength || bytes.byteLength > memory.buffer.byteLength - pointer) fail("WASM allocation is outside linear memory");
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

export async function loadFixtureModule(manifest: WebVstManifestV1, wasm: Uint8Array): Promise<FixtureModule> {
  const module = await WebAssembly.compile(wasm.slice().buffer as ArrayBuffer);
  const imports = WebAssembly.Module.imports(module);
  for (const entry of imports) if (!ALLOWED_WASM_IMPORTS.has(`${entry.module}.${entry.name}`)) fail(`unsupported WASM import ${entry.module}.${entry.name}`);

  return {
    classes: manifest.classes,
    imports,
    async create(classUid, sampleRate, maxFrames) {
      const classIndex = manifest.classes.findIndex((entry) => entry.classUid === classUid);
      if (classIndex < 0) fail(`unknown fixture class ${classUid}`);

      const environment = createWebVstEnvironment();
      const wasmInstance = await WebAssembly.instantiate(module, environment.imports);
      const exports = wasmInstance.exports as AbiExports;
      if (!(exports.memory instanceof WebAssembly.Memory)) fail("missing ABI memory export");
      const memory = exports.memory;
      environment.bindMemory(memory);
      required(exports, "_initialize")();

      const malloc = allocator(exports, "malloc");
      const free = allocator(exports, "free");
      const call = (name: string) => required(exports, name);
      const handle = call("pvst_create")(classIndex, sampleRate, maxFrames) >>> 0;
      if (!handle) fail(`could not create fixture class ${classUid}`);

      return {
        memory,
        wasmInstance,
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
