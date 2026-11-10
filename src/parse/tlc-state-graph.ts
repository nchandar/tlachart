// Reads TLC's -dump dot file into a state graph, and parses state labels into variables.

import { type Graph, type State, type Step, type Value, type Vars } from "../model/types.ts";
import { parseValue } from "./tla-value.ts";

// DOT escapes quotes and newlines inside labels; undo that, and drop escaped line breaks.
const unescapeDot = (s: string) => {
	let i = s.indexOf("\\");
	if (i === -1) return s;
	let out = "";
	let from = 0;
	for (; i !== -1 && i + 1 < s.length; i = s.indexOf("\\", i)) {
		const c = s[i + 1];
		if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") {
			i++;
			continue;
		}
		out += s.slice(from, i) + (c === "n" ? "\n" : c);
		i += 2;
		from = i;
	}
	return out + s.slice(from);
};

/**
 * Splits a state label's conjunction-separated lines into variables. `parsed` caches repeated
 * lines, since most states repeat values.
 */
export const parseState = (label: string, parsed = new Map<string, [string, Value]>()): Vars => {
	const pairs: [string, Value][] = [];
	for (const part of (label.startsWith("/\\ ") ? label.slice(3) : label).split("\n/\\ ")) {
		let pair = parsed.get(part);
		if (!pair) {
			const [, name, value] = /^(\w+)\s*=\s*([\s\S]*)$/.exec(part) ?? [];
			if (!name) throw new Error(`cannot read the TLC state line "${part}"`);
			parsed.set(part, (pair = [name, parseValue(value)]));
		}
		pairs.push(pair);
	}
	return Object.fromEntries(pairs);
};

type Lines = string | Iterable<string>;

/** A dump's lines: a whole string is split once, a stream is used as it comes. */
export const linesOf = (input: Lines) => (typeof input === "string" ? input.split("\n") : input);

/** Reads a dot dump into states and steps. */
export function parseDot(input: Lines): Graph {
	const states = new Map<string, State>();
	const steps = new Map<string, Step>();
	const parsed = new Map<string, [string, Value]>();
	const owned = new Map<string, string>();
	// Copy each string out of its source line, so the graph does not keep the whole dump alive in
	// memory.
	const own = (s: string) => {
		let copy = owned.get(s);
		if (copy === undefined) owned.set((copy = String(JSON.parse(JSON.stringify(s)))), copy);
		return copy;
	};
	for (const line of linesOf(input)) {
		const edge = /^(-?\d+) -> (-?\d+) \[label="([^"]*)"/.exec(line);
		if (edge) {
			steps.set(edge.slice(1).join(" "), {
				from: own(edge[1]),
				to: own(edge[2]),
				action: own(edge[3]),
			});
			continue;
		}
		const node = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(,style = filled)?/.exec(line);
		if (node)
			states.set(own(node[1]), {
				vars: parseState(unescapeDot(node[2]), parsed),
				start: !!node[3],
				breaks: [],
			});
	}
	// A step to or from an unlisted state means the dump was cut short.
	for (const loose of steps.values())
		if (!states.has(loose.from) || !states.has(loose.to))
			throw new Error(
				`The TLC graph dump has a step ${loose.action} to or from a state that it does not list.`,
			);
	return { states, steps: [...steps.values()] };
}
