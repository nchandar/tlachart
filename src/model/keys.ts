// Canonical text keys for values and states, so equal values share a key whatever order TLC printed
// them in.

import { compareText, isStringArray } from "./text.ts";
import { type Value } from "./types.ts";

/** Joins parts into one key; the JSON form keeps a part that holds a comma unambiguous. */
export const tupleKey = (parts: unknown[]) => JSON.stringify(parts);

/** Reads a key tupleKey wrote, and fails loudly on anything else so a bad cache key cannot pass. */
export const parseTupleKey = (k: string) => {
	const parts: unknown = JSON.parse(k);
	if (!isStringArray(parts)) throw new Error(`The chart cannot read the key ${k}.`);
	return parts;
};

const ascending = (keys: string[]) => {
	for (let i = 1; i < keys.length; i++) if (keys[i - 1] > keys[i]) return false;
	return true;
};

const span = (lo: number, hi: number) => (hi > lo ? `${lo}..${hi}` : String(lo));

// Sorts, drops repeats and folds integer runs into lo..hi, so {1,2,3} and {3,1,2} share a key.
const setKey = (members: Value[]) => {
	const ints: number[] = [];
	let others: string[] = [];
	for (const m of members)
		if (typeof m === "number") ints.push(m);
		else others.push(valueKey(m));
	for (let i = 1; i < ints.length; i++)
		if (ints[i - 1] >= ints[i]) {
			ints.sort((a, b) => a - b);
			break;
		}
	if (!ascending(others)) others = others.sort(compareText);
	let s = "{";
	for (let i = 0; i < ints.length;) {
		let j = i;
		while (j + 1 < ints.length && ints[j + 1] - ints[j] <= 1) j++;
		s += `${s.length > 1 ? "," : ""}${span(ints[i], ints[j])}`;
		i = j + 1;
	}
	for (let i = 0; i < others.length; i++)
		if (!i || others[i] !== others[i - 1]) s += (s.length > 1 ? "," : "") + others[i];
	return s + "}";
};

// Orders entries by key, and keys a function over 1..n as a tuple, so equal functions share a key.
const functionKey = ({ keys, values }: { keys: Value[]; values: Value[] }) => {
	const order: number[] = [];
	const keyTexts: string[] = [];
	let ints = 0;
	for (let i = 0; i < keys.length; i++) {
		order.push(i);
		keyTexts.push(valueKey(keys[i]));
		if (typeof keys[i] === "number") ints++;
	}
	const rank = (i: number) => (typeof keys[i] === "number" ? keys[i] : Infinity);
	order.sort((a, b) => rank(a) - rank(b) || compareText(keyTexts[a], keyTexts[b]) || a - b);
	let tuple = ints === keys.length;
	for (let i = 0; tuple && i < order.length; i++) tuple = keys[order[i]] === i + 1;
	let s = tuple ? "<<" : "(";
	for (let i = 0, kept = 0; i < order.length; i++) {
		const k = order[i];
		if (i && keyTexts[k] === keyTexts[order[i - 1]]) continue;
		const v = valueKey(values[k]);
		s += tuple ? `${kept++ ? "," : ""}${v}` : `${kept++ ? "@@" : ""}${keyTexts[k]}:>${v}`;
	}
	return s + (tuple ? ">>" : ")");
};

// Compound keys are cached per object because the same value is keyed many times.
const keys = new WeakMap<object, string>();

/** Scalars key as themselves; compound values are computed once and cached. */
export const valueKey = (v: Value): string => {
	switch (typeof v) {
		case "boolean":
			return v ? "TRUE" : "FALSE";
		case "number":
			return String(v);
		case "string":
			return JSON.stringify(v);
	}
	if (v.kind === "model") return v.name;
	let k = keys.get(v);
	if (k === undefined) {
		k =
			v.kind === "interval"
				? `{${v.lo > v.hi ? "" : span(v.lo, v.hi)}}`
				: v.kind === "set"
					? setKey(v.members)
					: functionKey(v);
		keys.set(v, k);
	}
	return k;
};

/** The key of a whole state, its values in the order the caller passes them. */
export const stateKey = (values: Value[]) => {
	let k = "";
	for (let i = 0; i < values.length; i++) k += (i ? "," : "") + valueKey(values[i]);
	return k;
};
