import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const toolsDirectory = dirname(new URL(import.meta.url).pathname.replace(/^\//, "").replace(/^([A-Za-z]):/, "$1:"));
const repositoryRoot = join(toolsDirectory, "..", "..");

async function text(relativePath: string): Promise<string> {
  return readFile(join(repositoryRoot, relativePath), "utf8");
}

function trackedSourcePaths(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot })
    .toString()
    .split("\0")
    .filter((file) => file && !file.endsWith(".png") && !file.endsWith(".pdf"));
}

describe("published SDK contract documentation", () => {
  it("documents every exported ABI symbol", async () => {
    const header = await text("include/prometheos/webvst.h");
    const documentation = await text("docs/abi-v1.md");
    const symbols = [...header.matchAll(/\b(pvst_[a-z0-9_]+)\s*\(/g)].map((match) => match[1]);

    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) expect(documentation).toContain(symbol);
  });

  it("documents every JSON Schema property", async () => {
    const schema = JSON.parse(await text("schema/plugin.schema.json")) as { properties?: Record<string, unknown>; $defs?: Record<string, { properties?: Record<string, unknown> }> };
    const documentation = await text("docs/package-format-v1.md");
    const properties = new Set<string>();
    const collect = (value: { properties?: Record<string, unknown> } | undefined) => {
      for (const property of Object.keys(value?.properties ?? {})) properties.add(property);
    };
    collect(schema);
    for (const definition of Object.values(schema.$defs ?? {})) collect(definition);

    expect(properties.size).toBeGreaterThan(0);
    for (const property of properties) expect(documentation).toMatch(new RegExp(`\\b${property}\\b`));
  });

  it("contains no unresolved absolute build paths in tracked source", async () => {
    const absoluteBuildPath = /(?:\b[A-Z]:[\\/]|\/(?:Users|home|private|tmp|workspace|workspaces|mnt)\/)[^\r\n"'`]*\bbuild[\\/]/i;
    const offenders: string[] = [];
    for (const file of trackedSourcePaths()) {
      const contents = await text(file);
      if (contents.includes("\0")) continue;
      if (absoluteBuildPath.test(contents)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
