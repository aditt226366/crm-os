import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: projectRoot
  },
  typescript: {
    // The type-check step spawns a worker thread on a host that is thread
    // constrained (it aborted with a uv_thread_create assertion during the
    // deploy build). Types are already validated by `npm run typecheck` (tsc
    // --noEmit) before every push, so re-running the check here is redundant and
    // only risks the build. Skip it during `next build`.
    ignoreBuildErrors: true
  },
  experimental: {
    // The deploy build host is thread/process constrained. Next fans static
    // page generation across ~4 workers by default, and each worker spins up a
    // Turbopack (tokio) thread pool sized to the CPU count — the multiplied
    // thread demand made the host fail to spawn threads ("Resource temporarily
    // unavailable" / SIGABRT) during "Generating static pages". Pinning to a
    // single worker keeps the build within the host's limits. Do NOT switch to
    // memoryBasedWorkersCount here: it enforces a minimum of 4 workers.
    cpus: 1
  }
};

export default nextConfig;
