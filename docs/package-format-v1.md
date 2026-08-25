# WebVST package format v1

A `.webvst` file is a ZIP archive containing a standalone WebAssembly module,
the strict UTF-8 JSON manifest `plugin.json`, and optional declared artifacts.
The suffix names this package format; it is not a claim of trademark ownership.

## Manifest

The schema is `schema/plugin.schema.json` (JSON Schema draft 2020-12, strict
`additionalProperties: false` objects). Required top-level properties are:

| Property | Meaning |
| --- | --- |
| `schemaVersion` | Integer constant `1`. |
| `packageId` | Lowercase reverse-DNS identifier, with nonempty dot-separated labels. |
| `version` | Nonempty package version string. |
| `abi` | Exact string `prometheos-vst3-wasm-1`. |
| `module` | Object naming the WebAssembly module and its SHA-256. |
| `classes` | Array of ABI-discovered class descriptors. |
| `artifacts` | Optional array of preset/resource descriptors. |

`module` has required `path` and `sha256` properties. `path` is a safe relative
POSIX path and `sha256` is 64 lowercase hexadecimal characters. Every `class`
has required `classUid`, `name`, `vendor`, `kind`, and `exposedParameters`;
`classUid` is 32 lowercase hexadecimal characters and `kind` is `instrument` or
`effect`. `exposedParameters` entries have `parameterId` (an unsigned 32-bit
integer) and `buzz`.

The `buzz` object has required `type`, `name`, `description`, `minValue`,
`maxValue`, `noValue`, `defValue`, and `flags`. `type` is `note`, `switch`,
`byte`, or `word`. Its optional `display` object may contain `unit` (`%`,
`Hz`, `ms`, `dB`, or `ticks`), `min`, `max`, `precision` (nonnegative integer),
`curve` (`linear` or `exp`), and `choices` (an array of strings).

The optional `programs` object on a class contains `categories`; each
`category` has `name` and `entries`; each `program` entry has `name`,
`artifactId`, `offset`, and `size` (nonnegative integers where applicable).

Each optional `artifact` has required `id`, `path`, `sha256`, and `role`.
`role` is `preset` or `resource`; an artifact path must be below `presets/` or
`resources/`, respectively. The archive verifier also permits undeclared files
under `resources/`, `presets/`, and `licenses/` so a package can carry those
supporting files. All other entries must be declared by the manifest as the
module or an artifact.

The manifest generator probes ABI metadata rather than trusting author input.
Automatable, non-read-only parameters are exposed by default. Continuous
parameters map to word values 0..65534 (no-value 65535); discrete parameters
map to byte values 0..stepCount (no-value 255) for at most 254 steps and to word
values otherwise. Defaults are normalized and rounded. Discrete display choices
come from ABI value text. Author curation can change presentation fields or
explicitly expose/hide a valid parameter, but cannot forge ABI ranges, flags,
types, IDs, or class metadata.

## Archive rules

The archive verifier enforces all of the following before exposing package data:

* At most 4,096 entries, 512 MiB compressed content, 512 MiB per expanded
  entry, and 1 GiB expanded content in total.
* ZIP32 only: ZIP64 archives and encrypted entries are rejected. Compression
  method 0 (stored) and method 8 (deflate) are accepted; CRC and declared
  compressed/expanded sizes must match.
* Entry names and manifest paths are UTF-8, relative POSIX paths. Empty,
  `.`, `..`, backslash, leading slash, and drive-letter components are rejected;
  duplicate names and symbolic links are rejected.
* `plugin.json` must exist and be valid strict JSON. A module and every declared
  artifact must exist, and their bytes must match their manifest SHA-256.
  Executable JavaScript sidecars (`.js`, `.mjs`, `.cjs`) are rejected.
* The module is compiled and probed using only these imports:
  `env.__cxa_rethrow`, `env.emscripten_notify_memory_growth`,
  `wasi_snapshot_preview1.clock_time_get`, `fd_read`, `fd_write`,
  `environ_get`, `environ_sizes_get`, and `random_get`.

Native `.vst3` binaries cannot be loaded by this format. A module must export
the ABI v1 functions and standalone initializer expected by the consumer; the
consumer creates a fresh WebAssembly instance and linear memory for each
plugin instance.

## Determinism and conformance

The packer walks staging files in sorted POSIX-name order, emits fixed DOS ZIP
time/date metadata (1980-01-01 00:00:00), uses deflate level 6, and writes a
single canonical JSON line plus newline for `plugin.json`. Reproducible input
bytes, manifest, and toolchain therefore produce byte-identical archives.
Builds must compare the complete archive bytes or SHA-256 after two clean
rebuilds. The repository's conformance tests additionally verify ABI metadata,
imports, stereo processing boundary sizes, state round trips, and archive
entries.
