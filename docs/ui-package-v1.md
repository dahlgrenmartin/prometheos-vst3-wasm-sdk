# WebVST UI package extension v1

The optional `plugin.json.ui` extension and `ui.json` document are versioned
independently of the frozen `prometheos-vst3-wasm-1` DSP ABI. Packages without
`ui` retain their existing format and generated parameter editor behavior.
The published schemas are `schema/plugin.schema.json` and `schema/ui.schema.json`.

```json
{
  "ui": {
    "version": 1,
    "classes": [{
      "classUid": "00112233445566778899aabbccddeeff",
      "document": { "path": "ui.json", "sha256": "<64 lowercase hex digits>" },
      "custom": {
        "path": "ui.wasm", "sha256": "<64 lowercase hex digits>",
        "abi": "webvst-ui-1",
        "requiredCapabilities": ["webvst-ui-core/1"],
        "optionalCapabilities": ["graphics.images/1"]
      }
    }],
    "assets": {
      "logo": { "path": "assets/logo.png", "sha256": "<64 lowercase hex digits>", "type": "image" }
    }
  }
}
```

Each UI class must name an existing manifest class exactly once. Every class
entry requires a declarative document, including when custom UI is present.
File descriptors bind bytes to SHA-256. Paths are relative POSIX paths, at most
512 characters, without empty/dot/parent segments, backslashes, colons, or control
characters. UI paths cannot collide with the DSP module, manifest, or existing
artifacts. Multiple class declarations may share identical document/module
content at the same path. Conflicting hashes at one path are rejected.

Assets have logical IDs matching `[A-Za-z][A-Za-z0-9_.-]{0,127}` and kinds `image`,
`font`, or `binary`. Document references use IDs, never network URLs. UI files
must be declared; `assets/` is not an unrestricted archive root. Existing
archive limits apply to all UI files. Executable `.js`, `.mjs`, and `.cjs`
sidecars are rejected even when explicitly declared.

Image assets may be raster images or SVG. Hosts decode SVG as an image only (no
script, no external resources) and may rasterize it above its intrinsic size so
zoomed editors stay sharp; display lists still address it in intrinsic units.
Font assets are TrueType/OpenType/WOFF faces; display-list `text` commands name
them by asset ID. Hosts share decoded assets between editor instances.

Capabilities are versioned names such as `graphics.images/1`; each required
and optional list contains at most 64 unique entries, with no overlap. Custom
UI must require `webvst-ui-core/1`. Unknown well-formed names are permitted
for future negotiation. Hosts choose the declarative fallback if any required
capability is unsupported. Missing optional capabilities degrade locally.

## Declarative document

```json
{
  "version": 1,
  "theme": { "background": "#171a20", "accent": "#78b8fc", "fontSize": 13 },
  "root": {
    "type": "column", "gap": 8, "padding": 12,
    "children": [
      { "type": "label", "label": "Filter" },
      { "type": "knob", "id": "filter.cutoff", "label": "Cutoff", "parameter": "42" }
    ]
  }
}
```

Documents contain `version: 1`, `root`, and optional `theme` string/finite-number
map. All document and node properties are strict. Documents are limited to
4 MiB UTF-8 JSON, 10,000 nodes, and a maximum nesting depth of 64 edges.

| Node field | Contract |
| --- | --- |
| `type` | `row`, `column`, `grid`, `label`, `button`, `toggle`, `slider`, `knob`, `combo`, `group`, `slot`, or `image`. |
| `id` | Nonempty unique stable identity, at most 128 characters. Required for interactive controls and slots; optional for stateless nodes. |
| `parameter` | Canonical decimal string containing an existing unsigned 32-bit DSP parameter ID. |
| `label`, `text` | Optional text, at most 4,096 characters each. |
| `asset` | Logical asset ID. Images require an asset of kind `image`. |
| `children` | Optional ordered array of child nodes. |
| `choices` | Optional combo labels, at most 4,096 strings. Metadata supplies default choices. |
| `disabled`, `visible` | Optional booleans. |
| `width`, `height` | Nonnegative logical size or positive fractional string such as `1fr`. |
| `minWidth`, `minHeight`, `maxWidth`, `maxHeight` | Nonnegative logical size constraints. |
| `gap`, `padding`, `flex` | Nonnegative layout values. |
| `columns` | Integer from 1 to 1,024. |
| `aspectRatio` | Positive finite ratio. |
| `align` | `start`, `center`, `end`, or `stretch`. |
| `orientation` | `horizontal` or `vertical`. |
| `breakpoints` | At most 64 strict objects containing `maxWidth`, optional `columns`, and optional `gap`. |

Numeric sizes and layout values other than aspect ratio are limited to
1,000,000, including fractional weights (fraction tokens are at most 32 characters). Strings and numbers must obey their schema constraints. Stateful
IDs must survive reordering and remain scoped to an editor instance.

Pack/verify checks bindings against metadata probed from the DSP, including
read-only and non-exposed parameters. For a custom UI declaration, the document
must provide an enabled, visible interactive binding for every exposed manifest
parameter. Hidden/disabled ancestors cannot satisfy fallback coverage. This
checks structural completeness; author review still determines editor usability.

## Custom module verification and fallback

The packer and verifier compile custom WASM and inspect
`WebAssembly.Module.imports`; they never instantiate or execute custom UI.
Only function imports `webvst_ui.submit`, `webvst_ui.parameter`, and
`webvst_ui.invalidate` are permitted. WASI, browser services, imported memories,
tables and globals, and all other namespaces or function names are rejected.
The runtime additionally validates exported ABI functions, version, memory,
buffers, frames, resource budgets, and lifecycle behavior before using them.

Malformed or missing declared documents/assets, hash mismatches, forbidden
imports, unknown class/parameter/asset references, duplicate IDs, and incomplete
custom fallbacks cause package creation and verification to fail.

Runtime recovery is independent: failed or unsupported custom UI falls back to
the complete declarative document; an absent or invalid document falls back to
a host-generated parameter editor. Editor failure never changes DSP lifecycle.
