// Starts TLC and its helpers as child processes and reports how they ended.

import { type ChildProcess, execFile, type ExecFileException, spawn } from "node:child_process";
import fs from "node:fs";
import { inspect } from "node:util";
import { type Output } from "../model/types.ts";
import { joined } from "./output.ts";

/**
 * One worker, a fixed fingerprint function and liveness checked at the end, so TLC's output repeats
 * exactly from run to run.
 */
export const PINNED_FLAGS = ["-workers", "1", "-fp", "0", "-lncheck", "final"];

type ChildResult = {
	status: number | null;
	stdout: string;
	stderr: string;
	error: ExecFileException | undefined;
};

/** Runs a short command to completion; a failure to start is returned as `error`, never thrown. */
export const runChild = (
	file: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
) =>
	new Promise<ChildResult>((resolve) => {
		execFile(
			file,
			args,
			{ encoding: "utf8", maxBuffer: 1 << 30, ...options },
			(error, stdout, stderr) =>
				resolve({
					status: error ? (typeof error.code === "number" ? error.code : null) : 0,
					stdout,
					stderr,
					error: typeof error?.code === "string" ? error : undefined,
				}),
		);
	});

/** Kills the whole process group, since a Java child would otherwise outlive its killed parent. */
export const killGroup = (pid: number) =>
	new Promise((resolve) =>
		spawn("/bin/sh", ["-c", 'kill -s KILL -- "-$1"', "sh", String(pid)], { stdio: "ignore" }).on(
			"exit",
			resolve,
		),
	);

/** Any thrown value as text; a non-Error is inspected. */
export const messageOf = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"message" in error &&
	typeof error.message === "string"
		? error.message
		: inspect(error);

/** What one child left on disk: its exit status, where its output went and why it failed to start. */
export type FileResult = {
	status: number | null;
	stdout: string;
	output: Output;
	error: Error | undefined;
};

/**
 * Sends TLC's output to files, not pipes, so a huge output never sits in memory; it is read back in
 * chunks.
 */
export const runToFiles = (
	file: string,
	args: string[],
	{ out, ...options }: { out: string; cwd: string; env: NodeJS.ProcessEnv },
) =>
	new Promise<FileResult>((resolve) => {
		const files = [`${out}.stdout`, `${out}.stderr`];
		const fds: number[] = [];
		for (const f of files) fds.push(fs.openSync(f, "w"));
		let child: ChildProcess;
		try {
			child = spawn(file, args, { ...options, stdio: ["ignore", ...fds] });
		} finally {
			for (const fd of fds) fs.closeSync(fd);
		}
		let error: Error | undefined;
		const settle = (code: number | null) =>
			resolve({
				status: error ? null : code,
				stdout: files[0],
				output: joined(files),
				error,
			});
		// With no pid the process never started and 'close' never fires, so settle on 'error' instead.
		child.on("error", (e) => {
			error = e;
			if (child.pid === undefined) settle(null);
		});
		child.on("close", (code) => {
			if (child.pid !== undefined) settle(code);
		});
	});
