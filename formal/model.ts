// Checks the real model and prints TLC's output.
import { jar, tlc } from "./tlc.ts";

jar();
const run = tlc("OutFolder.tla", "OutFolder.cfg");
process.stdout.write(run.output);
if (run.status !== 0) process.exit(run.status ?? 2);
