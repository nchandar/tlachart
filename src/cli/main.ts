#!/usr/bin/env bun
// The command line. A worker does the check and writes to a staging folder; only a finished result
// is renamed into --out, so --out holds a whole result or nothing.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { childEnv } from "../tlc/env.ts";
import { findTlc } from "../tlc/locate.ts";
import { killGroup, messageOf } from "../tlc/process.ts";

const USAGE = `Usage: tlachart SPEC.tla [--config FILE] [--view FILE] [--out DIR]

Checks SPEC.tla with TLC and draws its state graph as Mermaid. Above 500 states, the chart
draws only the paths to the rules that break, and with no rule broken there is no chart.mmd.
  --config FILE  TLC config. Default: SPEC.cfg beside the spec.
  --view FILE    A module that exports state(vars) and, if you want, step(action, from, to),
                 group(vars), colors, and title. state() returns a string for a flat chart, an
                 array for parent states, or an object for regions. Default: each state's values.
                 colors gives each group blue, orange, purple, yellow, teal, tan, or pink.
  --out DIR      Where to write report.md, chart.mmd, tlc.out, and tlc-RULE.out for each
                 property that breaks and each rule that breaks off the chart. The folder must
                 be new or empty. Default: SPEC-chart.
Exit code: TLC's own on the config as written: 0 when every rule holds, 1 when a rule breaks,
and 2 when TLC stops with an error, a signal kills the check, or the command cannot run. 130 or
143 when SIGINT or SIGTERM stops the check. Only exits 0 and 1 write output.`;

// The first SIGINT or SIGTERM is recorded and wakes the main flow to shut the worker down.
let stop: NodeJS.Signals | undefined;
const stopped = new Promise<void>((resolve) => {
	for (const name of ["SIGINT", "SIGTERM"] as const)
		process.on(name, () => {
			stop ??= name;
			resolve();
		});
});
// The same signal stops a tool download, so mise cannot outlive the command's stop.
const tools = new AbortController();
void stopped.then(() => tools.abort());

let flags;
let specFile;
try {
	const args = parseArgs({
		allowPositionals: true,
		options: { config: { type: "string" }, view: { type: "string" }, out: { type: "string" } },
	});
	flags = args.values;
	[specFile] = args.positionals;
	if (args.positionals.length !== 1) throw new Error("Give one SPEC.tla.");
} catch (error) {
	console.error(`${messageOf(error)}\n\n${USAGE}`);
	process.exit(2);
}

const codeOf = (error: unknown) =>
	error instanceof Error && "code" in error ? error.code : undefined;

// Test-only: writes "<file>.reached" and waits for <file>, so a replay can kill the command at a
// named point. Inert unless TLACHART_HOLD_<POINT> names a file.
const hold = (point: string, value: string) => {
	const file = process.env[`TLACHART_HOLD_${point}`];
	if (!file) return;
	// A reader that kills on the marker must not see it before its content, so publish it atomically.
	fs.writeFileSync(`${file}.reached.tmp`, value);
	fs.renameSync(`${file}.reached.tmp`, `${file}.reached`);
	while (!fs.existsSync(file)) {
		// A SIGKILL still lands: the loop is only here to stay alive.
	}
};

try {
	const configFile = flags.config ?? specFile.replace(/\.tla$/, ".cfg");
	if (!fs.existsSync(configFile))
		throw new Error(`Cannot find the TLC config ${configFile}. Pass --config FILE.`);
	const out = flags.out ?? specFile.replace(/\.tla$/, "-chart");
	let entries: string[] = [];
	let dest: string;
	// A link makes the final rename replace the link's target, so the result would land somewhere
	// other than the folder the user named.
	if (fs.lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink()) {
		let target: fs.Stats | undefined;
		try {
			target = fs.statSync(out);
		} catch {
			// A link that resolves to nothing is the broken-link case.
		}
		throw new Error(
			target
				? `${out} cannot be the output folder. It is a link. Pass --out with a new folder.`
				: `${out} cannot be the output folder. It is a broken link. Pass --out with a new folder.`,
		);
	}
	try {
		entries = fs.readdirSync(out);
		dest = fs.realpathSync(out);
	} catch (error) {
		if (codeOf(error) !== "ENOENT")
			throw new Error(
				`${out} cannot be the output folder. ${messageOf(error)}. Pass --out with a new folder.`,
				{ cause: error },
			);
		dest = path.resolve(out);
	}
	if (entries.length)
		throw new Error(
			`${out} is not empty. It has ${entries.sort()[0]}. The command writes only to a new or empty folder. Pass --out with a new folder.`,
		);

	let base = path.dirname(dest);
	while (!fs.existsSync(base)) base = path.dirname(base);
	// Both folders are named before either exists, so the janitor can be spawned first and no
	// window is left where a kill loses one. Staged beside the destination so the final rename
	// stays on one filesystem and is atomic.
	const token = randomBytes(6).toString("hex");
	const stage = path.join(base, `.${path.basename(dest)}.tlachart-${token}`);
	const done = path.join(stage, "done");
	const tmp = path.join(os.tmpdir(), `tlachart-${token}`);
	let exitCode: number;
	// A shell that waits for this process's pipe to close; if this process dies without cleaning
	// up, even by SIGKILL, it removes both folders and kills the worker's group. The group id
	// arrives on its stdin once the worker exists, so the janitor outlives every later step.
	const janitor = spawn(
		"/bin/sh",
		[
			"-c",
			'read -r pgid; while read -r line; do :; done; if [ -n "$pgid" ]; then kill -s KILL -- "-$pgid"; fi; rm -rf -- "$1" "$2"',
			"sh",
			stage,
			tmp,
		],
		{ detached: true, stdio: ["pipe", "ignore", "ignore"] },
	);
	try {
		fs.mkdirSync(stage, { mode: 0o700 });
		fs.mkdirSync(tmp, { mode: 0o700 });
		// Resolve the tools here, where the proxy credentials are, and hand the worker only their
		// paths: the view module runs in the worker and must not see a proxy URL.
		const tlc = await findTlc(tmp, tools.signal);
		hold("WORKER", String(process.pid));
		const runtime = process.versions.deno
			? [
					"run",
					"--quiet",
					"--no-prompt",
					"--allow-read",
					"--allow-write",
					"--allow-run",
					"--allow-env",
				]
			: process.execArgv;
		// The check runs in a detached worker with its own temp folder, so one kill reaches its whole
		// process group.
		const worker = spawn(
			process.execPath,
			[
				...runtime,
				path.join(import.meta.dirname, "check-worker.ts"),
				stage,
				specFile,
				configFile,
				...(flags.view ? [flags.view] : []),
			],
			{
				detached: true,
				stdio: ["pipe", "inherit", "inherit"],
				env: childEnv({ TMPDIR: tmp, TLA2TOOLS: tlc.jar, JAVA: tlc.java }),
			},
		);
		// The worker waits for this line, so TLC cannot start before the janitor knows its group.
		janitor.stdin?.write(`${worker.pid}\n`);
		hold("RELEASE", String(worker.pid));
		worker.stdin?.write("go\n");
		const exited = new Promise<number>((resolve) =>
			worker.on("exit", (code) => resolve(code ?? 2)),
		);
		// Wait for the worker or a signal, then kill the group either way, which also reaps stray
		// children after a normal exit.
		await Promise.race([stopped, exited]);
		await killGroup(worker.pid as number);
		const verdict = await exited;
		if (stop) {
			console.error(`${stop} stopped the check, so the command wrote nothing.`);
			exitCode = 128 + os.constants.signals[stop];
		} else if (worker.signalCode) {
			console.error(`${worker.signalCode} killed the check, so the command wrote nothing.`);
			exitCode = 2;
		} else if ((verdict === 0 || verdict === 1) && fs.existsSync(done)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			// Read before the rename: once --out holds the whole result, no later failure may
			// report the run as failed.
			const report = fs.readFileSync(path.join(done, "report.md"));
			try {
				// The only write into --out. It fails if something appeared there during the check, so
				// nothing is overwritten.
				fs.renameSync(done, dest);
			} catch (error) {
				if (codeOf(error) !== "ENOTEMPTY" && codeOf(error) !== "EEXIST") throw error;
				throw new Error(
					`${path.join(out, fs.readdirSync(dest).sort()[0])} appeared while the check ran, so the command wrote nothing. Pass --out with a new folder.`,
					{ cause: error },
				);
			}
			exitCode = verdict;
			hold("RENAME", String(process.pid));
			// The result is whole, so a closed stdout cannot change its exit code.
			try {
				process.stdout.write(report);
				console.log(`\nWrote ${out}`);
			} catch {
				// The folder says what happened; printing is best effort.
			}
		} else exitCode = 2;
	} finally {
		fs.rmSync(stage, { recursive: true, force: true });
		fs.rmSync(tmp, { recursive: true, force: true });
		janitor.kill("SIGKILL");
	}
	process.exit(exitCode);
} catch (error) {
	if (stop) {
		console.error(`${stop} stopped the check, so the command wrote nothing.`);
		process.exit(128 + os.constants.signals[stop]);
	}
	console.error(messageOf(error));
	process.exit(2);
}
