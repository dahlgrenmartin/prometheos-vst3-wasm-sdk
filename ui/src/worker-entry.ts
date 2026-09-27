import { installUiWorker } from "./worker.js";
// Dedicated-worker entry point. Hosts construct it with `new Worker(new URL("./worker-entry.ts", import.meta.url))`.
installUiWorker(self as unknown as Parameters<typeof installUiWorker>[0]);
