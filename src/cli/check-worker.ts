// Runs inside the worker: validate the view, run the check, build the outputs and stage them. Files
// go to `draft` and the folder becomes `done` only once all are written, so the parent never sees a
// half-written result.

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { checkView } from "../parse/view-module.ts";
import { buildOutputs } from "../build-outputs.ts";
import { check } from "../tlc/check.ts";
import { messageOf } from "../tlc/process.ts";

const [stage, specFile, configFile, viewFile] = process.argv.slice(2);

// Main sends one line once the janitor knows this process's group, so nothing here may start TLC
// before that. A pipe that closes first means main is gone, so stop without staging anything.
const released = await new Promise<boolean>((resolve) => {
	const stdin = process.stdin;
	stdin.once("data", () => resolve(true));
	stdin.once("end", () => resolve(false));
	stdin.once("close", () => resolve(false));
	stdin.resume();
});
if (!released) process.exit(2);

try {
	const view = checkView(
		viewFile
			? ((await import(pathToFileURL(path.resolve(viewFile)).href)) as {
					readonly [name: string]: unknown;
				})
			: {},
		inspect,
	);
	const { files, exit } = buildOutputs(await check(specFile, configFile), view);
	const draft = path.join(stage, "draft");
	fs.mkdirSync(draft);
	for (const [name, parts] of files) {
		const fd = fs.openSync(path.join(draft, name), "wx");
		try {
			for (const part of parts)
				fs.writeSync(fd, typeof part === "string" ? Buffer.from(part) : part);
			fs.writeSync(fd, "\n");
		} finally {
			fs.closeSync(fd);
		}
	}
	fs.renameSync(draft, path.join(stage, "done"));
	process.exit(exit);
} catch (error) {
	console.error(messageOf(error));
	process.exit(2);
}
