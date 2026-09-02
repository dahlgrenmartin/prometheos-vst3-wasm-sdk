# Security model

WebVST packages are untrusted inputs. The package verifier and ABI probe are
validation layers, not a replacement for browser/Web Worker/AudioWorklet
isolation or an operating-system sandbox.

## Archive boundary

ZIP parsing validates central and local headers, UTF-8 names, CRCs, compression
methods, offsets, duplicate names, symlink metadata, and all declared sizes
before exposing bytes. Limits are 4,096 entries, 512 MiB compressed, 512 MiB
per expanded entry, and 1 GiB expanded total. ZIP64 and encryption are not
accepted. Relative POSIX paths prevent traversal and drive-letter escapes;
JavaScript sidecars are rejected. Manifest hashes bind the module and declared
artifacts to the package metadata.

## WebAssembly boundary

The probe compiles the module, checks ABI version 1, and resolves each export
as it is needed while reading discovery metadata; a missing export fails at the
corresponding probe operation. The runtime package consumer separately
requires each instance-operation export when it is called. Imports outside the
fixed AudioWorklet-compatible allowlist are rejected. The environment supplies
deterministic clock, zero-filled randomness, bounded environment data, and no
host object access. Consumers must instantiate each plugin in a fresh
WebAssembly instance and memory, and must call `_initialize` before ABI calls.
The ABI does not load native `.vst3` binaries.

The allowlist is deliberately small: `env.__cxa_rethrow`,
`env.emscripten_notify_memory_growth`, and the WASI preview-1 calls
`clock_time_get`, `fd_read`, `fd_write`, `environ_get`, `environ_sizes_get`,
and `random_get`. A host may impose stricter policy or deny packages that need
any optional import.

## Runtime boundary

The adapter bounds class and parameter discovery, process blocks (128 frames),
event and parameter queues (64 entries/points), handle slots (32), strings, and
state envelopes. It rejects invalid normalized values, notes outside 0..127,
stale handles, malformed state lengths, and unsupported VST3 bus layouts.
State is opaque component/controller data inside the checked v1 `WVST` envelope;
hosts should treat it as untrusted and retain the same size limits when storing
it.

No ABI promise is made for GUI code, arbitrary host services, filesystem access,
network access, multiple buses, sample64, or native plugin loading. A host that
needs those capabilities must use a separate, reviewed interface.

## Provenance and release gate

SDK-owned source is MIT-licensed and the exact third-party VST3 SDK pin and
notice are retained in `NOTICE.md`. This repository contains no third-party
plugin implementation. A naming/trademark review is still required before any
public release or tag; no public tag is created by the build or CI workflow.
