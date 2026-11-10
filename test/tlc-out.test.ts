import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatMessages } from "../src/tlc/format-message.ts";
import { readMessages } from "../src/parse/tlc-messages.ts";
import { limit } from "./limit.ts";
import { tmpDir } from "./tmp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(here, "corpus");
const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";
const read = (file: string) => fs.readFileSync(file, "utf8");
const maybe = (file: string) => (fs.existsSync(file) ? read(file) : "");
const plain = (text: string) => [...formatMessages(readMessages(text))].join("");

const steady = (text: string) =>
	text
		.replace(/"chart-[0-9a-f]{32}"/g, '"chart"')
		.replace(/\bfp \d+ and seed -?\d+/g, "fp _ and seed _")
		.replace(/\[pid: \d+\]/g, "[pid: _]")
		.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, "_")
		.replace(/ \([\d,]+ d?s\/min\)/g, "")
		.replace(/ in (?:\d+d \d\dh|\d\dh \d\dmin|\d\dmin \d\ds|\d\ds) at /g, " in _ at ");

const start = async (name: string) => {
	const dir = path.join(corpus, name);
	const tmp = tmpDir("tlachart-plain-");
	const [tool, twin, out] = ["tool", "plain", "out"].map((f) => path.join(tmp, f));
	fs.mkdirSync(tool);
	fs.mkdirSync(twin);
	const view = path.join(dir, "view.mjs");
	const child = spawn(
		process.execPath,
		[
			path.join(here, "../src/cli/main.ts"),
			path.join(dir, `${name}.tla`),
			...(fs.existsSync(view) ? ["--view", view] : []),
			"--out",
			out,
		],
		{
			env: {
				...process.env,
				JAVA: path.join(here, "java.ts"),
				TLACHART_JAVA: process.env.JAVA ?? "java",
				TLACHART_RECORD: tool,
				TLACHART_PLAIN: twin,
			},
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	await once(child, "close");
	return { tool, twin, out, stderr };
};

// Start every spec's runs now; each test only waits for its own.
const runs = skip
	? []
	: fs.readdirSync(corpus).map((name) => ({ name, result: limit(() => start(name)) }));

for (const { name, result } of runs)
	test(
		`${name} reads TLC's tool output as plain TLC prints it at -workers 1`,
		{ skip },
		async () => {
			const { tool, twin, out, stderr } = await result;
			assert.equal(stderr, "");
			const twins = fs.readdirSync(twin).filter((f) => f.endsWith(".out"));
			assert.ok(twins.includes("ChartRun.out"), "the drawing run has a plain twin");
			for (const run of twins) {
				const exit = run.replace(/\.out$/, ".exit");
				assert.equal(maybe(path.join(tool, exit)), maybe(path.join(twin, exit)), exit);
				assert.equal(
					steady(plain(read(path.join(tool, run)))),
					steady(read(path.join(twin, run))),
					run,
				);
			}
			assert.equal(
				steady(read(path.join(out, "tlc.out"))),
				steady(`${read(path.join(twin, "verdict-1.out"))}\n`),
			);
			const verdicts = new Set<string>();
			for (const run of twins)
				if (run.startsWith("verdict-")) verdicts.add(steady(`${read(path.join(twin, run))}\n`));
			for (const f of fs.readdirSync(out))
				if (/^tlc-\w+\.out$/.test(f)) assert.ok(verdicts.has(steady(read(path.join(out, f)))), f);
		},
	);
