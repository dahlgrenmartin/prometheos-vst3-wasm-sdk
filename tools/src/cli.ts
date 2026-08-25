#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { inspectWebVst, packWebVst, verifyWebVst } from "./archive.js";
import { generateManifest } from "./manifest.js";

function usage(): never {
  throw new Error("usage: webvst manifest <plugin.wasm> <package-id> <version> <module-path> <plugin.json> | webvst pack <staging-directory> <output.webvst> | webvst inspect <archive.webvst> | webvst verify <archive.webvst>");
}

async function main(argv: string[]): Promise<void> {
  const [command, first, second, third, fourth, fifth] = argv;
  if (command === "manifest" && first && second && third && fourth && fifth) {
    const manifest = await generateManifest({
      wasm: new Uint8Array(await readFile(first)), packageId: second, version: third, modulePath: fourth,
    });
    await writeFile(fifth, `${JSON.stringify(manifest)}\n`);
    return;
  }
  if (command === "pack" && first && second) {
    await writeFile(second, await packWebVst(first));
    return;
  }
  if ((command === "inspect" || command === "verify") && first && !second) {
    const details = command === "inspect" ? await inspectWebVst(new Uint8Array(await readFile(first))) : await verifyWebVst(new Uint8Array(await readFile(first)));
    process.stdout.write(`Package ID: ${details.packageId}\nVersion: ${details.version}\nArchive SHA-256: ${details.archiveSha256}\nABI: ${details.abi}\n`);
    for (const entry of details.classes) process.stdout.write(`Class: ${entry.classUid} ${entry.name} (${entry.kind}), parameters: ${entry.parameterCount}\n`);
    for (const artifact of details.artifacts) process.stdout.write(`Artifact: ${artifact.id} ${artifact.path} ${artifact.sha256}\n`);
    return;
  }
  usage();
}

const argumentsAfterScriptDelimiter = process.argv.slice(2);
if (argumentsAfterScriptDelimiter[0] === "--") argumentsAfterScriptDelimiter.shift();

main(argumentsAfterScriptDelimiter).catch((error: unknown) => {
  process.stderr.write(`webvst: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
