# WebVST UI Framework Implementation Plan

> Use the planning, parallel-agent, test-driven-development and verification skills. The user has requested implementation of the written design; proceed through implementation and verification in the existing development checkouts.

**Goal:** Deliver the initial framework boundary in section 29, including a reusable browser runtime, separate UI ABI/C++ SDK, and Surge integration as a JUCE migration example.

**Spec:** `../specs/2026-09-27-webvst-ui-framework-design.md`

**Architecture:** The SDK owns the generic framework and package contracts. Surge owns its editor content. Display lists and semantic trees are bounded JSON batches carried across a length-delimited C ABI; host parameters use numeric DSP IDs and normalized values. No change to DSP ABI v1, no package JavaScript, no plugin-specific host branches.

**Tech stack:** TypeScript, Canvas2D, DOM accessibility projection, dedicated Web Workers, C++17 and Emscripten.

## Shared interfaces

- Optional `ui` manifest extension: `{version:1, classes: [{classUid, document:{path,sha256}, custom?:{path,sha256,abi:"webvst-ui-1",requiredCapabilities:string[],optionalCapabilities:string[]}}], assets?: Record<string,{path,sha256,type:"image"|"font"|"binary"}>}`. Existing `plugin.json` naming is preserved.
- UI document: `{version:1, root: UiNode, theme?:Record<string,string|number>}`. Nodes have `type`, stable `id`, optional `parameter` (decimal numeric DSP ID string), `label`, `children`, layout properties. Stateful nodes require authored IDs; stateless nodes may receive ephemeral internal IDs.
- Host parameter service: metadata `{id:string,name:string,defaultValue:number,stepCount:number,choices?:string[],readOnly?:boolean}`, normalized `get(id)`, `begin(id)`, `set(id,value)`, `end(id)`, `subscribe(listener)` returning unsubscribe. Only canonical host publication updates displayed values.
- UI ABI exports: `wvui_version()->u32`, `wvui_alloc(bytes)->u32`, `wvui_free(ptr,bytes)`, `wvui_create()->u32`, `wvui_destroy(handle)`, `wvui_resize(handle,width,height,scale)`, `wvui_event(handle,ptr,bytes)`, `wvui_parameter(handle,id,value)`, `wvui_frame(handle,timeMs)`. Event payload is bounded UTF-8 JSON (at most 1 MiB, `WVUI_MAX_EVENT_BYTES`, matching the host bound, since `configure` carries all parameter metadata). C header: `include/webvst/webvst_ui.h`. Version returns 1. Exports include `memory`; optional `_initialize` runs once.
- Imports in `webvst_ui`: `submit(kind,ptr,bytes)->i32` (1=display list, 2=semantic tree), `parameter(op,id,value)->i32` (0=begin,1=set,2=end), `invalidate()->void`. No ambient browser/WASI capabilities.
- Display list: `{version:1,commands:[...]}` commands use `op` (`save`, `restore`, `rect`, `line`, `text`, `clip`, `transform`, `image`, `path`), bounds fields `x,y,width,height`, colors `color`, text fields `text,size,font` and optional `align` (`left`/`center`/`right`), line fields `x1,y1,x2,y2,width`, transform `matrix:[a,b,c,d,e,f]`, paths `points:[[x,y],...]`, `closed`, optional `stroke` and `lineWidth`. Rect supports `radius`; every command accepts `opacity` (0..1). Resource names are package asset IDs; an `image` draws the whole asset at `x,y,width,height`, so sprite sheets are drawn under `clip`+offset like JUCE `reduceClipRegion`. SVG image assets are rasterized host-side. Semantic tree: `{version:1,nodes:[{id,role,label,value?,min?,max?,checked?,bounds:{x,y,width,height},parameter?,disabled?}]}`.

## Tasks and verification

- [x] 1. Package contract: add strict extension validation/schema, asset/path/hash checks and UI import validation in SDK tooling; add negative tests for traversal, missing fallback, hashes, capabilities and imports. Run tools unit tests and typecheck.
- [x] 2. Browser-independent declarative core: parse/normalize IDs, deterministic row/column/grid bounds, parameter attachments/gesture cancellation, input/focus, semantic tree and display lists, generated fallback. Test malformed trees, duplicate IDs, stepped canonical updates, nested layout, cancellation and multiple editors.
- [x] 3. Host adapters: validate complete frames before rendering, Canvas2D backend, accessible DOM/input adapter, package asset cache with budgets, Worker and inline ABI runner, lifecycle/capability/timeouts/fallback. Test traps, hangs, invalid buffers, stale messages, hidden editor scheduling and disposal.
- [x] 4. C/C++ toolkit: separate versioned header, geometry/component tree/events/focus/invalidation, graphics recorder, standard controls and parameter attachments, runtime glue; native tests and real compiled WASM conformance fixture. Keep toolkit independent of JUCE and browser APIs.
- [x] 5. Surge: generate a complete parameter editor grouped into synth sections from probed stable metadata; add conventional component/paint/attachment custom editor, UI build/package workflow and conformance tests. Preserve pinned upstream/DSP source. Document the remaining full upstream JUCE migration surface explicitly.
- [x] 6. Integrate: exercise a real WASM editor against the runtime, render representative native and Surge editors in browser, run relevant regression suites/typechecks, review contract boundaries and report evidence/limitations.

## Status (2026-09-27)

- The UI work was carried from `design/webvst-ui-framework` (b3efb99) onto `main` so it builds against the de-branded ABI (`webvst_*`, `include/webvst/`); still uncommitted.
- Fixed: `host.ts` syntax error (never imported by tests), missing worker entry (`worker-entry.ts`; custom UIs always timed out into fallback), 64 KiB event bound that made large `configure` events trap the worker.
- Added: text alignment, per-command opacity, stroke rect/path in the C++ `Graphics`; `Component::setContentScale` (JUCE-style zoom with correct hit testing/local coordinates); `Parameters::listen` for view state that follows a parameter; wheel input; SVG image decoding.
- Surge (prometheos-webvst-surgext): the editor is a port of the upstream JUCE editor. Layout is generated from upstream `SkinModel.cpp`, slider styles from `SurgePatch.cpp`, artwork is the dark-mode skin SVGs plus Lato, all read from the pinned upstream commit. All 573 probed parameters bind to upstream connectors; scene/oscillator/LFO/FX selection rebinds them.
- buzz-remote: accepts the `ui` extension and UI files (hash-verified), vendors this runtime (`scripts/sync-webvst-ui.ts --check`), and opens any WebVST machine's editor from the machine menu ("Editor..."), bridging to the song store as the canonical parameter host.
- Evidence: SDK tools 81/81, UI runtime 11/11, native toolkit test; Surge 75/75 including compiled-editor tests; buzz WebVST suites green; editor verified in a browser inside buzz-remote (custom mode, drag round-trip through the song store).
- Host programs: capability `host.programs/1`. The host sends `{type:"programs",categories:[{name,programs[]}]}` and `{type:"program",category,program}` events; the UI requests a selection with `submit(3, {"type":"program",category,program})` (bounded, validated, honoured only when negotiated). C++: `Parameters::programs()` (`Programs::select/step/listen`). Surge's patch browser, jogs and typeahead search use it; buzz-remote maps it to the Category/Program globals and reports the DSP's parameters back after each program load (`machine-globals`), so controls follow the preset.
- Plugin messages: optional DSP extension `webvst-ext-message-1` (`webvst_ext_message`/`webvst_ext_reply_write`, docs/abi-v1.md, `WEBVST_EXPORTS_WITH_MESSAGES`) and UI capability `dsp.messages/1` (`submit(4, {id, body})`, reply events `dsp-reply`, host announces negotiated capabilities with a `capabilities` event; C++ `Parameters::dsp()` / `DspChannel`, public `webvst::Json`). Hover (`PointerEnter/Leave`, `isHovered`), `dblclick` and custom-mode right-click are in the toolkit/host.
- Remaining (previous list, now largely closed): hover sprites, double-click-to-default, modulation routing, favorites/patch saving, oscillator/LFO displays are sketches rather than DSP renders, FX per-slot parameters are not exposed by the DSP probe, filter subtype cycling is bounded by sprite frames not upstream `fut_subcount`, Buzz has no gesture/undo grouping for editor edits.

## Review focus

1. Broken UI or missing assets must never touch DSP lifecycle.
2. Cancel, lost focus, destroy and fallback must close gestures exactly once.
3. Untrusted trees, numbers, pointers, frames, import tables and assets must be bounded before use.
4. Reordered components and concurrent editor instances must keep stable identity and canonical values.
5. Package compatibility and complete fallback coverage must remain generic and verifiable.

## Execution notes

- Work remains uncommitted in the existing checkouts for review; preserve user changes and vendor pins.
- Initial implementation targets the explicit section 29 subset. Advanced controls, WebGPU, broad JUCE compatibility and advanced services remain extension work as specified.
