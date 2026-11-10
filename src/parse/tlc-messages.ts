// Splits TLC's -tool output into coded messages (STARTMSG to ENDMSG, nesting allowed) and the loose
// lines between them.

import type { Message, Part } from "../model/types.ts";
import { linesOf, parseState } from "./tlc-state-graph.ts";

const START = /@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
const END = /^@!@!@ENDMSG \d+ @!@!@$/;

const isCutMarker = (lastLine: string) => lastLine.startsWith("@!@!@");

// A run killed mid-message leaves messages open; trim the empty tails and keep what was read.
function cutMessage(open: Message[]) {
	for (let i = open.length - 1; i > 0 && !open[i].body.length; i--) open[i - 1].body.pop();
	return open[0]?.body.length ? open[0] : undefined;
}

/** Yields each coded message whole, and the loose lines between messages as plain strings. */
export function* readMessages(tlcOut: string | Iterable<string>): Generator<Part> {
	const lines = linesOf(tlcOut)[Symbol.iterator]();
	const open: Message[] = [];
	try {
		for (let next = lines.next(); !next.done;) {
			const line = next.value;
			next = lines.next();
			if (next.done && (!line || isCutMarker(line))) break;
			const start = START.exec(line);
			if (start) {
				const message: Message = { code: Number(start[1]), level: Number(start[2]), body: [] };
				if (start.index) message.beforeMarker = line.slice(0, start.index);
				open.at(-1)?.body.push(message);
				open.push(message);
			} else if (END.test(line)) {
				const done = open.pop();
				if (done && !open.length) yield done;
			} else if (open.length) open[open.length - 1].body.push(line);
			else yield line;
		}
	} finally {
		lines.return?.();
	}
	const cut = cutMessage(open);
	if (cut) yield cut;
}

/** The message's own text lines, without its nested messages. */
export const textOf = ({ body }: Message) =>
	body.filter((part) => typeof part === "string").join("\n");

/** The action name from a state line TLC prints, or undefined for a state that has none. */
export const actionOf = (m: Message) => /^\d+: (?:Back to state: )?<([^\s>]+)/.exec(textOf(m))?.[1];

/** The variables printed under a state line, up to the first blank line. */
export const messageState = (m: Message) => {
	const lines = textOf(m).split("\n");
	const body: string[] = [];
	for (let i = 1; i < lines.length && lines[i].trim(); i++) body.push(lines[i]);
	return parseState(body.join("\n"));
};
