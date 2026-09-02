# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A standalone SDK that publishes the **Prometheos WebVST ABI v1** contract: a C ABI
(`include/prometheos/webvst.h`), a C++17 adapter that bridges it to a real VST3 factory,
a `.webvst` package format (`schema/plugin.schema.json`), and a TypeScript probe/packer.
It ships no plugin of its own — the fixtures and the pinned Steinberg ADelay exist only
to prove the contract.

It sits inside the `prometheos-dev` workspace directory but is **not** one of that
workspace's submodules and shares none of its tooling (no pnpm workspace, no
`@prometheos/shared`). Ignore the parent `pnpm dev` workflow here.

The contract is frozen: the ABI string `prometheos-vst3-wasm-1`, `PVST_ABI_VERSION == 1`,
`PVST_MAX_PROCESS_FRAMES == 128`, and the documented result codes are immutable. Behaviour
changes go in a future ABI version, never into v1. `NOTICE.md` also records that a
naming/trademark review gates any public tag — do not create one.

## Commands

Pinned toolchain: CMake 3.20+, C++17, Emscripten **4.0.10**, pnpm **9.15.9**,
Ninja **1.11.1.3**, Node 22. First: `git submodule update --init` — configuring with
`PVST_BUILD_TESTS` or `PVST_BUILD_FIXTURES` hard-errors without `third_party/public.sdk`.

Two independent build trees; both are required for a full check.

```sh
# Native adapter + tests, with sanitizers (build/native)
cmake -S . -B build/native -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$(command -v ninja)" -DPVST_BUILD_TESTS=ON -DPVST_ENABLE_SANITIZERS=ON
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
ctest --test-dir build/native -R upstream_adelay --output-on-failure   # single test

# Emscripten fixture + package targets (build/wasm)
cmake -S . -B build/wasm -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$(command -v ninja)" \
  -DCMAKE_TOOLCHAIN_FILE="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" \
  -DPVST_BUILD_FIXTURES=ON
cmake --build build/wasm --target webvst_fixture_package upstream_adelay_webvst_package

# TypeScript tools
pnpm --dir tools install --frozen-lockfile
pnpm --dir tools test          # unit tests AND tests/conformance (see gotcha below)
pnpm --dir tools test:conformance
pnpm --dir tools typecheck
pnpm --dir tools exec vitest run src/manifest.test.ts        # single file
pnpm --dir tools exec vitest run -t "documents every"        # single test

# Packer/prober CLI (rebuilds dist/ first)
pnpm --dir tools run webvst -- manifest <plugin.wasm> <package-id> <version> <module-path> <plugin.json>
pnpm --dir tools run webvst -- pack <staging-dir> <output.webvst>
pnpm --dir tools run webvst -- inspect|verify <archive.webvst>
```

`CMAKE_MAKE_PROGRAM` is deliberately explicit — CMake must use the environment's pinned
Ninja. `PVST_BUILD_FIXTURES` requires the Emscripten toolchain and `pnpm` on `PATH`
(CMake invokes the TypeScript packer as a build step). `PROMETHEOS_VST3_SDK_DIR` points
the build at a local VST3 SDK checkout instead of the pinned `FetchContent` download.

Both package targets always write into the source tree at `build/packages/`
(`prometheos-fixtures.webvst`, `steinberg-adelay.webvst`), regardless of the build dir.

## Architecture

Four layers, each with a single seam to the next:

**1. ABI (`include/prometheos/webvst.h`)** — flat C, `uint32_t` handles, no structs across
the boundary. Strings use a `*_size` / `*_write` pair (byte counts, no NUL). Audio is
interleaved stereo `float32`, at most 128 frames per call.

**2. Adapter (`src/adapter/`)** — links against an `extern "C" GetPluginFactory()` that the
*plugin* provides; that undefined symbol is the whole integration seam.
- `adapter.cpp` — process-wide `Adapter` singleton, 32 instance slots, handles encoded as
  `(generation << 16) | (slot + 1)` so a stale handle cannot address a later instance.
  Class enumeration filters the factory to `kVstAudioEffectClass` and re-walks it per call.
  This file also holds the `extern "C" pvst_*` wrappers.
- `vst3_instance.cpp` — one VST3 component + controller pair: initialize, connect the two
  connection points, validate buses (exactly one main stereo output; effects may add one
  main stereo input), `setupProcessing`, activate, and unwind in exact reverse on any
  failure. Rejects anything outside that shape.
- `process_events.h/.cpp` — `FixedEventList` and `FixedParameterChanges`, preallocated
  (64 events, 64 parameter queues/points), no allocation on the audio path. Queues are
  cleared after **every** process attempt, including plugin failure.
- `memory_stream.*` — `IBStream` over a vector, used for the state envelope: a 16-byte
  little-endian header (`'PVST'`, version 1, component size, controller size) then the two
  opaque blobs.

**3. Proof harnesses** — `fixtures/` is a hand-written VST3 instrument + effect pair;
`conformance/adelay/` compiles the *unmodified* upstream Steinberg ADelay sources through
the same adapter, producing both a native `.vst3` module and a `.webvst` package. Native
tests live in `tests/native/` (ctest), package-level tests in `tests/conformance/` (vitest).

**4. TypeScript tools (`tools/src/`)** — `probe.ts` instantiates the module in a fixed
sandbox and *reads metadata out of the ABI* rather than trusting author input; `manifest.ts`
maps probed parameters to the host-facing "buzz" descriptors (zod-validated; author curation
may only adjust presentation, never IDs, ranges, flags, or class metadata); `archive.ts` is
both the deterministic ZIP writer and the hardened verifier (limits, ZIP32-only, path
traversal, hash binding, no JS sidecars).

`tests/conformance/package_consumer.ts` is a **second, independent** consumer implementation
that models what an AudioWorklet must do. It is deliberately free of `node:` imports,
`TextEncoder`/`TextDecoder`, DOM globals and `process` — `worklet_consumer_compatibility.test.ts`
asserts that. Do not "simplify" it by reusing `tools/src`.

## Invariants CI enforces

Breaking any of these fails `.github/workflows/ci.yml`, usually far from the edit:

- **Docs gates** (`tools/src/docs.test.ts`): every `pvst_*` declaration in the header must
  appear in `docs/abi-v1.md` with its *exact* signature, and every `properties` object in
  `schema/plugin.schema.json` — recursively, including `$defs` and array `items` — must have
  a matching ``### `<label>` object`` table in `docs/package-format-v1.md` listing exactly
  its property names.
- **No absolute build paths**: the same test scans all `git ls-files` for any absolute path
  containing a `build` segment. Never paste a machine-local path into a tracked file — and
  note it is purely textual, so even a root-anchored ignore pattern — a leading slash in front
  of `build/` — counts as an offender. That is why `.gitignore` keeps its patterns unanchored,
  and why prose about this rule must avoid writing such a path literally.
- **Determinism**: the packer emits sorted entries, fixed 1980-01-01 ZIP timestamps, deflate
  level 6 and one canonical JSON line. CI rebuilds from clean and compares package bytes;
  `tests/conformance/determinism.test.ts` re-runs the CMake target and compares SHA-256.
- **Upstream stays untouched**: `git -C third_party/public.sdk diff --exit-code`. Adapt around
  ADelay, never patch it.
- **Import allowlist** (8 entries: `env.__cxa_rethrow`, `env.emscripten_notify_memory_growth`,
  and 6 WASI preview-1 calls) is duplicated in `tools/src/probe.ts`,
  `tests/conformance/webvst_environment.ts`, `docs/package-format-v1.md` and
  `docs/security-model.md`. Changing it means changing all four — and it is part of the frozen
  v1 contract, so it should not change.

## Adding or changing an ABI export

Five places, all of them: `include/prometheos/webvst.h`, the `extern "C"` block at the bottom
of `src/adapter/adapter.cpp`, `PROMETHEOS_WEBVST_EXPORTS` in `cmake/WebVstExports.cmake`
(the Emscripten `EXPORTED_FUNCTIONS` list, underscore-prefixed), the signature block in
`docs/abi-v1.md`, and — if consumers call it — `tools/src/probe.ts` and/or
`tests/conformance/package_consumer.ts`. Cover it in `tests/native/`.

## Gotchas

- `pnpm --dir tools test` runs `tests/conformance/**` too (see `tools/vitest.config.ts`), and
  those tests read `build/packages/*.webvst` and shell out to `cmake --build build/wasm`.
  Build the Emscripten packages first, or scope the run: `pnpm --dir tools exec vitest run src`.
- The VST3 SDK has no Emscripten platform branch, so every Emscripten target defines
  `__linux__=1` to select the portable non-COM interface layout. Keep that on any new target.
- The Emscripten module is standalone (`-sSTANDALONE_WASM`, `--no-entry`, no filesystem).
  `fixtures/bundle/wasm_entry.cpp` supplies `_initialize` and stubs `__wasi_fd_close`/`fd_seek`
  to keep them out of the import list; a consumer must call `_initialize` before any ABI call
  and must use a fresh WebAssembly instance and memory per plugin instance.
- Any new native library that ends up in the same link as `prometheos_webvst_adapter` must
  call `pvst_enable_sanitizers(<target> PRIVATE)`. The adapter carries `/fsanitize=address`
  PUBLIC, and MSVC's ASan changes STL container annotations, so an unsanitized static library
  fails the link with `LNK2038: mismatch detected for 'annotate_vector'`. New test executables
  also need adding to the ASan-runtime copy loop in `CMakeLists.txt`. Linux/clang CI does not
  catch either.
- The C++ here is intentionally dense — many declarations and statements per line, Steinberg's
  `func ()` spacing. Match it rather than reformatting.
