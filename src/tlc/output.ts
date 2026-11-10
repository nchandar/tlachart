// Reads TLC's output back in bounded pieces, so an output of many gigabytes never has to fit in
// memory.

import { Buffer } from "node:buffer";
import fs from "node:fs";
import { readMessages } from "../parse/tlc-messages.ts";
import { PART } from "../model/constants.ts";
import { type Output, type Part } from "../model/types.ts";

/** Yields a file's lines chunk by chunk, carrying a partial last line into the next chunk. */
export function* fileLines(file: string) {
	const fd = fs.openSync(file, "r");
	try {
		let buf = Buffer.allocUnsafe(PART);
		let kept = 0;
		for (;;) {
			if (kept === buf.length) buf = Buffer.concat([buf], buf.length * 2);
			const n = fs.readSync(fd, buf, kept, buf.length - kept, null);
			if (!n) break;
			const end = kept + n;
			const cut = buf.lastIndexOf(10, end - 1);
			if (cut === -1) {
				kept = end;
				continue;
			}
			yield* buf.toString("utf8", 0, cut).split("\n");
			kept = buf.copy(buf, 0, cut + 1, end);
		}
		yield buf.toString("utf8", 0, kept);
	} finally {
		fs.closeSync(fd);
	}
}

/** Presents several files (stdout, then stderr) as one stream of chunks. */
export const joined = (files: string[]): Output => {
	const fds: number[] = [];
	const sizes: number[] = [];
	for (const f of files) {
		const fd = fs.openSync(f, "r");
		fds.push(fd);
		sizes.push(fs.fstatSync(fd).size);
	}
	return {
		*[Symbol.iterator]() {
			for (let f = 0; f < fds.length; f++)
				for (let pos = 0; pos < sizes[f];) {
					const buf = Buffer.allocUnsafe(Math.min(PART, sizes[f] - pos));
					const n = fs.readSync(fds[f], buf, 0, buf.length, pos);
					if (!n) break;
					pos += n;
					yield buf.subarray(0, n);
				}
		},
	};
};

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// Splits chunks into lines, carrying a partial line across chunk edges.
function* outputLines(output: Output) {
	let rest: Uint8Array = new Uint8Array(0);
	for (const part of output) {
		const buf = rest.length ? Buffer.concat([rest, part]) : part;
		const cut = buf.lastIndexOf(10);
		if (cut === -1) {
			rest = buf;
			continue;
		}
		yield* utf8.decode(buf.subarray(0, cut)).split("\n");
		rest = buf.subarray(cut + 1);
	}
	yield utf8.decode(rest);
}

/** TLC's output as messages, read lazily so a huge output streams. */
export const messagesOf = (output: Output): Iterable<Part> => ({
	[Symbol.iterator]: () => readMessages(outputLines(output)),
});
