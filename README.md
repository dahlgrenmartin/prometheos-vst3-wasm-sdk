# WebVST VST3 WASM SDK

This repository publishes the WebVST ABI v1 adapter, package schema,
TypeScript packer/prober, and reproducible build instructions. The public
contract is immutable at ABI string `webvst-vst3-wasm-1`; read
[docs/abi-v1.md](docs/abi-v1.md) and [docs/package-format-v1.md](docs/package-format-v1.md)
before implementing a plugin.

The SDK-owned code is MIT-licensed. The exact Steinberg VST3 SDK source pin and
its license notice remain in [NOTICE.md](NOTICE.md). A naming/trademark review
is still required before a public release or tag; this repository does not
create a tag and makes no trademark claim about the `.webvst` suffix.

## Quick start

The supported toolchain is CMake 3.20+, C++17, Emscripten **4.0.10**, pnpm
**9.15.9**, and Ninja **1.11.1.3**. Clone with the pinned conformance submodule
(`git clone --recurse-submodules`, or `git submodule update --init` afterwards),
install the tools and the TypeScript packer that the fixture targets invoke, then
configure using an explicit path to the Ninja executable:

```sh
corepack prepare pnpm@9.15.9 --activate
python3 -m pip install --user ninja==1.11.1.3
pnpm --dir tools install --frozen-lockfile
NINJA_BIN="$(command -v ninja)"
EMSCRIPTEN_TOOLCHAIN="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
cmake -S . -B build/wasm -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$NINJA_BIN" \
  -DCMAKE_TOOLCHAIN_FILE="$EMSCRIPTEN_TOOLCHAIN" \
  -DWEBVST_BUILD_FIXTURES=ON
cmake --build build/wasm --target webvst_fixture_package upstream_adelay_webvst_package
```

The generated packages are `build/packages/webvst-fixtures.webvst` and
`build/packages/steinberg-adelay.webvst`. The latter compiles the pinned,
untouched Steinberg ADelay VST3 processor, controller, and factory sources
through the generic adapter; the same sources also build as the native
`steinberg_adelay_vst3` target.

Run the TypeScript checks with:

```sh
pnpm --dir tools test
pnpm --dir tools typecheck
```

For the complete plugin workflow, including native sanitizer tests, packaging,
conformance, and clean-rebuild byte comparison, see
[docs/building-a-plugin.md](docs/building-a-plugin.md). The security boundary
and host responsibilities are in [docs/security-model.md](docs/security-model.md).

## Repository outputs

The public deliverables are the C header, adapter library, CMake modules, JSON
Schema, TypeScript command-line tools, and the fixture package. Build and
dependency outputs under `build/`, `tools/dist/`, and `node_modules/` are local
artifacts and are not release sources.
