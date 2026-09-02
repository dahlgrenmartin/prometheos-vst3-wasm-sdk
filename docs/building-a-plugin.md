# Building a WebVST plugin

## Requirements

Use CMake 3.20 or newer, C++17, Node.js, pnpm **9.15.9**, Ninja, and the
pinned Emscripten **4.0.10** toolchain. The VST3 SDK bootstrap fetches root
revision `3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96` (`v3.8.1_build_84`) and its
`pluginterfaces` submodule at `4f547e8e102b47de4a8b8aaf343c73b700786372`, adding
`base` when tests or fixtures are enabled. The ADelay conformance package builds
from the pinned `third_party/public.sdk` submodule, so clone with
`git clone --recurse-submodules` or run `git submodule update --init` before
configuring. The exact SDK pins and licenses are recorded in
[NOTICE.md](../NOTICE.md).

Install the tools in a reproducible environment. CI installs Ninja into its
workspace and records the resolved executable path in the configure command;
do not copy a developer's absolute path into a cache or project file. The
approved Emscripten configure is:

```sh
corepack prepare pnpm@9.15.9 --activate
python3 -m pip install --user ninja==1.11.1.3
pnpm --dir tools install --frozen-lockfile
NINJA_BIN="$(command -v ninja)"
EMSCRIPTEN_TOOLCHAIN="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
cmake -S . -B build/wasm -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$NINJA_BIN" \
  -DCMAKE_TOOLCHAIN_FILE="$EMSCRIPTEN_TOOLCHAIN" \
  -DPVST_BUILD_FIXTURES=ON
cmake --build build/wasm --target webvst_fixture_package upstream_adelay_webvst_package
```

`CMAKE_MAKE_PROGRAM` is intentionally explicit: CMake must use the pinned
Ninja installed by the build environment. In CI, the command uses the path
returned by that job's installation rather than a local user path.

## Plugin integration

Build a static library containing the adapter sources and your VST3 component,
controller, and `GetPluginFactory()` implementation. Include
`include/prometheos/webvst.h`, the exact resolved VST3 SDK source, and C++17.
Your factory may expose instruments and effects, but the adapter accepts only
one main stereo output, and at most one main stereo input for effects. It uses
realtime 32-bit processing and a maximum block size of 128 frames. GUI,
multiple buses, non-stereo buses, sample64, and native binary loading are not
part of ABI v1.

Configure the plugin target with `prometheos_configure_webvst(target)` from
`cmake/WebVstToolchain.cmake`. This emits a standalone WASM module with the
ABI exports, malloc/free, `_initialize`, no entry point, memory growth, and no
filesystem by default. The module must not add imports outside the allowlist
in [package-format-v1.md](package-format-v1.md).

## Package and test

The tools project is a private TypeScript package. From the SDK root:

```sh
pnpm --dir tools test
pnpm --dir tools typecheck
pnpm --dir tools run webvst -- manifest build/wasm/packages/fixture-staging/plugin.wasm \
  com.example.plugin 1.0.0 plugin.wasm build/wasm/packages/fixture-staging/plugin.json
pnpm --dir tools run webvst -- pack build/wasm/packages/fixture-staging \
  build/packages/example.webvst
pnpm --dir tools run webvst -- verify build/packages/example.webvst
```

The CMake fixture target runs the manifest probe and deterministic packer as
part of its build. Run native tests with sanitizers as well as the Emscripten
fixture conformance suite. A release candidate must build twice from clean
directories and compare the resulting `.webvst` bytes.
