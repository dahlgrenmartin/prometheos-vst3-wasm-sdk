# WebVST UI Framework Design

**Date:** 2026-09-27  
**Status:** Design approved in brainstorming; implementation not yet approved  
**Scope:** A reusable, browser-native UI framework for WebVST plugins that complements, but does not modify, the frozen `prometheos-vst3-wasm-1` DSP ABI.

## 1. Purpose

WebVST needs a reusable UI framework with the ergonomics audio-plugin authors expect from JUCE, but designed around WebAssembly, browser isolation, host-owned automation/state, and portable rendering.

The framework must support three authoring levels without forcing every plugin to carry a custom UI runtime:

1. No authored UI: the host generates a usable editor from parameter metadata.
2. Declarative UI: the plugin ships `ui.json` and uses standard reusable controls.
3. Custom UI: the plugin optionally ships `ui.wasm` and uses a JUCE-like C++ SDK for bespoke controls, visualization, drawing, and interaction.

A plugin with custom UI must still have a complete declarative fallback. The host remains generic: it must not gain plugin-specific code, URLs, class IDs, renderer exceptions, or toolkit-specific branches.

## 2. Design goals

The framework is optimized for:

- Reusability across arbitrary WebVST plugins.
- Modularity and independently testable subsystems.
- Low boilerplate for new plugin GUIs.
- Familiarity for JUCE and native audio-plugin developers.
- A language-neutral binary contract.
- Strong isolation between DSP, UI code, and the browser host.
- Host-authoritative parameters, state, automation, and project persistence.
- Graceful fallback when custom UI is missing, incompatible, slow, or broken.
- Renderer independence.
- Accessibility as a first-class semantic contract.
- Deterministic layout and testable rendering semantics.
- Future compatibility with the WebAssembly Component Model without requiring it for v1.
- Straightforward migration of common JUCE editors.

## 3. Non-goals

The first UI version will not:

- Attempt full source or binary compatibility with JUCE.
- Implement a browser DOM inside WASM.
- Expose arbitrary DOM, JavaScript, network, filesystem, AudioWorklet, or browser APIs to plugin UI code.
- Reproduce the full CSS cascade or browser layout engine.
- Require WebGPU.
- Route DSP processing through the UI ABI.
- Require exact cross-platform glyph metrics in v1.
- Guarantee support for arbitrary native VST3 `IPlugView` implementations.
- Put plugin-specific behavior into the host.
- Modify the frozen WebVST DSP ABI v1.

## 4. Package model

A WebVST package may contain:

```text
plugin.webvst
├── manifest.json
├── dsp.wasm
├── ui.json
├── ui.wasm            # optional
└── assets/
    ├── images
    ├── fonts
    └── plugin-defined binary assets
```

`ui.json` is the stable portable editor description. It must describe a complete usable editor whenever a plugin declares a custom UI.

`ui.wasm` is optional. It may augment named extension slots or replace the editor root, but it must do so through the WebVST UI contract. It receives no ambient browser authority.

If `ui.wasm` is unavailable, unsupported, traps, times out, or is disabled, the host renders `ui.json`. If `ui.json` itself is absent, the host generates a generic editor from parameter metadata.

The fallback chain is therefore:

```text
custom ui.wasm
      ↓ failure/unavailable
complete ui.json
      ↓ absent/invalid
host-generated parameter editor
```

## 5. System architecture

The framework is layered around a deliberately small stable core.

```text
                    author-facing SDK
                          │
           ┌──────────────┴──────────────┐
           │                             │
    declarative toolkit             C++ toolkit
       ui.json                    Component / Graphics
           │                             │
           └──────────────┬──────────────┘
                          │
                    WebVST UI Core
                          │
         ┌────────────────┼─────────────────┐
         │                │                 │
   component model   parameter model   display lists
   layout/events     accessibility     asset handles
         │                │                 │
         └────────────────┼─────────────────┘
                          │
                   WebVST UI ABI
                          │
                 capability boundary
                          │
       ┌──────────────────┼───────────────────┐
       │                  │                   │
    UI Worker        Host services       Main thread
    ui.wasm          parameters          renderer
                     automation          DOM/ARIA
                     assets              Canvas2D/WebGPU
```

The UI ABI understands lifecycle, events, parameters, assets, display-list submission, accessibility updates, invalidation, timing, diagnostics, and negotiated capabilities.

It does not understand widget classes such as `Knob`, `Slider`, `EnvelopeEditor`, or `Oscilloscope`. Those belong in reusable libraries above the ABI.

## 6. Execution model

DSP and UI execute independently.

```text
AudioWorklet                 UI Worker                 Main thread
────────────                 ─────────                 ───────────
DSP WASM                     ui.wasm                   host shell
canonical parameters   ←→    component tree      →     display renderer
audio/state                   layout/paint              Canvas2D/WebGPU
                              interaction                DOM accessibility
                                   ↑                         ↓
                                   └──── normalized input ────┘
```

The preferred runtime is Worker-first:

- DSP remains in the AudioWorklet.
- Custom `ui.wasm` normally runs in a dedicated Worker.
- The main thread owns browser rendering and accessibility projection.
- The same UI ABI may also run inline on the main thread for tests, simple hosts, debugging, or constrained environments.
- No framework API may require synchronous access to a browser object.

A stuck or crashing UI worker can be terminated without stopping DSP.

## 7. Stable binary boundary

The first production UI contract uses a language-neutral C ABI.

The C++ SDK is an ergonomic library layered on top of that contract; C++ ABI details never cross the host/plugin boundary.

The C ABI should use:

- Explicit integer and floating-point widths.
- Opaque handles.
- Size/version-prefixed structures where structures are appropriate.
- Length-delimited strings and buffers.
- Explicit ownership rules.
- Explicit error/result codes.
- No STL types.
- No exceptions across the boundary.
- No browser-specific types.

The ABI should be designed so its logical interfaces can later be represented naturally in WIT/WebAssembly Component Model interfaces.

The Component Model is therefore an evolution path, not a v1 dependency.

The DSP ABI, UI ABI, and package format are versioned independently.

## 8. Author-facing C++ model

The primary custom-UI programming model is retained-mode components with immediate drawing inside `paint()`.

Example:

```cpp
class FilterEditor : public webvst::Component
{
public:
    FilterEditor(webvst::Parameters& params)
    {
        cutoff.bind(params, "cutoff");
        resonance.bind(params, "resonance");

        add(cutoff);
        add(resonance);
    }

    void paint(webvst::Graphics& g) override
    {
        g.fill(background);
        g.drawText("Filter", titleBounds, titleFont);
    }

    void resized() override
    {
        auto r = bounds().reduced(16);
        cutoff.setBounds(r.takeLeft(100));
        resonance.setBounds(r.takeLeft(100));
    }

private:
    webvst::Knob cutoff;
    webvst::Knob resonance;
};
```

The retained component tree owns:

- Parent/child hierarchy.
- Bounds.
- Visibility.
- Hit testing.
- Focus.
- Invalidation.
- Input routing.
- Accessibility semantics.
- Component lifecycle.

`Graphics` is immediate-mode from the author's perspective, but records renderer-neutral commands rather than calling browser APIs.

## 9. Low-boilerplate authoring

The framework must make the simple case substantially smaller than building a web application.

A minimal declarative editor should be sufficient to get layout, parameter attachment, automation gestures, keyboard access, accessibility, theming, value formatting, focus, and host updates:

```json
{
  "version": 1,
  "root": {
    "type": "column",
    "gap": 12,
    "padding": 16,
    "children": [
      {
        "type": "knob",
        "id": "cutoff",
        "parameter": "cutoff",
        "label": "Cutoff"
      },
      {
        "type": "knob",
        "id": "resonance",
        "parameter": "resonance",
        "label": "Resonance"
      },
      {
        "type": "toggle",
        "id": "bypass",
        "parameter": "bypass",
        "label": "Bypass"
      }
    ]
  }
}
```

Standard controls must have sensible defaults.

The initial reusable control set should include at least:

- Knob.
- Slider.
- Toggle.
- Button.
- ComboBox.
- Label.
- XYPad.
- Meter.
- Image.
- Group.
- Tabs.
- ScrollView.

Parameter binding is first-class. A standard control binding should automatically handle:

- Current value.
- Host-to-UI updates.
- UI-to-host changes.
- Default value.
- Normalization.
- Discrete/stepped behavior.
- Formatted value text.
- Begin/end automation gestures.
- Accessibility label/value.
- Host automation and undo integration.

Plugin authors must not manually implement Worker messaging, parameter IDs, pointer capture, focus traversal, accessibility projection, render scheduling, asset transport, or display-list submission for ordinary controls.

## 10. Declarative UI model

The author-facing declarative format is a nested JSON component tree.

The host normalizes it internally into an ID-keyed graph.

Stable IDs are required for:

- Custom extension slots.
- Stateful components.
- Accessibility references.
- Diagnostics.
- Custom `ui.wasm` targeting.
- Host/editor tooling.

Example:

```json
{
  "version": 1,
  "root": {
    "type": "column",
    "id": "main",
    "children": [
      {
        "type": "knob",
        "id": "cutoff",
        "parameter": "cutoff",
        "label": "Cutoff"
      },
      {
        "type": "slot",
        "id": "spectrum"
      }
    ]
  }
}
```

The normalized graph is an internal representation. Tree order must not be used as persistent identity.

## 11. Custom UI authority

The declarative editor is always the portable baseline.

Custom `ui.wasm` may:

- Populate declared extension slots.
- Add custom component subtrees.
- Provide custom painting and interaction.
- Provide visualizers and bespoke controls.
- Optionally replace the root editor.

Even with root replacement, custom UI is constrained to the same negotiated WebVST capabilities. It receives no direct browser APIs.

A host may choose to disable custom UI and render the declarative editor only.

## 12. Parameter and automation ownership

The host is the single source of truth for plugin parameters and automation.

```text
UI control
   ↓ begin gesture
UI requests value
   ↓
host parameter service
   ↓
DSP / automation / project state
   ↓
host publishes canonical value
   ↓
UI observes canonical value
```

The UI may hold ephemeral presentation state such as:

- Hover state.
- Pressed state.
- Scroll position.
- Animation phase.
- Expanded/collapsed panels.
- Temporary drag state.
- Local selection.

It does not own canonical plugin parameter values or persistent plugin state.

This keeps automation, undo, remote control, MIDI mapping, multiple editors, project restore, and DSP state consistent.

## 13. Rendering model

`Graphics` records a renderer-neutral display list.

The display-list vocabulary should cover common plugin UI primitives:

- Rectangles and rounded rectangles.
- Paths.
- Lines and strokes.
- Solid fills.
- Gradients.
- Images.
- Text.
- Transforms.
- Clipping.
- Opacity.
- Layers where supported.

The first production backend is Canvas2D.

WebGPU may be added later without changing the component model or author-facing drawing API.

A software/headless renderer may be used for tests.

The display-list protocol is versioned independently enough to allow additive commands and capability negotiation.

Large/high-frequency renderer data should use coarse operations, buffers, resources, or display-list submissions rather than chatty host calls for each primitive.

## 14. Layout

The declarative layer uses a small deterministic layout system inspired by Flexbox and Grid, not full CSS.

Initial concepts:

- Row.
- Column.
- Grid.
- Fixed sizes.
- Relative/fr sizes.
- Minimum and maximum sizes.
- Padding.
- Gap.
- Alignment.
- Aspect ratio.
- Visibility.
- A small breakpoint/responsive mechanism.

The framework does not implement:

- CSS selectors.
- Cascade.
- Floats.
- Browser layout quirks.
- Arbitrary DOM measurement dependencies.

Custom C++ components may use explicit `setBounds()` inside their own subtree.

## 15. Styling and theming

Plugins define their default appearance through semantic tokens.

Examples include:

- Surface/background colors.
- Text colors.
- Accent colors.
- Focus colors.
- Spacing.
- Corner radius.
- Control sizes.
- Typography roles.

Controls reference tokens rather than relying on global CSS.

The host may override a constrained semantic subset for:

- Contrast/accessibility.
- Font scaling.
- Focus visibility.
- Reduced motion.
- Touch-target sizing.
- Host integration.

The plugin's theme remains the normal default.

## 16. Accessibility

Accessibility is semantic and toolkit-level.

The UI Worker never manipulates DOM/ARIA directly.

```text
ui.json / Component tree
        ↓
semantic accessibility tree
        ↓
WebVST UI protocol
        ↓
host main thread
        ↓
DOM / ARIA projection
```

Standard controls provide default roles and values automatically.

Examples:

- Knob/Slider → slider semantics.
- Toggle → switch/check semantics.
- Button → button semantics.
- ComboBox → combobox semantics.
- Meter → meter semantics.

Custom components may expose semantic nodes through the framework API.

The host owns:

- Browser ARIA implementation.
- Screen-reader projection.
- Browser-specific keyboard integration.
- Focus indicators.
- Reduced-motion settings.
- High-contrast adaptation.

## 17. Input and event model

Browser input is normalized before it reaches plugin UI code.

The base input model includes:

### Pointer

- Move.
- Down.
- Up.
- Cancel.
- Position.
- Button/buttons.
- Pointer ID.
- Pointer type.
- Pressure when available.
- Modifiers.

### Keyboard

- Key.
- Physical code.
- Repeat.
- Modifiers.

### Wheel

- Horizontal/vertical deltas.
- Delta mode.

### Focus

- Gained.
- Lost.

The component runtime implements:

- Hit testing.
- Capture.
- Target.
- Bubble propagation.
- Hover tracking.
- Pointer capture.
- Drag thresholds.
- Double-click recognition.
- Focus traversal.

Standard parameter controls automatically translate interaction into automation gestures:

```text
pointer down  → beginGesture(parameter)
drag/change   → setParameter(parameter, value)
pointer up    → endGesture(parameter)
```

## 18. Fonts and text

The framework supports:

- Semantic host fonts for common UI roles.
- Optional plugin-bundled fonts for branded/exact typography.

Plugins do not call browser font APIs.

The host/runtime owns:

- Font loading.
- Fallback.
- Shaping.
- Glyph caching.
- DPI scaling.
- Text measurement.
- Rendering.

The C++ API exposes font handles and abstract text measurement/drawing operations.

Exact identical glyph metrics across all hosts are not required in the first UI version. Layout must tolerate normal differences between compatible font engines.

## 19. Asset model

Plugins access assets through logical package-scoped IDs, never raw URLs or filesystem paths.

Example manifest fragment:

```json
{
  "assets": {
    "logo": {
      "path": "assets/logo.png",
      "type": "image"
    },
    "display": {
      "path": "assets/display.woff2",
      "type": "font"
    }
  }
}
```

The framework exposes opaque asset handles.

Render assets such as images, SVG/vector assets, and fonts are decoded/cached host-side where appropriate.

Plugin-defined binary assets remain readable as bytes through constrained APIs.

Benefits:

- Shared decoding across editor instances.
- Centralized caching.
- No network authority.
- No path traversal.
- Deterministic cleanup.
- Renderer-native resource handles.
- Lower duplicate memory use.

The host defines resource budgets for:

- Individual asset size.
- Total editor asset memory.
- Decoded image dimensions.
- Font count.
- Display-list size.
- UI Worker memory.

Budget violations are recoverable UI errors and never affect DSP.

## 20. Scheduling and visualization

Rendering is invalidation-driven rather than an unconditional frame loop.

```text
input / parameter / animation
          ↓
component state changes
          ↓
invalidate
          ↓
requestFrame
          ↓
host frame scheduler
          ↓
UI builds display list
          ↓
host renders
```

The host controls actual cadence.

Ordinary controls are event-driven.

Animations use host-scheduled frame callbacks.

High-rate visualization uses a separate lossy data path, ideally SharedArrayBuffer when available, with MessagePort fallback where necessary.

Visualization data is sampled at render time. It may drop intermediate samples.

Parameter/automation events remain ordered and reliable.

The host may throttle or suspend hidden/background editors without affecting plugin correctness.

## 21. Capabilities and compatibility

The UI contract consists of a small required core plus negotiated optional capabilities.

Illustrative capabilities:

```text
webvst-ui-core/1
graphics.paths/1
graphics.gradients/1
graphics.images/1
graphics.layers/1
input.keyboard/1
input.pointer-pressure/1
accessibility/1
assets.fonts/1
host.clipboard/1
host.file-picker/1
renderer.webgpu-effects/1
```

Packages declare required and optional capabilities.

At editor creation, the host negotiates a session capability set.

If a required custom-UI capability is unavailable, the host does not instantiate that custom UI and falls back to `ui.json`.

Missing optional capabilities degrade locally.

Capabilities are explicit authority. A UI receives only negotiated services.

## 22. Failure containment

Failure in the UI must never stop audio processing.

Required recovery behavior:

- Invalid custom UI → use declarative UI.
- Missing custom capability → use declarative UI.
- `ui.wasm` trap → terminate worker and use declarative UI.
- UI worker timeout → terminate worker and use declarative UI.
- Invalid display list → discard the frame and emit a diagnostic.
- Missing asset → placeholder/recoverable diagnostic where possible.
- Invalid declarative UI → generate generic parameter editor.
- Hidden editor → may suspend rendering while DSP continues.

The host must be able to destroy and recreate an editor without recreating the DSP instance.

## 23. Module structure

The implementation should favor small one-purpose libraries.

Illustrative decomposition:

```text
webvst-ui-core
  Component
  geometry
  events
  focus
  invalidation

webvst-ui-layout
  row
  column
  grid
  constraints

webvst-ui-graphics
  Graphics
  Path
  Paint
  Font
  Image
  DisplayList

webvst-ui-controls
  Knob
  Slider
  Toggle
  ComboBox
  Button
  XYPad
  Meter

webvst-ui-parameters
  ParameterAttachment
  Gesture
  Formatter

webvst-ui-accessibility
  semantic tree

webvst-ui-declarative
  ui.json parser
  normalized component graph

webvst-ui-runtime
  C ABI bridge
  worker runtime

webvst-ui-host
  TypeScript host runtime
  renderer adapters

webvst-ui-juce-compat
  optional JUCE migration helpers
```

Dependencies point downward.

Renderers depend on the display-list contract. The core never depends on Canvas, DOM, WebGPU, React, or a particular host application.

## 24. JUCE migration strategy

A major success criterion is that conventional JUCE plugins are inexpensive to port.

Target conceptual mappings:

```text
juce::Component                  → webvst::Component
juce::Graphics                   → webvst::Graphics
juce::Slider                     → webvst::Slider / Knob
juce::Button                     → webvst::Button
juce::ComboBox                   → webvst::ComboBox
juce::Label                      → webvst::Label
setBounds                        → setBounds
resized                          → resized
paint(Graphics&)                 → paint(Graphics&)
mouseDown/mouseDrag/mouseUp      → normalized component events
parameter attachments            → webvst::ParameterAttachment
```

Expected migration difficulty:

- Standard JUCE controls and custom `paint()`: mostly mechanical adaptation.
- Large custom component hierarchies: moderate adaptation with familiar structure.
- Heavy `LookAndFeel`: targeted translation into framework styles/tokens.
- JUCE OpenGL: renderer/custom-widget work.
- Native windows, embedded web views, OS drag/drop, device APIs, native menus, or platform services: explicit host-capability adaptation.

The project may provide `webvst-ui-juce-compat` as a migration layer for common types and patterns.

It should not attempt full JUCE implementation compatibility.

## 25. Research basis

The design deliberately borrows proven architectural ideas rather than copying one framework wholesale:

- JUCE demonstrates useful separation between retained components, platform peers, low-level graphics, events, and accessibility.
- iPlug2's current web architecture demonstrates split DSP/UI WASM, AudioWorklet DSP, main-thread UI, message-based parameter flow, SharedArrayBuffer for visualization, and generated controls for headless plugins.
- Web Audio Modules demonstrates a web-plugin model where GUI creation is independent from the audio node and parameter metadata can drive generic controls.
- Faust demonstrates the utility of structured UI/parameter metadata as an intermediate representation.
- WebVST's existing package/ABI design demonstrates the value of generic host code, strict sandboxing, manifest verification, deterministic packaging, and an ABI read from executable plugin metadata rather than host-specific plugin cases.

This design keeps those useful principles while preserving WebVST's existing security and package boundaries.

## 26. Testing and conformance

Most framework behavior must be testable without a browser or GPU.

### Core tests

Cover:

- Component hierarchy.
- Bounds/layout.
- Hit testing.
- Focus.
- Capture/target/bubble event propagation.
- Invalidation.
- Parameter attachment.
- Gesture lifecycle.
- Accessibility semantics.

### Display-list tests

Render components into deterministic display-list commands and inspect:

- Geometry.
- Text commands.
- Clips.
- Transforms.
- Resource references.
- Invalid command rejection.

### Host conformance

Cover:

- ABI lifecycle.
- Capability negotiation.
- Worker startup/shutdown.
- Worker trap and timeout recovery.
- Invalid `ui.json`.
- Invalid `ui.wasm`.
- Asset limits.
- Display-list validation.
- Accessibility projection.
- Fallback behavior.
- Multiple editor instances.
- Editor recreation without DSP recreation.

### Visual/browser tests

Use representative editors for:

- Canvas2D rendering.
- Input scenarios.
- Automation scenarios.
- DPI/resizing.
- Accessibility behavior.
- Screenshot regression where useful.

A future WebGPU renderer must pass the same renderer-independent display-list semantic tests as Canvas2D.

A future Rust/Zig SDK must pass the same ABI conformance tests as the C++ SDK.

## 27. Diagnostics

Diagnostics are structured rather than free-form console output.

A diagnostic contains:

- Severity.
- Subsystem.
- Package/plugin identity.
- Editor instance.
- Component ID when relevant.
- Stable error code.
- Human-readable message.
- Optional source location where available.

Illustrative error codes:

```text
UI_LAYOUT_OVERFLOW
UI_UNKNOWN_COMPONENT
UI_BAD_PARAMETER_BINDING
UI_ASSET_MISSING
UI_ASSET_BUDGET_EXCEEDED
UI_DISPLAY_LIST_INVALID
UI_WORKER_TRAP
UI_WORKER_TIMEOUT
UI_CAPABILITY_MISSING
UI_ACCESSIBILITY_INVALID
```

Developer hosts may expose detailed diagnostics. End-user hosts may recover silently to the declarative or generated editor when safe.

## 28. Security properties

Custom UI code receives no ambient authority.

By default it cannot:

- Fetch network resources.
- Access the filesystem.
- Execute package JavaScript.
- Access the DOM.
- Access browser globals.
- Open arbitrary windows.
- Reach the AudioWorklet directly.
- Modify host state except through explicit UI capabilities.

All host services are explicit negotiated capabilities.

The host validates:

- Package paths.
- Asset declarations.
- UI schema.
- UI ABI requirements.
- Imports.
- Display-list commands.
- Resource budgets.

This follows the existing WebVST principle that package code is untrusted and host behavior remains generic.

## 29. Initial implementation boundary

The first implementation should prove the architecture with the smallest coherent subset:

1. A new UI package/schema extension independent from DSP ABI v1.
2. Declarative `ui.json` with stable component IDs.
3. Host-generated fallback editor.
4. Core controls: label, button, toggle, slider/knob, combo.
5. Row/column/grid layout.
6. Host-authoritative parameter binding and automation gestures.
7. Semantic accessibility tree.
8. Renderer-neutral display list.
9. Canvas2D backend.
10. Normalized pointer/keyboard/focus input.
11. Package image/font assets.
12. Worker-hosted `ui.wasm`.
13. C ABI plus C++ wrapper SDK.
14. Capability negotiation and failure fallback.
15. Conformance harness.
16. One small native-style test plugin and one nontrivial synth/editor example.
17. A JUCE-portability example demonstrating a conventional component/paint/attachment migration.

WebGPU, broad JUCE compatibility, advanced host services, and the WebAssembly Component Model remain later extensions.

## 30. Success criteria

The design is successful when all of the following are true:

- A plugin with no UI assets receives a usable generated editor.
- A normal plugin can build a polished editor using only `ui.json`.
- A custom C++ editor can be written without manual Worker, browser, rendering, parameter, accessibility, or automation plumbing.
- Common JUCE component/editor patterns map mechanically onto the C++ SDK.
- A custom UI crash or hang does not interrupt DSP.
- The same custom UI can run in Worker mode and an inline conformance harness.
- Canvas2D can be replaced by another renderer without changing plugin component code.
- Host applications do not contain plugin-specific UI behavior.
- Parameters and automation cannot diverge between UI and DSP.
- Standard controls expose accessibility automatically.
- Multiple editors can share decoded render assets without duplicating plugin state.
- Hidden editors can be throttled or suspended safely.
- The UI ABI can evolve independently of the frozen DSP ABI.
- A future WIT/Component Model representation can be introduced without redesigning the author-facing framework.

## 31. Architectural decisions summary

The approved design choices are:

- Hybrid declarative + optional custom WASM UI.
- Stable language-neutral C ABI with C++ SDK wrapper.
- WIT/Component Model compatibility as a future path.
- Retained component tree with immediate `Graphics` drawing.
- Renderer-neutral display lists.
- Canvas2D first; WebGPU later.
- Complete `ui.json` fallback.
- Custom `ui.wasm` may augment or replace the root.
- Host is authoritative for parameters and automation.
- Worker-first custom UI execution with inline-compatible ABI.
- Tree-shaped `ui.json`, normalized ID graph internally.
- Small deterministic layout engine, not CSS.
- Plugin-default semantic theming with constrained host overrides.
- Host-projected semantic accessibility.
- Normalized input with capture/target/bubble propagation.
- Semantic host fonts plus optional bundled fonts.
- Package-scoped logical asset handles and host caching.
- Invalidation-driven rendering.
- Separate lossy path for high-rate visualization.
- Small required ABI plus negotiated capabilities.
- Independent package/DSP/UI versioning.
- Mandatory graceful fallback.
- Layered modules around a tiny core.
- JUCE portability and low boilerplate are explicit success criteria.
- Conformance and headless testing are part of the contract, not afterthoughts.
