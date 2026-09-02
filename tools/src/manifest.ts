import { createHash } from "node:crypto";
import { z } from "zod";
import {
  WEBVST_PARAMETER_AUTOMATABLE,
  WEBVST_PARAMETER_READ_ONLY,
  probeWasm,
} from "./probe.js";
import {
  BUZZ_EXTENSION,
  WEBVST_ABI,
  type AuthorParameterCuration,
  type BuzzParameterExtension,
  type ManifestAuthorConfig,
  type ProbedParameter,
  type WebVstManifestClass,
  type WebVstManifestV1,
  type WebVstParameter,
} from "./types.js";

const PACKAGE_ID = /^(?:[a-z](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
const CLASS_UID = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EXTENSION_NAMESPACE = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
const UINT32 = 0xffff_ffff;
const finiteNumber = z.number().finite();

const presentationDisplaySchema = z.object({
  unit: z.enum(["%", "Hz", "ms", "dB", "ticks"]).optional(),
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  precision: z.number().int().min(0).optional(),
  curve: z.enum(["linear", "exp"]).optional(),
}).strict();

const curationSchema = z.object({
  classUid: z.string().regex(CLASS_UID),
  parameterId: z.number().int().min(0).max(UINT32),
  expose: z.boolean().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  display: presentationDisplaySchema.optional(),
}).strict();

const displaySchema = presentationDisplaySchema.extend({ choices: z.array(z.string()).optional() }).strict();

const buzzExtensionSchema = z.object({
  type: z.enum(["note", "switch", "byte", "word"]),
  minValue: finiteNumber, maxValue: finiteNumber, noValue: finiteNumber, defValue: finiteNumber,
  flags: z.number().int(),
}).strict();

const extensionsSchema = z.object({ buzz: buzzExtensionSchema.optional() })
  .catchall(z.record(z.string(), z.unknown()))
  .refine((value) => Object.keys(value).every((namespace) => EXTENSION_NAMESPACE.test(namespace)),
    "extension namespaces must be lowercase identifiers");

const parameterSchema = z.object({
  parameterId: z.number().int().min(0).max(UINT32),
  name: z.string(),
  description: z.string(),
  flags: z.number().int().min(0).max(UINT32),
  stepCount: z.number().int().min(0).max(UINT32),
  defaultValue: finiteNumber.min(0).max(1),
  display: displaySchema.optional(),
  extensions: extensionsSchema.optional(),
}).strict();
const programSchema = z.object({ name: z.string(), artifactId: z.string(), offset: z.number().int().min(0), size: z.number().int().min(0) }).strict();
const categorySchema = z.object({ name: z.string(), entries: z.array(programSchema) }).strict();
const programsSchema = z.object({ categories: z.array(categorySchema) }).strict();
const classSchema = z.object({
  classUid: z.string().regex(CLASS_UID), name: z.string(), vendor: z.string(), kind: z.enum(["instrument", "effect"]),
  exposedParameters: z.array(parameterSchema), programs: programsSchema.optional(),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), packageId: z.string().regex(PACKAGE_ID), version: z.string().min(1), abi: z.literal(WEBVST_ABI),
  module: z.object({ path: z.string().min(1), sha256: z.string().regex(SHA256) }).strict(),
  classes: z.array(classSchema),
  artifacts: z.array(z.object({ id: z.string(), path: z.string(), sha256: z.string().regex(SHA256), role: z.enum(["preset", "resource"]) }).strict()).optional(),
}).strict();

function fail(message: string): never {
  throw new Error(`WebVST manifest: ${message}`);
}

function assertPackageId(packageId: string): void {
  if (!PACKAGE_ID.test(packageId)) fail("packageId must be a reverse-DNS identifier");
}

function validCuration(value: unknown): AuthorParameterCuration[] {
  const parsed = z.array(curationSchema).safeParse(value ?? []);
  if (!parsed.success) fail(`invalid curation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return parsed.data as AuthorParameterCuration[];
}

export function validateManifest(value: unknown): WebVstManifestV1 {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) fail(`final manifest does not satisfy the strict schema: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const manifest = parsed.data as WebVstManifestV1;
  const classUids = new Set<string>();
  for (const entry of manifest.classes) {
    if (classUids.has(entry.classUid)) fail(`duplicate class UID ${entry.classUid}`);
    classUids.add(entry.classUid);
  }
  const artifactIds = new Set<string>();
  for (const artifact of manifest.artifacts ?? []) {
    if (artifactIds.has(artifact.id)) fail(`duplicate artifact ID ${artifact.id}`);
    artifactIds.add(artifact.id);
  }
  return manifest;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Buzz addresses parameters as integers with a reserved "no value" sentinel, so
 * the normalized ABI value has to be projected onto that model. That projection
 * is host policy, not part of the plugin contract, which is why it lives under a
 * namespaced extension instead of the parameter itself.
 */
export function buzzProjection(parameter: ProbedParameter): BuzzParameterExtension {
  const discrete = parameter.stepCount > 0;
  const maxValue = discrete ? parameter.stepCount : 65_534;
  const type = discrete && parameter.stepCount <= 254 ? "byte" : "word";
  return {
    type,
    minValue: 0,
    maxValue,
    noValue: type === "byte" ? 255 : 65_535,
    defValue: Math.round(clampUnit(parameter.defaultValue) * maxValue),
    flags: 1,
  };
}

export function mapParameter(parameter: ProbedParameter, extensions: readonly string[]): WebVstParameter {
  const result: WebVstParameter = {
    parameterId: parameter.parameterId,
    name: parameter.title,
    description: parameter.title,
    flags: parameter.flags,
    stepCount: parameter.stepCount,
    defaultValue: clampUnit(parameter.defaultValue),
  };
  if (parameter.stepCount > 0) result.display = { choices: parameter.displayValues };
  if (extensions.includes(BUZZ_EXTENSION)) result.extensions = { [BUZZ_EXTENSION]: buzzProjection(parameter) };
  return result;
}

function indexCuration(entries: readonly AuthorParameterCuration[] | undefined): Map<string, AuthorParameterCuration> {
  const result = new Map<string, AuthorParameterCuration>();
  for (const entry of entries ?? []) {
    const key = `${entry.classUid}:${entry.parameterId}`;
    if (result.has(key)) fail(`duplicate curation entry for ${key}`);
    result.set(key, entry);
  }
  return result;
}

function applyCuration(
  classes: WebVstManifestClass[],
  probedClasses: Awaited<ReturnType<typeof probeWasm>>,
  curation: readonly AuthorParameterCuration[] | undefined,
  extensions: readonly string[],
): void {
  const entries = indexCuration(curation);
  for (const entry of entries.values()) {
    const probed = probedClasses.find((candidate) => candidate.classUid === entry.classUid);
    if (!probed || !probed.parameters.some((parameter) => parameter.parameterId === entry.parameterId)) {
      fail(`curation parameter ${entry.classUid}:${entry.parameterId} does not exist in the probed module`);
    }
  }
  for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
    const manifestClass = classes[classIndex];
    const probed = probedClasses[classIndex];
    const exposed = new Map(manifestClass.exposedParameters.map((parameter) => [parameter.parameterId, parameter]));
    for (const parameter of probed.parameters) {
      const entry = entries.get(`${probed.classUid}:${parameter.parameterId}`);
      if (!entry) continue;
      const automatable = (parameter.flags & WEBVST_PARAMETER_AUTOMATABLE) !== 0;
      const readOnly = (parameter.flags & WEBVST_PARAMETER_READ_ONLY) !== 0;
      if (entry.expose === true && (!automatable || readOnly)) {
        fail(`curation cannot expose non-automatable or read-only parameter ${probed.classUid}:${parameter.parameterId}`);
      }
      if (entry.expose === false) {
        exposed.delete(parameter.parameterId);
        continue;
      }
      const target = exposed.get(parameter.parameterId);
      if (!target) {
        if (entry.expose !== true) fail(`curation override targets a parameter that is not exposed by ABI defaults: ${probed.classUid}:${parameter.parameterId}`);
        exposed.set(parameter.parameterId, mapParameter(parameter, extensions));
      }
      const selected = exposed.get(parameter.parameterId)!;
      if (entry.name !== undefined) selected.name = entry.name;
      if (entry.description !== undefined) selected.description = entry.description;
      if (entry.display) {
        selected.display = {
          ...selected.display,
          ...entry.display,
          ...(selected.display?.choices ? { choices: selected.display.choices } : {}),
        };
      }
    }
    manifestClass.exposedParameters = [...exposed.values()].sort((left, right) => left.parameterId - right.parameterId);
  }
}

export async function generateManifest(config: ManifestAuthorConfig): Promise<WebVstManifestV1> {
  assertPackageId(config.packageId);
  if (!config.version) fail("version must not be empty");
  if (!config.modulePath || config.modulePath.includes("\\") || config.modulePath.startsWith("/") || config.modulePath.split("/").includes("..")) {
    fail("modulePath must be a safe relative POSIX path");
  }
  const extensions = config.extensions ?? [BUZZ_EXTENSION];
  for (const namespace of extensions) {
    if (!EXTENSION_NAMESPACE.test(namespace)) fail(`invalid extension namespace ${namespace}`);
    if (namespace !== BUZZ_EXTENSION) fail(`unknown extension namespace ${namespace}`);
  }
  const curation = validCuration(config.curation);
  const probedClasses = await probeWasm(config.wasm);
  const classes: WebVstManifestClass[] = probedClasses.map((probed) => ({
    classUid: probed.classUid,
    name: probed.name,
    vendor: probed.vendor,
    kind: probed.kind,
    exposedParameters: probed.parameters
      .filter((parameter) => (parameter.flags & WEBVST_PARAMETER_AUTOMATABLE) !== 0 && (parameter.flags & WEBVST_PARAMETER_READ_ONLY) === 0)
      .map((parameter) => mapParameter(parameter, extensions)),
  }));
  applyCuration(classes, probedClasses, curation, extensions);
  return validateManifest({
    schemaVersion: 1,
    packageId: config.packageId,
    version: config.version,
    abi: WEBVST_ABI,
    module: { path: config.modulePath, sha256: createHash("sha256").update(config.wasm).digest("hex") },
    classes,
  });
}
