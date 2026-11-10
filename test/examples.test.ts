import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { limit } from "./limit.ts";
import { tmpDir } from "./tmp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.join(here, "..", "examples");
const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";
const read = (file: string) => fs.readFileSync(file, "utf8");

// Runs one example spec the way the README says, into a fresh folder.
const start = async (name: string, spec: string) => {
	const dir = path.join(examples, name);
	const tmp = tmpDir("tlachart-examples-");
	const out = path.join(tmp, "out");
	const child = spawn(
		process.execPath,
		[
			path.join(here, "../src/cli/main.ts"),
			path.join(dir, `${spec}.tla`),
			"--view",
			path.join(dir, "view.mjs"),
			"--out",
			out,
		],
		{ env: process.env, stdio: ["ignore", "ignore", "pipe"] },
	);
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
	return { dir, out, tmp, stderr, status };
};

// Start every example's run now; each test only waits for its own.
const runs = skip
	? []
	: [
			{ name: "checkout", spec: "Checkout", kind: "buggy", status: 1 },
			{ name: "checkout", spec: "CheckoutFixed", kind: "fixed", status: 0 },
			{ name: "order", spec: "Order", kind: "buggy", status: 1 },
			{ name: "order", spec: "OrderFixed", kind: "fixed", status: 0 },
			{ name: "retry", spec: "Retry", kind: "buggy", status: 1 },
			{ name: "retry", spec: "RetryFixed", kind: "fixed", status: 0 },
		].map((c) => ({ ...c, result: limit(() => start(c.name, c.spec)) }));

for (const { name, spec, kind, status, result } of runs)
	test(`${name} ${kind} matches the committed chart and report`, { skip }, async () => {
		const { dir, out, tmp, stderr, status: exit } = await result;
		try {
			assert.equal(stderr, "");
			assert.equal(exit, status, `${spec} exit code`);
			for (const file of ["chart.mmd", "report.md"])
				assert.equal(
					read(path.join(out, file)),
					read(path.join(dir, kind, file)),
					`${name} ${kind} ${file}`,
				);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
