# WebVST ABI v1

This document is the normative reference for `webvst-vst3-wasm-1`. The
C header at `include/webvst/webvst.h` is the machine-readable declaration;
this page explains its ownership and behavior. ABI v1 is a C ABI intended to
be called from a standalone WebAssembly module.

## Scalar and buffer conventions

`uint32_t`, `int32_t`, `float`, and `double` have their C meanings. Strings are
UTF-8 byte sequences without a terminating NUL. A `*_size` function returns the
number of bytes required. A matching `*_write` function writes exactly that
many bytes and returns `WEBVST_OK`; it does not append a NUL. A null destination,
or a capacity smaller than the required size, returns
`WEBVST_ERROR_BUFFER_TOO_SMALL`. Invalid indexes return `WEBVST_ERROR_ARGUMENT` for
write operations and zero from size/value operations.

All normalized values are finite `float` values in the closed interval [0, 1].
Audio is 32-bit floating-point, interleaved stereo (left, right) with one
sample pair per frame. Samples are passed in the host's normalized floating
point convention; the adapter does not rescale, clamp, or convert them.

## Constants and result codes

`WEBVST_ABI_VERSION` and `webvst_abi_version()` are `1`. The maximum process block
is `WEBVST_MAX_PROCESS_FRAMES == 128`.

The result values are stable:

| Name | Value | Meaning |
| --- | ---: | --- |
| `WEBVST_OK` | 0 | Operation succeeded. |
| `WEBVST_ERROR_ARGUMENT` | -1 | Invalid index, value, pointer, or state envelope. |
| `WEBVST_ERROR_HANDLE` | -2 | Handle is zero, stale, or not owned by this module. |
| `WEBVST_ERROR_FRAME_COUNT` | -3 | Frames exceed the instance's configured maximum or 128. |
| `WEBVST_ERROR_QUEUE_FULL` | -4 | The pending event/parameter queue has no capacity. |
| `WEBVST_ERROR_PLUGIN` | -5 | The wrapped VST3 component/controller rejected an operation. |
| `WEBVST_ERROR_BUFFER_TOO_SMALL` | -6 | Output capacity is insufficient (or its pointer is null). |

`WEBVST_PARAMETER_AUTOMATABLE` is bit 0 and
`WEBVST_PARAMETER_READ_ONLY` is bit 1. Only those two bits are exposed by the
adapter.

## Complete exported symbol reference

### Discovery and metadata

```c
uint32_t webvst_abi_version(void);
uint32_t webvst_class_count(void);
uint32_t webvst_class_uid_size(uint32_t class_index);
int32_t webvst_class_uid_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t webvst_class_name_size(uint32_t class_index);
int32_t webvst_class_name_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t webvst_class_vendor_size(uint32_t class_index);
int32_t webvst_class_vendor_write(uint32_t class_index, char* dst, uint32_t capacity);
uint32_t webvst_class_kind(uint32_t class_index);
uint32_t webvst_class_param_count(uint32_t class_index);
uint32_t webvst_class_param_id(uint32_t class_index, uint32_t parameter_index);
uint32_t webvst_class_param_flags(uint32_t class_index, uint32_t parameter_index);
uint32_t webvst_class_param_step_count(uint32_t class_index, uint32_t parameter_index);
float webvst_class_param_default(uint32_t class_index, uint32_t parameter_index);
uint32_t webvst_class_param_title_size(uint32_t class_index, uint32_t parameter_index);
int32_t webvst_class_param_title_write(uint32_t class_index, uint32_t parameter_index, char* dst, uint32_t capacity);
uint32_t webvst_class_param_value_text_size(uint32_t class_index, uint32_t parameter_index, float normalized);
int32_t webvst_class_param_value_text_write(uint32_t class_index, uint32_t parameter_index, float normalized, char* dst, uint32_t capacity);
```

Classes are the audio-effect classes returned by the VST3 factory, in factory
order; non-audio classes are omitted. `webvst_class_uid_*` exposes a 16-byte
class UID as exactly 32 lowercase hexadecimal bytes. `webvst_class_kind` returns
`1` for an Instrument category and `0` for an Effect category. Parameter indexes
are in the wrapped controller's order. `webvst_class_param_default` is the VST3
normalized default. Titles and value text are converted from UTF-16 to UTF-8;
an invalid UTF-16 sequence is a plugin error for the write operation and yields
size zero for the size operation.

### Instance lifetime and processing

```c
uint32_t webvst_create(uint32_t class_index, double sample_rate, uint32_t max_frames);
void webvst_destroy(uint32_t handle);
int32_t webvst_reset(uint32_t handle);
int32_t webvst_process(uint32_t handle, const float* input, float* output, uint32_t frames);
int32_t webvst_note_on(uint32_t handle, int32_t note, float velocity);
int32_t webvst_note_off(uint32_t handle, int32_t note);
float webvst_param_get(uint32_t handle, uint32_t parameter_id);
int32_t webvst_param_set(uint32_t handle, uint32_t parameter_id, float normalized);
```

`webvst_create` requires a finite positive sample rate and `1 <= max_frames <=
128`; it returns zero on any VST3 startup failure or when all 32 slots are in
use. A nonzero handle combines a slot index and generation. Destroy releases
the component and controller, and invalidates the handle; generation checking
means a stale handle cannot address a later instance. Destroying an invalid
handle is a no-op. `webvst_reset` restarts VST3 processing and returns a plugin
error if either transition fails.

`webvst_process` accepts zero through `max_frames` frames. `output` is required;
`input == NULL` supplies silence (the normal instrument case). Input and output
are interleaved `[left0, right0, left1, right1, ...]`. The adapter configures
the VST3 processor for realtime, stereo, 32-bit samples, and one main output
bus. A wrapped effect may have one main stereo input; an instrument has no
input bus. Output is copied only after successful processing. Pending events and
parameter changes are cleared after every process attempt, including a plugin
failure; callers must requeue changes they want retried.

`webvst_note_on` and `webvst_note_off` queue a VST3 event at sample offset zero on
bus 0, channel 0, with note ID -1. Notes must be 0..127 and note-on velocity
must be finite in [0, 1]. Note-off uses velocity zero. The fixed event queue
holds 64 events and reports `WEBVST_ERROR_QUEUE_FULL` when full.

`webvst_param_set` accepts a known controller parameter and a finite normalized
value. Changes are grouped by parameter ID, applied to the controller, and
queued at sample offset zero for the next process attempt. The fixed queue
permits at most 64 total points and 64 parameter IDs; a full queue is atomic
and does not call the controller. Pending changes are cleared after that
attempt, even when processing returns a plugin error. `webvst_param_get` returns
the controller's normalized value (or zero when no controller exists).

### State

```c
uint32_t webvst_state_size(uint32_t handle);
int32_t webvst_state_write(uint32_t handle, uint8_t* dst, uint32_t capacity);
int32_t webvst_state_load(uint32_t handle, const uint8_t* src, uint32_t size);
```

State is a little-endian, fixed envelope. Its first 16 bytes are four `uint32_t`
values: magic `0x54535657` (the bytes `WVST`), version `1`, component-state
byte length, and controller-state byte length. The component bytes follow,
then the controller bytes. The controller length is zero when the component
uses a combined controller. `webvst_state_size` computes this envelope; write
requires the complete capacity. Load rejects null/short input, an unknown
magic or version, and any length that does not exactly consume the input before
calling VST3. A VST3 state failure returns `WEBVST_ERROR_PLUGIN`; malformed input
returns `WEBVST_ERROR_ARGUMENT`.

## Deliberate limits

Only one main stereo output and, for effects, one main stereo input are
supported. GUI/editor interfaces, multiple buses, non-stereo buses, 64-bit
sample processing, arbitrary host services, and host-created plugin instances
are unsupported. The ABI loads a standalone WebAssembly module and does not
load native `.vst3` binaries. The module must use only the package consumer's
documented import allowlist; see [the package format](package-format-v1.md).
