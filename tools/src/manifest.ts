import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PVST_PARAMETER_AUTOMATABLE,
  PVST_PARAMETER_READ_ONLY,
  probeWasm,
} from "./probe.js";
import {
  WEBVST_ABI,
  type AuthorParameterCuration,
  type BuzzParameter,
  type ManifestAuthorConfig,
  type ProbedParameter,
  type WebVstManifestClass,
  type WebVstManifestV1,
} from "./types.js";

const PACKAGE_ID = /^(?:[a-z](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
const CLASS_UID = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
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
  parameterId: z.number().int().min(0).max(0xffff_ffff),
  expose: z.boolean().optional(),
  buzz: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    display: presentationDisplaySchema.optional(),
  }).strict().optional(),
}).strict();

const displaySchema = presentationDisplaySchema.extend({ choices: z.array(z.string()).optional() }).strict();
const buzzSchema = z.object({
  type: z.enum(["note", "switch", "byte", "word"]),
  name: z.string(), description: z.string(), minValue: finiteNumber, maxValue: finiteNumber,
  noValue: finiteNumber, defValue: finiteNumber, flags: z.number().int(), display: displaySchema.optional(),
}).strict();
const parameterSchema = z.object({ parameterId: z.number().int().min(0).max(0xffff_ffff), buzz: buzzSchema }).strict();
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
  return parsed.data as WebVstManifestV1;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mapParameter(parameter: ProbedParameter): BuzzParameter {
  const isDiscrete = parameter.stepCount > 0;
  const maxValue = isDiscrete ? parameter.stepCount : 65534;
  const type = isDiscrete && parameter.stepCount <= 254 ? "byte" : "word";
  const noValue = type === "byte" ? 255 : 65535;
  const buzz: BuzzParameter = {
    type,
    name: parameter.title,
    description: parameter.title,
    minValue: 0,
    maxValue,
    noValue,
    defValue: Math.round(clampUnit(parameter.defaultValue) * maxValue),
    flags: 1,
  };
  if (isDiscrete) buzz.display = { choices: parameter.displayValues };
  return buzz;
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
      const automatable = (parameter.flags & PVST_PARAMETER_AUTOMATABLE) !== 0;
      const readOnly = (parameter.flags & PVST_PARAMETER_READ_ONLY) !== 0;
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
        exposed.set(parameter.parameterId, { parameterId: parameter.parameterId, buzz: mapParameter(parameter) });
      }
      const selected = exposed.get(parameter.parameterId)!;
      if (entry.buzz?.name !== undefined) selected.buzz.name = entry.buzz.name;
      if (entry.buzz?.description !== undefined) selected.buzz.description = entry.buzz.description;
      if (entry.buzz?.display) {
        selected.buzz.display = {
          ...selected.buzz.display,
          ...entry.buzz.display,
          ...(selected.buzz.display?.choices ? { choices: selected.buzz.display.choices } : {}),
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
  const curation = validCuration(config.curation);
  const probedClasses = await probeWasm(config.wasm);
  const classes: WebVstManifestClass[] = probedClasses.map((probed) => ({
    classUid: probed.classUid,
    name: probed.name,
    vendor: probed.vendor,
    kind: probed.kind,
    exposedParameters: probed.parameters
      .filter((parameter) => (parameter.flags & PVST_PARAMETER_AUTOMATABLE) !== 0 && (parameter.flags & PVST_PARAMETER_READ_ONLY) === 0)
      .map((parameter) => ({ parameterId: parameter.parameterId, buzz: mapParameter(parameter) })),
  }));
  applyCuration(classes, probedClasses, curation);
  return validateManifest({
    schemaVersion: 1,
    packageId: config.packageId,
    version: config.version,
    abi: WEBVST_ABI,
    module: { path: config.modulePath, sha256: createHash("sha256").update(config.wasm).digest("hex") },
    classes,
  });
}
