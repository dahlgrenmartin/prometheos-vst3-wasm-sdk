import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { validateManifest } from "./manifest.js";
import { probeWasm, PVST_PARAMETER_AUTOMATABLE, PVST_PARAMETER_READ_ONLY } from "./probe.js";
import { WEBVST_ABI, type BuzzParameter, type ProbedParameter, type WebVstManifestV1 } from "./types.js";

export const ARCHIVE_LIMITS = {
  maxEntries: 4_096,
  maxCompressedBytes: 512 * 1024 * 1024,
  maxExpandedEntryBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
} as const;

const FIXED_TIME = 0;
const FIXED_DATE = 0x21;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type ArchiveEntry = {
  name: string;
  data: Uint8Array;
  compressedSize: number;
  expandedSize: number;
  method: number;
  unixMode: number;
};

export interface WebVstInspection {
  packageId: string;
  version: string;
  archiveSha256: string;
  abi: typeof WEBVST_ABI;
  classes: Array<{ classUid: string; name: string; kind: "instrument" | "effect"; parameterCount: number }>;
  artifacts: Array<{ id: string; path: string; sha256: string }>;
}

function fail(message: string): never {
  throw new Error(`WebVST archive: ${message}`);
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function safePath(name: string): void {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    fail(`unsafe entry path ${name}`);
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) fail(`unsafe entry path ${name}`);
}

function decodeName(bytes: Uint8Array): string {
  try { return textDecoder.decode(bytes); } catch { fail("entry name is not valid UTF-8"); }
}

function crc32(data: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb8_8320 : 0);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

function findEndOfCentralDirectory(view: Buffer): number {
  const start = Math.max(0, view.length - 65_557);
  for (let offset = view.length - 22; offset >= start; offset -= 1) {
    if (view.readUInt32LE(offset) === 0x0605_4b50) return offset;
  }
  fail("missing ZIP end-of-central-directory record");
}

function parseArchive(bytes: Uint8Array): ArchiveEntry[] {
  if (bytes.byteLength > ARCHIVE_LIMITS.maxCompressedBytes) fail("compressed archive exceeds 512 MiB");
  const view = Buffer.from(bytes);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.readUInt16LE(eocd + 10);
  const centralSize = view.readUInt32LE(eocd + 12);
  const centralOffset = view.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) fail("ZIP64 archives are not supported");
  if (count > ARCHIVE_LIMITS.maxEntries) fail(`entry count exceeds ${ARCHIVE_LIMITS.maxEntries.toLocaleString("en-US")}`);
  if (centralOffset > view.length || centralSize > view.length - centralOffset || centralOffset + centralSize > eocd) fail("invalid central directory bounds");

  // Check all declared sizes before touching any entry payload. This keeps a
  // large aggregate expansion from being discovered only after decompression.
  let declaredCompressed = 0;
  let declaredExpanded = 0;
  let declaredOffset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (declaredOffset > view.length - 46 || view.readUInt32LE(declaredOffset) !== 0x0201_4b50) fail("invalid central directory entry");
    const compressedSize = view.readUInt32LE(declaredOffset + 20);
    const expandedSize = view.readUInt32LE(declaredOffset + 24);
    const nameLength = view.readUInt16LE(declaredOffset + 28);
    const extraLength = view.readUInt16LE(declaredOffset + 30);
    const commentLength = view.readUInt16LE(declaredOffset + 32);
    if (compressedSize === 0xffff_ffff || expandedSize === 0xffff_ffff) fail("ZIP64 entries are not supported");
    if (compressedSize > ARCHIVE_LIMITS.maxCompressedBytes - declaredCompressed) fail("compressed content exceeds 512 MiB");
    if (expandedSize > ARCHIVE_LIMITS.maxExpandedEntryBytes) fail("expanded entry exceeds 512 MiB");
    if (expandedSize > ARCHIVE_LIMITS.maxExpandedBytes - declaredExpanded) fail("total expanded content exceeds 1 GiB");
    declaredCompressed += compressedSize;
    declaredExpanded += expandedSize;
    declaredOffset += 46 + nameLength + extraLength + commentLength;
  }

  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalCompressed = 0;
  let totalExpanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset > view.length - 46 || view.readUInt32LE(offset) !== 0x0201_4b50) fail("invalid central directory entry");
    const flags = view.readUInt16LE(offset + 8);
    const method = view.readUInt16LE(offset + 10);
    const compressedSize = view.readUInt32LE(offset + 20);
    const expandedSize = view.readUInt32LE(offset + 24);
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const externalAttributes = view.readUInt32LE(offset + 38);
    const localOffset = view.readUInt32LE(offset + 42);
    if (compressedSize === 0xffff_ffff || expandedSize === 0xffff_ffff || localOffset === 0xffff_ffff) fail("ZIP64 entries are not supported");
    if (flags & 1) fail("encrypted ZIP entries are not supported");
    if (offset + 46 + nameLength + extraLength + commentLength > view.length) fail("truncated central directory entry");
    const name = decodeName(view.subarray(offset + 46, offset + 46 + nameLength));
    safePath(name);
    if (names.has(name)) fail(`duplicate entry name ${name}`);
    names.add(name);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) fail(`symlink entry ${name} is not allowed`);
    if (compressedSize > ARCHIVE_LIMITS.maxCompressedBytes - totalCompressed) fail("compressed content exceeds 512 MiB");
    if (expandedSize > ARCHIVE_LIMITS.maxExpandedEntryBytes) fail("expanded entry exceeds 512 MiB");
    if (expandedSize > ARCHIVE_LIMITS.maxExpandedBytes - totalExpanded) fail("total expanded content exceeds 1 GiB");
    totalCompressed += compressedSize;
    totalExpanded += expandedSize;
    if (localOffset > view.length - 30 || view.readUInt32LE(localOffset) !== 0x0403_4b50) fail(`invalid local entry ${name}`);
    const localNameLength = view.readUInt16LE(localOffset + 26);
    const localExtraLength = view.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + localNameLength + localExtraLength > view.length) fail(`truncated local entry ${name}`);
    const localName = decodeName(view.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    safePath(localName);
    if (localName !== name) fail(`local-header path mismatch for ${name}`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset > view.length || compressedSize > view.length - dataOffset) fail(`truncated entry ${name}`);
    const compressed = view.subarray(dataOffset, dataOffset + compressedSize);
    let data: Uint8Array;
    try {
      data = method === 0 ? new Uint8Array(compressed) : method === 8 ? new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(1, expandedSize) })) : fail(`unsupported compression method for ${name}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("WebVST archive:")) throw error;
      fail(`cannot decompress entry ${name}`);
    }
    if (data.byteLength !== expandedSize) fail(`expanded size mismatch for ${name}`);
    if (view.readUInt32LE(offset + 16) !== crc32(data)) fail(`CRC mismatch for ${name}`);
    entries.push({ name, data, compressedSize, expandedSize, method, unixMode });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function manifestPath(manifest: WebVstManifestV1, path: string, label: string): void {
  try { safePath(path); } catch { fail(`${label} has unsafe path ${path}`); }
  if (path === "plugin.json") fail(`${label} cannot be plugin.json`);
}

function expectedPath(name: string, manifest: WebVstManifestV1): boolean {
  if (name === "plugin.json" || name === manifest.module.path) return true;
  if ((manifest.artifacts ?? []).some((artifact) => artifact.path === name)) return true;
  return ["resources/", "presets/", "licenses/"].some((prefix) => name.startsWith(prefix));
}

function executableJavaScript(name: string): boolean {
  return /\.(?:js|mjs|cjs)$/i.test(name);
}

function artifactRootAllowed(role: "preset" | "resource", path: string): boolean {
  return path.startsWith(`${role === "resource" ? "resources" : "presets"}/`);
}

function parseManifest(entries: ArchiveEntry[]): { manifest: WebVstManifestV1; byName: Map<string, Uint8Array> } {
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  const manifestBytes = byName.get("plugin.json");
  if (!manifestBytes) fail("missing plugin.json");
  let parsed: unknown;
  try { parsed = JSON.parse(textDecoder.decode(manifestBytes)); } catch { fail("plugin.json is not valid UTF-8 JSON"); }
  const manifest = validateManifest(parsed);
  manifestPath(manifest, manifest.module.path, "module path");
  for (const artifact of manifest.artifacts ?? []) {
    manifestPath(manifest, artifact.path, `artifact ${artifact.id} path`);
    if (!artifactRootAllowed(artifact.role, artifact.path)) fail(`artifact ${artifact.id} path is outside its ${artifact.role} root`);
  }
  if (!byName.has(manifest.module.path)) fail(`module is missing: ${manifest.module.path}`);
  for (const artifact of manifest.artifacts ?? []) if (!byName.has(artifact.path)) fail(`artifact is missing: ${artifact.path}`);
  const artifactsById = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  for (const manifestClass of manifest.classes) {
    for (const category of manifestClass.programs?.categories ?? []) {
      for (const program of category.entries) {
        const artifact = artifactsById.get(program.artifactId);
        if (!artifact) fail(`program artifact is missing: ${program.artifactId}`);
        const artifactBytes = byName.get(artifact.path)!;
        if (program.offset > artifactBytes.byteLength || program.size > artifactBytes.byteLength - program.offset) {
          fail(`program range exceeds artifact ${program.artifactId}`);
        }
      }
    }
  }
  for (const name of byName.keys()) {
    if (executableJavaScript(name)) fail(`executable JavaScript sidecar is not allowed: ${name}`);
    if (!expectedPath(name, manifest)) fail(`unexpected entry ${name}`);
  }
  return { manifest, byName };
}

function expectedBuzzParameter(parameter: ProbedParameter): BuzzParameter {
  const discrete = parameter.stepCount > 0;
  const maxValue = discrete ? parameter.stepCount : 65_534;
  const type = discrete && parameter.stepCount <= 254 ? "byte" : "word";
  const noValue = type === "byte" ? 255 : 65_535;
  const defValue = Math.round(Math.min(1, Math.max(0, parameter.defaultValue)) * maxValue);
  return {
    type,
    name: parameter.title,
    description: parameter.title,
    minValue: 0,
    maxValue,
    noValue,
    defValue,
    flags: 1,
    ...(discrete ? { display: { choices: parameter.displayValues } } : {}),
  };
}

function verifyParameterDescriptor(classUid: string, parameter: ProbedParameter, buzz: BuzzParameter): void {
  const expected = expectedBuzzParameter(parameter);
  if (buzz.type !== expected.type ||
      buzz.minValue !== expected.minValue || buzz.maxValue !== expected.maxValue || buzz.noValue !== expected.noValue ||
      buzz.defValue !== expected.defValue || buzz.flags !== expected.flags) {
    fail(`parameter mismatch for ${classUid}:${parameter.parameterId}`);
  }
  if (expected.display?.choices && JSON.stringify(buzz.display?.choices) !== JSON.stringify(expected.display.choices)) {
    fail(`parameter display choices mismatch for ${classUid}:${parameter.parameterId}`);
  }
}

async function verifyEntries(entries: ArchiveEntry[]): Promise<{ manifest: WebVstManifestV1; byName: Map<string, Uint8Array> }> {
  const parsed = parseManifest(entries);
  const { manifest, byName } = parsed;
  const module = byName.get(manifest.module.path)!;
  if (sha256(module) !== manifest.module.sha256) fail(`hash mismatch for ${manifest.module.path}`);
  for (const artifact of manifest.artifacts ?? []) {
    if (sha256(byName.get(artifact.path)!) !== artifact.sha256) fail(`hash mismatch for ${artifact.path}`);
  }
  if (manifest.abi !== WEBVST_ABI) fail(`ABI mismatch: ${manifest.abi}`);
  const probed = await probeWasm(module);
  if (probed.length !== manifest.classes.length) fail("class count mismatch");
  for (let classIndex = 0; classIndex < manifest.classes.length; classIndex += 1) {
    const expected = manifest.classes[classIndex];
    const actual = probed[classIndex];
    if (expected.classUid !== actual.classUid || expected.name !== actual.name || expected.vendor !== actual.vendor || expected.kind !== actual.kind) fail(`class mismatch for ${expected.classUid}`);
    const parameterIds = new Set(actual.parameters.map((parameter) => parameter.parameterId));
    for (const parameter of expected.exposedParameters) {
      const actualParameter = actual.parameters.find((candidate) => candidate.parameterId === parameter.parameterId);
      if (!actualParameter) fail(`parameter mismatch for ${expected.classUid}:${parameter.parameterId}`);
      verifyParameterDescriptor(expected.classUid, actualParameter, parameter.buzz);
    }
    if (new Set(expected.exposedParameters.map((parameter) => parameter.parameterId)).size !== expected.exposedParameters.length) fail(`duplicate exposed parameter for ${expected.classUid}`);
    for (const parameter of actual.parameters) {
      const exposed = expected.exposedParameters.some((candidate) => candidate.parameterId === parameter.parameterId);
      if (exposed && ((parameter.flags & PVST_PARAMETER_AUTOMATABLE) === 0 || (parameter.flags & PVST_PARAMETER_READ_ONLY) !== 0)) fail(`parameter mismatch for ${expected.classUid}:${parameter.parameterId}`);
    }
  }
  return parsed;
}

function zipArchive(files: Map<string, Uint8Array>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of [...files.keys()].sort()) {
    const data = Buffer.from(files.get(name)!);
    const compressed = deflateRawSync(data, { level: 6 });
    const nameBytes = Buffer.from(name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x0403_4b50, 0);
    localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(0x800, 6); localHeader.writeUInt16LE(8, 8); localHeader.writeUInt16LE(FIXED_TIME, 10); localHeader.writeUInt16LE(FIXED_DATE, 12);
    localHeader.writeUInt32LE(crc32(data), 14); localHeader.writeUInt32LE(compressed.length, 18); localHeader.writeUInt32LE(data.length, 22); localHeader.writeUInt16LE(nameBytes.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x0201_4b50, 0); centralHeader.writeUInt16LE(3 << 8, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(0x800, 8); centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(FIXED_TIME, 12); centralHeader.writeUInt16LE(FIXED_DATE, 14); centralHeader.writeUInt32LE(crc32(data), 16); centralHeader.writeUInt32LE(compressed.length, 20); centralHeader.writeUInt32LE(data.length, 24); centralHeader.writeUInt16LE(nameBytes.length, 28); centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); centralHeader.writeUInt32LE(offset, 42);
    local.push(localHeader, nameBytes, compressed); central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  const archive = new Uint8Array(Buffer.concat([...local, centralBytes, end]));
  if (archive.byteLength > ARCHIVE_LIMITS.maxCompressedBytes) fail("compressed archive exceeds 512 MiB");
  return archive;
}

async function collectFiles(root: string, current: string, result: Map<string, Uint8Array>, totals: { expanded: number }): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const relativeName = relative(root, absolute).split("\\").join("/");
    safePath(relativeName);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) fail(`symlink entry ${relativeName} is not allowed`);
    if (info.isDirectory()) await collectFiles(root, absolute, result, totals);
    else if (info.isFile()) {
      if (result.size >= ARCHIVE_LIMITS.maxEntries) fail(`entry count exceeds ${ARCHIVE_LIMITS.maxEntries.toLocaleString("en-US")}`);
      if (info.size > ARCHIVE_LIMITS.maxExpandedEntryBytes) fail("expanded entry exceeds 512 MiB");
      if (info.size > ARCHIVE_LIMITS.maxExpandedBytes - totals.expanded) fail("total expanded content exceeds 1 GiB");
      totals.expanded += info.size;
      const data = new Uint8Array(await readFile(absolute));
      if (data.byteLength > ARCHIVE_LIMITS.maxExpandedEntryBytes) fail("expanded entry exceeds 512 MiB");
      result.set(relativeName, data);
    } else fail(`unsupported staging entry ${relativeName}`);
  }
}

export async function packWebVst(stagingDirectory: string): Promise<Uint8Array> {
  const root = resolve(stagingDirectory);
  const files = new Map<string, Uint8Array>();
  await collectFiles(root, root, files, { expanded: 0 });
  if (files.size > ARCHIVE_LIMITS.maxEntries) fail(`entry count exceeds ${ARCHIVE_LIMITS.maxEntries.toLocaleString("en-US")}`);
  const entries = [...files].map(([name, data]) => ({ name, data, compressedSize: data.byteLength, expandedSize: data.byteLength, method: 0, unixMode: 0 }));
  await verifyEntries(entries);
  return zipArchive(files);
}

export async function verifyWebVst(archive: Uint8Array): Promise<WebVstInspection> {
  const entries = parseArchive(archive);
  const { manifest, byName } = await verifyEntries(entries);
  return {
    packageId: manifest.packageId,
    version: manifest.version,
    archiveSha256: sha256(archive),
    abi: manifest.abi,
    classes: manifest.classes.map((entry) => ({ classUid: entry.classUid, name: entry.name, kind: entry.kind, parameterCount: entry.exposedParameters.length })),
    artifacts: (manifest.artifacts ?? []).map((entry) => ({ id: entry.id, path: entry.path, sha256: sha256(byName.get(entry.path)!) })),
  };
}

export async function inspectWebVst(archive: Uint8Array): Promise<WebVstInspection> {
  return verifyWebVst(archive);
}

export async function writeWebVst(archive: Uint8Array, outputPath: string): Promise<void> {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, archive);
}

export function archiveFileName(archivePath: string): string {
  return basename(archivePath);
}
