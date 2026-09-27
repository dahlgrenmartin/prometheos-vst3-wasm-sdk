// The standalone Emscripten module uses --no-entry; CMake still requires a
// translation unit for the executable target that links the adapter fixture.
namespace webvst::fixtures {
void wasm_fixture_link_anchor () {}
}

// Emscripten's no-filesystem libc provides these as weak WASI imports even
// though the fixture never opens files. Resolve them locally to keep the
// public module import contract free of filesystem operations.
extern "C" int __wasi_fd_close (int) { return 0; }
extern "C" int __wasi_fd_seek (int, long long, int, long long* offset) {
  if (offset) *offset = 0;
  return 0;
}

extern "C" void emscripten_stack_init ();
extern "C" void __wasm_call_ctors ();
extern "C" void _initialize () {
  emscripten_stack_init ();
  __wasm_call_ctors ();
}
