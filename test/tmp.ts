// Test temp folders are removed when the runner reaches the hook of the test file that imported
// this module, and again when the process exits, so a run that fails part way leaves nothing behind
// in the temp dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

const made: string[] = [];

const remove = () => {
	for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
};

process.on("exit", remove);
try {
	// `bun test --parallel` ends a worker without the exit handlers, so this hook is what removes
	// the folders there; a plain bun process has no runner to register it with.
	after(remove);
} catch (error) {
	// The runner is the only thing that knows it is absent, and it says so in this message.
	if (!(error instanceof Error) || !/outside of the test runner/.test(error.message)) throw error;
}

/** Makes a folder with `mkdtempSync` and registers it for removal. */
export function tmpDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	made.push(dir);
	return dir;
}
