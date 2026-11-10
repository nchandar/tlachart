// How values and states print as TLA+, plus small type guards and helpers for sorting and joining
// names.

import { type Value, type Vars } from "./types.ts";

/** True for a plain object; arrays and null are rejected, so both can be told apart from a record. */
export const isRecord = (v: unknown): v is { [key: string]: unknown } =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** True for an array in which every item is a string, the shape every key tuple must have. */
export const isStringArray = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((s) => typeof s === "string");

/** Code-unit order, so sorting names never depends on the machine's locale. */
export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reads as a sentence: "a, b and c". One item is returned alone, never with an "and".
 */
export const joinList = (items: string[], and = "and") =>
	items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

const ESCAPES: { [c: string]: string } = {
	'"': '\\"',
	"\\": "\\\\",
	"\n": "\\n",
	"\t": "\\t",
	"\r": "\\r",
	"\f": "\\f",
};

const quote = (s: string) => `"${s.replace(/["\\\n\t\r\f]/g, (c) => ESCAPES[c])}"`;

const joined = (items: Value[], sep: string) => {
	let s = "";
	for (let i = 0; i < items.length; i++) s += (i ? sep : "") + showValue(items[i]);
	return s;
};

/** Prints a value the way TLC does, so the report matches TLC's own output. */
export const showValue = (v: Value): string => {
	switch (typeof v) {
		case "boolean":
			return v ? "TRUE" : "FALSE";
		case "number":
			return String(v);
		case "string":
			return quote(v);
	}
	switch (v.kind) {
		case "model":
			return v.name;
		case "interval":
			return `${v.lo}..${v.hi}`;
		case "set":
			return `{${joined(v.members, ", ")}}`;
		case "function": {
			if (v.printedAs === "tuple") return `<<${joined(v.values, ", ")}>>`;
			const record = v.printedAs === "record";
			let s = record ? "[" : "(";
			for (let i = 0; i < v.keys.length; i++)
				s += record
					? `${i ? ", " : ""}${recordKey(v.keys[i])} |-> ${showValue(v.values[i])}`
					: `${i ? " @@ " : ""}${showValue(v.keys[i])} :> ${showValue(v.values[i])}`;
			return s + (record ? "]" : ")");
		}
	}
};

/** Label when a view gives none: the lone value, or name=value pairs. */
export const defaultStateLabel = (vars: Vars) => {
	const entries = Object.entries(vars);
	if (entries.length === 1) return showValue(entries[0][1]);
	const parts: string[] = [];
	for (const [k, v] of entries) parts.push(`${k}=${showValue(v)}`);
	return parts.join(" ");
};

/** A state as TLC prints it in a trace, conjuncts joined by the TLA+ and. */
export const stateText = (vars: Vars) => {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(vars)) parts.push(`${k} = ${showValue(v)}`);
	return parts.join(" /\\ ");
};

// A record's keys are strings; anything else falls back to its printed form.
const recordKey = (key: Value) => (typeof key === "string" ? key : showValue(key));

/** A group() answer names a color by its text, so any answer is read as text. */
export const groupText = (group: unknown) => String(group);
