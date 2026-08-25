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

// Keep this fixed environment available without TextEncoder at module evaluation.
const ENVIRONMENT_BYTES = new Uint8Array([80, 65, 84, 72, 61, 47, 117, 115, 114, 47, 98, 105, 110, 0]);

export interface WebVstEnvironment {
  bindMemory(memory: WebAssembly.Memory): void;
  readonly imports: WebAssembly.Imports;
}

export function createWebVstEnvironment(): WebVstEnvironment {
  let memory: WebAssembly.Memory | undefined;
  const view = () => memory && new DataView(memory.buffer);
  const bytes = () => memory && new Uint8Array(memory.buffer);
  const writeU32 = (pointer: number, value: number) => view()?.setUint32(pointer, value >>> 0, true);

  return {
    bindMemory(value) { memory = value; },
    imports: {
      env: {
        __cxa_rethrow() { throw new Error("WebVST module rethrew a C++ exception"); },
        emscripten_notify_memory_growth() { /* Views are recreated per access. */ },
      },
      wasi_snapshot_preview1: {
        clock_time_get(_clock: number, _precision: number, result: number) { writeU32(result, 0); writeU32(result + 4, 0); return 0; },
        fd_read(_fd: number, _iovecs: number, _count: number, result: number) { writeU32(result, 0); return 0; },
        fd_write(_fd: number, iovecs: number, count: number, result: number) {
          const data = view();
          let length = 0;
          if (data) for (let index = 0; index < count; index += 1) length += data.getUint32(iovecs + index * 8 + 4, true);
          writeU32(result, length);
          return 0;
        },
        environ_get(pointer: number, buffer: number) {
          const data = bytes();
          if (data) { writeU32(pointer, buffer); data.set(ENVIRONMENT_BYTES, buffer); }
          return 0;
        },
        environ_sizes_get(count: number, size: number) { writeU32(count, 1); writeU32(size, ENVIRONMENT_BYTES.byteLength); return 0; },
        random_get(pointer: number, length: number) { bytes()?.fill(0, pointer, pointer + length); return 0; },
      },
    },
  };
}
