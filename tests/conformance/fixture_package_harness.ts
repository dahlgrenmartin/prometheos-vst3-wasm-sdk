import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { validateManifest } from "../../tools/src/manifest.js";
import type { WebVstManifestV1 } from "../../tools/src/types.js";
import { loadFixtureModule, type FixtureModule } from "./package_consumer.js";

export interface FixturePackage extends FixtureModule {
  archiveSha256: string;
  entries: string[];
}

function fail(message: string): never { throw new Error(`WebVST fixture package harness: ${message}`); }

function unpack(archive: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) { end = offset; break; }
  }
  if (end < 0) fail("missing ZIP end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (offset > archive.byteLength - 46 || view.getUint32(offset, true) !== 0x0201_4b50) fail("invalid ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameSize));
    if (files.has(name) || !/^(plugin\.json|plugin\.wasm)$/.test(name)) fail(`unexpected archive entry ${name}`);
    if (localOffset > archive.byteLength - 30 || view.getUint32(localOffset, true) !== 0x0403_4b50) fail(`invalid ZIP local entry ${name}`);
    const localNameSize = view.getUint16(localOffset + 26, true);
    const localExtraSize = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameSize + localExtraSize;
    if (dataOffset > archive.byteLength || compressedSize > archive.byteLength - dataOffset) fail(`truncated ZIP entry ${name}`);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed.slice() : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : fail(`unsupported ZIP method ${method}`);
    if (data.byteLength !== expandedSize) fail(`expanded size mismatch for ${name}`);
    files.set(name, data);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return files;
}

function checkManifest(files: Map<string, Uint8Array>): WebVstManifestV1 {
  if (files.size !== 2 || !files.has("plugin.json") || !files.has("plugin.wasm")) fail("fixture archive must contain only plugin.json and plugin.wasm");
  let manifest: WebVstManifestV1;
  try { manifest = validateManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("plugin.json")!))); }
  catch { fail("invalid plugin.json"); }
  if (manifest.module.path !== "plugin.wasm") fail("fixture manifest module path must be plugin.wasm");
  if (createHash("sha256").update(files.get("plugin.wasm")!).digest("hex") !== manifest.module.sha256) fail("plugin.wasm hash mismatch");
  return manifest;
}

export async function loadFixturePackage(archive: Uint8Array): Promise<FixturePackage> {
  const files = unpack(archive);
  const manifest = checkManifest(files);
  const fixture = await loadFixtureModule(manifest, files.get("plugin.wasm")!);
  return {
    ...fixture,
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
    entries: [...files.keys()].sort(),
  };
}
