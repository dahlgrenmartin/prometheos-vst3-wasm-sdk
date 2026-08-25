import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packWebVst } from "../../tools/src/archive.js";
import { loadFixturePackage } from "./package_consumer.js";

const packagePath = new URL("../../build/packages/prometheos-fixtures.webvst", import.meta.url);
const stagingPath = fileURLToPath(new URL("../../build/wasm/packages/fixture-staging", import.meta.url));

describe("fixture package determinism", () => {
  it("packs the generated fixture bytes identically on consecutive runs", async () => {
    const archive = new Uint8Array(await readFile(packagePath));
    const first = await packWebVst(stagingPath);
    const second = await packWebVst(stagingPath);
    const fixture = await loadFixturePackage(archive);
    expect(createHash("sha256").update(first).digest("hex")).toBe(createHash("sha256").update(second).digest("hex"));
    expect(archive).toEqual(first);
    expect(fixture.archiveSha256).toBe(createHash("sha256").update(first).digest("hex"));
    expect(fixture.entries).toEqual(["plugin.json", "plugin.wasm"]);
  });
});
