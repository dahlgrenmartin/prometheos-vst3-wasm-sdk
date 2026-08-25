import { createHash } from "node:crypto";
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

function fail(message: string): never {
  throw new Error(`WebVST manifest: ${message}`);
}

function assertPackageId(packageId: string): void {
  if (!PACKAGE_ID.test(packageId)) fail("packageId must be a reverse-DNS identifier");
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
    const key = `${entry.classUid}:${entry.parameterId >>> 0}`;
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
    if (!probed || !probed.parameters.some((parameter) => parameter.parameterId === (entry.parameterId >>> 0))) {
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
      if (entry.buzz) Object.assign(selected.buzz, entry.buzz);
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
  applyCuration(classes, probedClasses, config.curation);
  return {
    schemaVersion: 1,
    packageId: config.packageId,
    version: config.version,
    abi: WEBVST_ABI,
    module: { path: config.modulePath, sha256: createHash("sha256").update(config.wasm).digest("hex") },
    classes,
  };
}
