import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sdkRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function rebuildFixturePackage(): Promise<void> {
  await execFileAsync("cmake", ["--build", "build/wasm", "--target", "webvst_fixture_package"], { cwd: sdkRoot });
}
