/**
 * Build wrapper that shrinks per-process thread pools before invoking
 * `next build`.
 *
 * The deploy build host is severely thread/process constrained: `next build`
 * aborted with SIGABRT / a uv_thread_create assertion while starting its
 * page-data and static-generation worker. `experimental.cpus = 1` already cuts
 * the worker *count* to one, but each worker process still spins up full V8 and
 * libuv thread pools sized to the host's CPU count, and the host cannot spawn
 * that many threads.
 *
 * Next's worker processes inherit this process's environment, so capping the
 * pools here — before Next forks them — keeps every worker within the host's
 * limit. Values fall back to roomy behaviour when overridden, so a build host
 * with normal limits can restore parallelism via the environment.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

// libuv thread pool (fs / dns / crypto): default 4 -> 1.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = "1";
}

// V8 platform background-task pool — this is the pool whose uv_thread_create
// call aborted. Default scales with CPU count; pin it low. Passed through
// NODE_OPTIONS so Next's forked worker children inherit it too.
const v8PoolSize = process.env.BUILD_V8_POOL_SIZE || "1";
const nodeOptions = process.env.NODE_OPTIONS ?? "";
if (!/--v8-pool-size\b/.test(nodeOptions)) {
  process.env.NODE_OPTIONS = `${nodeOptions} --v8-pool-size=${v8PoolSize}`.trim();
}

const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`next build terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("Failed to start next build:", error);
  process.exit(1);
});
