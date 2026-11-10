// Turns a finished TLC process into an exit class and a short error message.

import { formatMessages } from "./format-message.ts";
import { LEVEL } from "../model/constants.ts";
import { type Part, type Stop } from "../model/types.ts";
import { messagesOf } from "./output.ts";
import type { FileResult } from "./process.ts";

/**
 * TLC exits 11, 12 and 13 for a deadlock, an invariant break and a liveness break, which are
 * results; any other non-zero exit is a failure.
 */
export const exitClass = (status: number | null): 0 | 1 | 2 =>
	status === 0 ? 0 : status === 11 || status === 12 || status === 13 ? 1 : 2;

/**
 * The last 30 lines of TLC's output; the kept text is capped at 256M characters so a huge output
 * cannot exhaust memory.
 */
export const tail = (r: FileResult) => {
	if (r.error) return r.error.message;
	const kept: string[] = [];
	let size = 0;
	for (const chunk of formatMessages(messagesOf(r.output))) {
		kept.push(chunk);
		size += chunk.length;
		while (size - kept[0].length >= 1 << 28) size -= kept.shift()!.length;
	}
	return kept.join("").trim().split("\n").slice(-30).join("\n");
};

/**
 * Why TLC stopped: its own error messages when it printed any, else the tail of its output; capped
 * at 40 lines.
 */
export const stopOf = (r: FileResult): Stop => {
	const errors: Part[] = [];
	for (const m of r.error ? [] : messagesOf(r.output))
		if (
			typeof m !== "string" &&
			(m.level === LEVEL.ERROR ||
				m.level === LEVEL.TLCBUG ||
				(errors.length && m.level === LEVEL.STATE))
		)
			errors.push(m);
	if (!errors.length) return { status: r.status, message: tail(r) };
	const lines = [...formatMessages(errors)].join("").trim().split("\n");
	if (lines.length > 40) lines.splice(40, Infinity, `... ${lines.length - 40} more lines`);
	return { status: r.status, message: lines.join("\n") };
};

/** Why the check cannot go on: TLC's own reason, with its exit status. */
export const checkError = (specFile: string, r: FileResult) =>
	new Error(`TLC could not check ${specFile} (exit ${r.status}):\n${stopOf(r).message}`);
