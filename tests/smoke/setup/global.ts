import { spawn, type ChildProcess } from "node:child_process";
import { getConfig } from "../helpers/config";
import { sweepSmokeData } from "../helpers/bootstrap";

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForApp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(url)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Integration global setup:
 *  - resolves Supabase config (fails fast if the stack is down),
 *  - ensures the Next.js dev server is reachable, starting one only if needed
 *    (the Cloud Agent normally already runs it in a terminal),
 *  - cleans up any residual test data on teardown.
 */
export default async function setup() {
  const c = getConfig();

  let started: ChildProcess | undefined;

  if (!(await ping(c.appBaseUrl))) {
    started = spawn("npm", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: "ignore",
      detached: true,
      env: process.env,
    });
    const ready = await waitForApp(c.appBaseUrl, 90_000);
    if (!ready) {
      throw new Error(
        `Next.js app not reachable at ${c.appBaseUrl} (failed to start).`,
      );
    }
  }

  return async () => {
    await sweepSmokeData();
    if (started?.pid) {
      try {
        process.kill(-started.pid, "SIGTERM");
      } catch {
        try {
          started.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    }
  };
}
