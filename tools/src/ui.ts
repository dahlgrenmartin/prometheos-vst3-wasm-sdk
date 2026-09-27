import { z } from "zod";
import type { ProbedClass, WebVstManifestV1, WebVstUiFile } from "./types.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const capability = z.string().max(128).regex(/^[a-z][a-z0-9.-]*\/[1-9][0-9]*$/);
const file = z.object({ path: z.string().min(1).max(512), sha256: hash }).strict();
export const uiExtensionSchema = z.object({
  version: z.literal(1),
  classes: z.array(z.object({
    classUid: z.string().regex(/^[a-f0-9]{32}$/),
    document: file,
    custom: file.extend({ abi: z.literal("webvst-ui-1"), requiredCapabilities: z.array(capability).max(64), optionalCapabilities: z.array(capability).max(64) }).strict().optional(),
  }).strict()).max(256),
  assets: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/), file.extend({ type: z.enum(["image", "font", "binary"]) }).strict()).optional(),
}).strict();

function fail(message: string): never { throw new Error(`WebVST UI: ${message}`); }

export function uiFiles(manifest: WebVstManifestV1): WebVstUiFile[] {
  return [...(manifest.ui?.classes ?? []).flatMap(entry => [entry.document, ...(entry.custom ? [entry.custom] : [])]), ...Object.values(manifest.ui?.assets ?? {})];
}

export function validateUiManifest(manifest: WebVstManifestV1): void {
  if (!manifest.ui) return;
  const classes = new Set(manifest.classes.map(entry => entry.classUid));
  const declared = new Set<string>();
  for (const entry of manifest.ui.classes) {
    if (!classes.has(entry.classUid)) fail(`unknown UI class ${entry.classUid}`);
    if (declared.has(entry.classUid)) fail(`duplicate UI class ${entry.classUid}`);
    declared.add(entry.classUid);
    if (entry.custom) {
      const caps = [...entry.custom.requiredCapabilities, ...entry.custom.optionalCapabilities];
      if (new Set(caps).size !== caps.length) fail("duplicate capability in required/optional lists");
      if (!entry.custom.requiredCapabilities.includes("webvst-ui-core/1")) fail("custom UI requires webvst-ui-core/1 capability");
    }
  }
  const paths = new Map<string, string>([["plugin.json", "manifest"], [manifest.module.path, "DSP"]]);
  for (const artifact of manifest.artifacts ?? []) paths.set(artifact.path, "artifact");
  for (const entry of uiFiles(manifest)) {
    const path = entry.path;
    if (/[:\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) fail(`unsafe UI path ${path}`);
    if (/\.(?:js|mjs|cjs)$/i.test(path)) fail(`JavaScript UI path is forbidden: ${path}`);
    // Classes can share a document or custom module only with identical content.
    const existing = paths.get(path);
    if (existing !== undefined && existing !== entry.sha256) fail(`duplicate UI path conflict: ${path}`);
    paths.set(path, entry.sha256);
  }
}

const nonnegative = z.number().finite().min(0).max(1_000_000);
const dimension = z.union([nonnegative, z.string().max(32).regex(/^(?:[1-9][0-9]*(?:\.[0-9]+)?|0?\.[0-9]*[1-9][0-9]*)fr$/)
  .refine(value => Number(value.slice(0, -2)) <= 1_000_000, "fraction exceeds layout budget")]);
const nodeSchema = z.object({
  type: z.enum(["row", "column", "grid", "label", "button", "toggle", "slider", "knob", "combo", "group", "slot", "image"]),
  id: z.string().min(1).max(128).optional(), parameter: z.string().regex(/^(0|[1-9][0-9]{0,9})$/).optional(),
  label: z.string().max(4096).optional(), text: z.string().max(4096).optional(), asset: z.string().max(128).optional(),
  children: z.array(z.unknown()).max(10000).optional(), choices: z.array(z.string().max(4096)).max(4096).optional(),
  disabled: z.boolean().optional(), visible: z.boolean().optional(),
  width: dimension.optional(), height: dimension.optional(), minWidth: nonnegative.optional(), minHeight: nonnegative.optional(),
  maxWidth: nonnegative.optional(), maxHeight: nonnegative.optional(), gap: nonnegative.optional(), padding: nonnegative.optional(), flex: nonnegative.optional(),
  columns: z.number().int().min(1).max(1024).optional(), aspectRatio: z.number().finite().positive().optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(), orientation: z.enum(["horizontal", "vertical"]).optional(),
  breakpoints: z.array(z.object({ maxWidth: nonnegative, columns: z.number().int().min(1).max(1024).optional(), gap: nonnegative.optional() }).strict()).max(64).optional(),
}).strict();
const documentSchema = z.object({ version: z.literal(1), root: z.unknown(), theme: z.record(z.string().max(128), z.union([z.string().max(4096), z.number().finite()])).optional() }).strict();

/** Bounded, non-executing author-time checks. Hosts separately recover from invalid documents. */
export function validateUiDocument(value: unknown, manifest: WebVstManifestV1, classUid: string, metadata: ProbedClass): void {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) fail(`document schema: ${parsed.error.message}`);
  const ids = new Set<string>();
  const parameters = new Set(metadata.parameters.map(parameter => String(parameter.parameterId)));
  const bound = new Set<string>();
  let count = 0;
  const visit = (value: unknown, depth: number, hidden: boolean): void => {
    if (++count > 10000 || depth > 64) fail("document node/depth budget exceeded");
    const result = nodeSchema.safeParse(value);
    if (!result.success) fail(`node schema: ${result.error.message}`);
    const node = result.data;
    const interactive = ["button", "toggle", "slider", "knob", "combo"].includes(node.type);
    if ((interactive || node.type === "slot") && !node.id) fail(`node ${node.type} requires stable id`);
    if (node.id) {
      if (ids.has(node.id)) fail(`duplicate node id ${node.id}`);
      ids.add(node.id);
    }
    if (node.parameter !== undefined) {
      if (!parameters.has(node.parameter)) fail(`unknown parameter binding ${node.parameter}`);
      if (interactive && !hidden && node.visible !== false && !node.disabled) bound.add(node.parameter);
    }
    if (node.asset && !Object.hasOwn(manifest.ui?.assets ?? {}, node.asset)) fail(`unknown asset ${node.asset}`);
    if (node.type === "image" && (!node.asset || manifest.ui?.assets?.[node.asset]?.type !== "image")) fail("image node requires image asset");
    for (const child of node.children ?? []) visit(child, depth + 1, hidden || node.visible === false || node.disabled === true);
  };
  visit(parsed.data.root, 0, false);
  if (manifest.ui?.classes.find(entry => entry.classUid === classUid)?.custom) {
    for (const parameter of manifest.classes.find(entry => entry.classUid === classUid)!.exposedParameters) {
      if (!bound.has(String(parameter.parameterId))) fail(`custom fallback missing usable parameter ${parameter.parameterId}`);
    }
  }
}

export async function validateUiWasm(bytes: Uint8Array): Promise<void> {
  let module: WebAssembly.Module;
  try { module = await WebAssembly.compile(bytes as BufferSource); }
  catch { fail("invalid UI WebAssembly module"); }
  const allowed = new Set(["submit", "parameter", "invalidate"]);
  for (const imported of WebAssembly.Module.imports(module)) {
    if (imported.module !== "webvst_ui" || imported.kind !== "function" || !allowed.has(imported.name)) fail(`forbidden UI import ${imported.module}.${imported.name} (${imported.kind})`);
  }
}
