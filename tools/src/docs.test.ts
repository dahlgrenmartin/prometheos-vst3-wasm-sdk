import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(toolsDirectory, "..", "..");

async function text(relativePath: string): Promise<string> {
  return readFile(join(repositoryRoot, relativePath), "utf8");
}

// `git ls-files` also reports submodule gitlinks (mode 160000), which are
// directories on disk and are pinned upstream sources rather than SDK-owned
// ones. `--stage` exposes the mode so they are excluded before any file read.
function trackedSourcePaths(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--stage"], { cwd: repositoryRoot })
    .toString()
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("160000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    .filter((file) => file && !file.endsWith(".png") && !file.endsWith(".pdf"));
}

describe("published SDK contract documentation", () => {
  it("documents every exported ABI declaration with its exact signature", async () => {
    const header = await text("include/webvst/webvst.h");
    const documentation = await text("docs/abi-v1.md");
    const declarations = [...header.matchAll(/^\s*((?:uint32_t|int32_t|float|void)\s+webvst_[a-z0-9_]+\s*\([^;]*\));/gm)]
      .map((match) => match[1].replace(/\s+/g, " ").trim());

    expect(declarations.length).toBeGreaterThan(0);
    const normalizedDocumentation = documentation.replace(/\s+/g, " ");
    for (const declaration of declarations) expect(normalizedDocumentation).toContain(declaration);
  });

  it("documents every JSON Schema object property in its object section", async () => {
    const schema = JSON.parse(await text("schema/plugin.schema.json")) as Record<string, unknown>;
    const documentation = await text("docs/package-format-v1.md");
    const sections = new Map<string, Set<string>>();
    for (const match of documentation.matchAll(/^### `([^`]+)` object\s*\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gim)) {
      const properties = new Set<string>();
      for (const row of match[2].matchAll(/^\| `([^`]+)` \|/gm)) properties.add(row[1]);
      sections.set(match[1], properties);
    }
    const expected = new Map<string, Set<string>>();
    const collect = (value: unknown, label: string, result = expected) => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      const properties = object.properties;
      if (properties && typeof properties === "object") {
        const names = new Set(Object.keys(properties as Record<string, unknown>));
        result.set(label, names);
        for (const [property, child] of Object.entries(properties as Record<string, unknown>)) collect(child, `${label}.${property}`, result);
      }
      if (object.items) collect(object.items, `${label}[]`, result);
      for (const key of ["contains", "additionalProperties", "unevaluatedItems", "unevaluatedProperties", "propertyNames", "not", "if", "then", "else"]) {
        if (object[key]) collect(object[key], `${label}.${key}`, result);
      }
      for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
        if (Array.isArray(object[key])) for (const [index, child] of object[key].entries()) collect(child, `${label}.${key}[${index}]`, result);
      }
      for (const key of ["patternProperties", "dependentSchemas"]) {
        const children = object[key];
        if (children && typeof children === "object") {
          for (const [name, child] of Object.entries(children as Record<string, unknown>)) collect(child, `${label}.${key}.${name}`, result);
        }
      }
    };
    collect(schema, "root");
    const definitions = schema.$defs;
    if (definitions && typeof definitions === "object") {
      for (const [name, definition] of Object.entries(definitions as Record<string, unknown>)) collect(definition, name);
    }
    const arrayFixtureExpected = new Map<string, Set<string>>();
    const arrayFixture = {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { nested: { type: "string" } } } } },
    };
    collect(arrayFixture, "array-fixture", arrayFixtureExpected);
    // The fixture is intentionally checked through the same traversal, but is
    // not part of the published schema and therefore has no docs section.
    expect(arrayFixtureExpected.get("array-fixture.items[]")).toEqual(new Set(["nested"]));

    expect(expected.size).toBeGreaterThan(0);
    for (const [label, properties] of expected) expect(sections.get(label), `missing schema object section ${label}`).toEqual(properties);
  });

  it("contains no unresolved absolute build paths in tracked source", async () => {
    const absoluteBuildPath = /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/][^\s"'`<>]+|\/(?!\/)[^\s"'`<>]+)/g;
    const hasAbsoluteBuildPath = (contents: string): boolean => {
      for (const match of contents.matchAll(absoluteBuildPath)) {
        const token = match[0].trim().replace(/[),.;:]+$/g, "");
        if (/(?:^|[\\/])build(?:[\\/]|$)/i.test(token)) return true;
      }
      return false;
    };
    expect(hasAbsoluteBuildPath(["C:", "work", "sdk", "build", "plugin.wasm"].join("\\"))).toBe(true);
    expect(hasAbsoluteBuildPath(["", "opt", "sdk", "build", "packages", "plugin.webvst"].join("/"))).toBe(true);
    expect(hasAbsoluteBuildPath(["", "var", "cache", "build"].join("/"))).toBe(true);
    expect(hasAbsoluteBuildPath(["https:", "", "example.test", "build", "plugin.wasm"].join("/"))).toBe(false);
    const tracked = trackedSourcePaths();
    // The pinned conformance submodule is upstream source, not SDK-owned, and
    // its gitlink entry is a directory that cannot be read as a file.
    expect(tracked).toContain("include/webvst/webvst.h");
    expect(tracked).not.toContain("third_party/public.sdk");
    const offenders: string[] = [];
    for (const file of tracked) {
      const contents = await text(file);
      if (contents.includes("\0")) continue;
      if (hasAbsoluteBuildPath(contents)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
