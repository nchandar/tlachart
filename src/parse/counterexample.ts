// Reads the marked states TLC prints during the drawing run, and the states of an error trace.

import { memo } from "../model/collections.ts";
import { EC } from "../model/constants.ts";
import { type Mark, type Part, type TraceState, type Value } from "../model/types.ts";
import { actionOf, messageState } from "./tlc-messages.ts";
import { BRACKET, isSpace, parseValue, tokenEnd, unreadable } from "./tla-value.ts";

// Splits a printed mark <<tag, <<values>>, {rules}>> into value texts and the rule set, using comma
// positions found while scanning.
const markTexts = (chunk: string, top: number[], inner: number[]) => {
	if (top.length !== 2) return undefined;
	const [a, b] = top;
	const open = chunk.indexOf("<<", a);
	const close = chunk.lastIndexOf(">>", b);
	const end = chunk.trimEnd().length - 2;
	if (open < 0 || chunk.slice(a + 1, open).trim() || chunk.slice(close + 2, b).trim())
		return undefined;
	if (!chunk.startsWith(">>", end)) return undefined;
	const cuts = [open + 1];
	for (const k of inner) if (k > open && k < close) cuts.push(k);
	cuts.push(close);
	const texts: string[] = [];
	for (let k = 1; k < cuts.length; k++) texts.push(chunk.slice(cuts[k - 1] + 1, cuts[k]));
	return { values: texts, rules: chunk.slice(b + 1, end) };
};

const ruleNames = (v: Value) => {
	if (typeof v !== "object" || v.kind !== "set") return undefined;
	const names: string[] = [];
	for (const m of v.members) {
		if (typeof m !== "string") return undefined;
		names.push(m);
	}
	return names;
};

/**
 * A mark can wrap over many lines, so scan with bracket depth and treat a chunk as whole when depth
 * returns to 0.
 */
export function* readMarks(messages: Iterable<Part>, tag: string): Generator<Mark> {
	const read = memo(parseValue);
	const start = `"${tag}",`;
	let chunk = "";
	let depth = 0;
	let top: number[] = [];
	let inner: number[] = [];
	for (const line of messages) {
		if (typeof line !== "string") continue;
		if (!chunk) {
			if (!line.startsWith("<<") || !line.slice(2).trimStart().startsWith(start)) continue;
			depth = 0;
			top = [];
			inner = [];
		}
		const base = chunk.length;
		chunk += line + "\n";
		let i = 0;
		let last = 0;
		while (i < line.length) {
			const c = line.charCodeAt(i);
			if (isSpace(c)) {
				i++;
				continue;
			}
			const j = tokenEnd(line, i);
			if (j === -1) throw unreadable(line + "\n", last);
			if (c === 44 && depth === 1) top.push(base + i);
			else if (c === 44 && depth === 2) inner.push(base + i);
			depth += BRACKET[c];
			i = last = j;
		}
		if (depth > 0) continue;
		const texts = markTexts(chunk, top, inner);
		const values: Value[] = [];
		if (texts) for (const v of texts.values) values.push(read(v));
		const broken = texts && ruleNames(read(texts.rules));
		if (!broken)
			throw new Error(`TLC printed a mark that the command cannot read:\n${chunk.slice(0, 2000)}`);
		chunk = "";
		yield { values, broken };
	}
	if (chunk)
		throw new Error(
			`TLC's output ends inside a marked state, so the command cannot tell which rules it breaks:\n${chunk.slice(0, 2000)}`,
		);
}

/** TLC's error trace in order; a violation in the initial state has no action name. */
export function readCounterexample(messages: Iterable<Part>) {
	const trace: TraceState[] = [];
	for (const m of messages) {
		if (typeof m === "string") continue;
		const action = m.code === EC.TLC_STATE_PRINT2 ? actionOf(m) : undefined;
		if (action !== undefined) trace.push({ action, vars: messageState(m) });
		else if (
			m.code === EC.TLC_INVARIANT_VIOLATED_INITIAL ||
			m.code === EC.TLC_PROPERTY_VIOLATED_INITIAL
		)
			trace.push({ action: "", vars: messageState(m) });
	}
	return trace;
}
