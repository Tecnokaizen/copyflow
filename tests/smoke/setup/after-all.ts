import { afterAll } from "vitest";
import { cleanupAll } from "../helpers/bootstrap";

// Promptly remove entities created by the test file that runs in this worker.
afterAll(async () => {
  await cleanupAll();
});
