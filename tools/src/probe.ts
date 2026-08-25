import type { ProbedClass, ProbedParameter } from "./types.js";

export const ALLOWED_WASM_IMPORTS = new Set([
  "env.__cxa_rethrow",
  "env.emscripten_notify_memory_growth",
  "wasi_snapshot_preview1.clock_time_get",
  "wasi_snapshot_preview1.fd_read",
  "wasi_snapshot_preview1.fd_write",
  "wasi_snapshot_preview1.environ_get",
  "wasi_snapshot_preview1.environ_sizes_get",
  "wasi_snapshot_preview1.random_get",
]);

const PVST_OK = 0;
const PVST_PARAMETER_AUTOMATABLE = 1;
const PVST_PARAMETER_READ_ONLY = 2;
const ENVIRONMENT_BYTES = new Uint8Array([80, 65, 84, 72, 61, 47, 117, 115, 114, 47, 98, 105, 110, 0]);
const MAX_CLASS_COUNT = 1_024;
const MAX_PARAMETER_COUNT = 4_096;
const MAX_STRING_BYTES = 1_048_576;

type AbiFunction = (...args: number[]) => number;
type AbiExports = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`WebVST probe: ${message}`);
}

function requiredFunction(exports: AbiExports, name: string): AbiFunction {
  const value = exports[name];
  if (typeof value !== "function") fail(`missing ABI export ${name}`);
  return value as AbiFunction;
}

function optionalFunction(exports: AbiExports, name: string): AbiFunction | undefined {
  const value = exports[name];
  return typeof value === "function" ? value as AbiFunction : undefined;
}

function allocatorFunction(exports: AbiExports, name: "malloc" | "free"): AbiFunction {
  return optionalFunction(exports, name) ?? requiredFunction(exports, `_${name}`);
}

function readUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validatedUid(uid: string): string {
  if (!/^[0-9a-f]{32}$/.test(uid)) fail(`class UID must be canonical lowercase 32-character hex: ${uid}`);
  return uid;
}

function finiteNormalized(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${label} must be finite and normalized`);
  return value;
}

function u32(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail(`${label} must be an unsigned 32-bit integer`);
  }
  return value;
}

function instantiateEnvironment() {
  let memory: WebAssembly.Memory | undefined;
  const view = () => memory ? new DataView(memory.buffer) : undefined;
  const bytes = () => memory ? new Uint8Array(memory.buffer) : undefined;
  const writeU32 = (pointer: number, value: number) => view()?.setUint32(pointer, value >>> 0, true);
  return {
    bindMemory(value: WebAssembly.Memory) { memory = value; },
    imports: {
      env: {
        __cxa_rethrow() { throw new Error("WebVST module rethrew a C++ exception during probing"); },
        emscripten_notify_memory_growth() { /* typed views are recreated on demand */ },
      },
      wasi_snapshot_preview1: {
        clock_time_get(_clockId: number, _precision: number, result: number) { writeU32(result, 0); writeU32(result + 4, 0); return 0; },
        fd_read(_fd: number, _iovecs: number, _iovecsLength: number, result: number) { writeU32(result, 0); return 0; },
        fd_write(_fd: number, iovecs: number, iovecsLength: number, result: number) {
          const data = view();
          let length = 0;
          if (data) for (let index = 0; index < iovecsLength; index += 1) length += data.getUint32(iovecs + index * 8 + 4, true);
          writeU32(result, length);
          return 0;
        },
        environ_get(pointer: number, buffer: number) {
          const data = bytes();
          if (data) {
            new DataView(memory!.buffer).setUint32(pointer, buffer, true);
            data.set(ENVIRONMENT_BYTES, buffer);
          }
          return 0;
        },
        environ_sizes_get(count: number, size: number) { writeU32(count, 1); writeU32(size, ENVIRONMENT_BYTES.length); return 0; },
        random_get(pointer: number, length: number) { bytes()?.fill(0, pointer, pointer + length); return 0; },
      },
    },
  };
}

function readAbiString(
  memory: WebAssembly.Memory,
  malloc: AbiFunction,
  free: AbiFunction,
  size: number,
  write: (pointer: number, capacity: number) => number,
  label: string,
): string {
  if (!Number.isSafeInteger(size) || size < 0) fail(`${label} has invalid byte length`);
  if (size > MAX_STRING_BYTES) fail(`${label} exceeds the maximum ${MAX_STRING_BYTES}-byte string size`);
  if (size === 0) return "";
  const pointer = u32(malloc(size), `${label} allocation pointer`);
  if (pointer === 0) fail(`malloc failed while reading ${label}`);
  try {
    if (pointer > memory.buffer.byteLength || size > memory.buffer.byteLength - pointer) fail(`${label} allocation exceeds memory bounds`);
    const result = write(pointer, size);
    if (result !== PVST_OK) fail(`ABI write for ${label} failed with ${result}`);
    if (pointer > memory.buffer.byteLength || size > memory.buffer.byteLength - pointer) fail(`${label} write exceeds memory bounds`);
    try {
      return readUtf8(new Uint8Array(memory.buffer, pointer, size));
    } catch {
      fail(`${label} contains invalid UTF-8`);
    }
  } finally {
    free(pointer);
  }
}

function probeParameter(
  exports: AbiExports,
  memory: WebAssembly.Memory,
  malloc: AbiFunction,
  free: AbiFunction,
  classIndex: number,
  parameterIndex: number,
): ProbedParameter {
  const call = (name: string) => requiredFunction(exports, name);
  const parameterId = u32(call("pvst_class_param_id")(classIndex, parameterIndex), "parameter ID");
  const flags = u32(call("pvst_class_param_flags")(classIndex, parameterIndex), `parameter ${parameterId} flags`);
  const stepCount = u32(call("pvst_class_param_step_count")(classIndex, parameterIndex), `parameter ${parameterId} step count`);
  if (stepCount > 65534) fail(`parameter ${parameterId} has unsupported step count ${stepCount}`);
  const defaultValue = finiteNormalized(call("pvst_class_param_default")(classIndex, parameterIndex), `parameter ${parameterId} default`);
  const titleSize = u32(call("pvst_class_param_title_size")(classIndex, parameterIndex), `parameter ${parameterId} title size`);
  const title = readAbiString(memory, malloc, free, titleSize,
    (pointer, capacity) => call("pvst_class_param_title_write")(classIndex, parameterIndex, pointer, capacity),
    `parameter ${parameterId} title`);
  const displayValues: string[] = [];
  if (stepCount > 0) {
    for (let value = 0; value <= stepCount; value += 1) {
      const normalized = value / stepCount;
      const size = u32(call("pvst_class_param_value_text_size")(classIndex, parameterIndex, normalized), `parameter ${parameterId} display value ${value} size`);
      displayValues.push(readAbiString(memory, malloc, free, size,
        (pointer, capacity) => call("pvst_class_param_value_text_write")(classIndex, parameterIndex, normalized, pointer, capacity),
        `parameter ${parameterId} display value ${value}`));
    }
  }
  return { parameterId, flags, stepCount, defaultValue, title, displayValues };
}

export async function probeWasm(wasm: Uint8Array): Promise<ProbedClass[]> {
  const module = await WebAssembly.compile(wasm.slice().buffer as ArrayBuffer);
  for (const entry of WebAssembly.Module.imports(module)) {
    const identifier = `${entry.module}.${entry.name}`;
    if (!ALLOWED_WASM_IMPORTS.has(identifier)) fail(`unsupported WASM import ${identifier}`);
  }
  const environment = instantiateEnvironment();
  const instance = await WebAssembly.instantiate(module, environment.imports);
  const exports = instance.exports as AbiExports;
  if (!(exports.memory instanceof WebAssembly.Memory)) fail("missing ABI export memory");
  const memory = exports.memory;
  environment.bindMemory(memory);
  optionalFunction(exports, "_initialize")?.();
  if (requiredFunction(exports, "pvst_abi_version")() !== 1) fail("ABI version is not 1");
  const malloc = allocatorFunction(exports, "malloc");
  const free = allocatorFunction(exports, "free");
  const count = u32(requiredFunction(exports, "pvst_class_count")(), "class count");
  if (count > MAX_CLASS_COUNT) fail(`class count exceeds the maximum ${MAX_CLASS_COUNT}`);
  const classes: ProbedClass[] = [];
  const classUids = new Set<string>();
  for (let classIndex = 0; classIndex < count; classIndex += 1) {
    const call = (name: string) => requiredFunction(exports, name);
    const uid = validatedUid(readAbiString(memory, malloc, free, u32(call("pvst_class_uid_size")(classIndex), `class ${classIndex} UID size`),
      (pointer, capacity) => call("pvst_class_uid_write")(classIndex, pointer, capacity), `class ${classIndex} UID`));
    if (classUids.has(uid)) fail(`duplicate class UID ${uid}`);
    classUids.add(uid);
    const name = readAbiString(memory, malloc, free, u32(call("pvst_class_name_size")(classIndex), `class ${uid} name size`),
      (pointer, capacity) => call("pvst_class_name_write")(classIndex, pointer, capacity), `class ${uid} name`);
    const vendor = readAbiString(memory, malloc, free, u32(call("pvst_class_vendor_size")(classIndex), `class ${uid} vendor size`),
      (pointer, capacity) => call("pvst_class_vendor_write")(classIndex, pointer, capacity), `class ${uid} vendor`);
    const parameterCount = u32(call("pvst_class_param_count")(classIndex), `class ${uid} parameter count`);
    if (parameterCount > MAX_PARAMETER_COUNT) fail(`class ${uid} parameter count exceeds the maximum ${MAX_PARAMETER_COUNT}`);
    const parameterIds = new Set<number>();
    const parameters: ProbedParameter[] = [];
    for (let parameterIndex = 0; parameterIndex < parameterCount; parameterIndex += 1) {
      const parameter = probeParameter(exports, memory, malloc, free, classIndex, parameterIndex);
      if (parameterIds.has(parameter.parameterId)) fail(`duplicate parameter ID ${parameter.parameterId} in class ${uid}`);
      parameterIds.add(parameter.parameterId);
      parameters.push(parameter);
    }
    const kind = u32(call("pvst_class_kind")(classIndex), `class ${uid} kind`);
    if (kind !== 0 && kind !== 1) fail(`class ${uid} has unsupported kind ${kind}`);
    classes.push({ classUid: uid, name, vendor, kind: kind === 1 ? "instrument" : "effect", parameters });
  }
  return classes;
}

export { PVST_PARAMETER_AUTOMATABLE, PVST_PARAMETER_READ_ONLY };
