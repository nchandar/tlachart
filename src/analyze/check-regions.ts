// Checks that a regions chart tells the truth: its regions together must start and move exactly as
// the model does.

import { addToGroup } from "../model/collections.ts";
import { conditionHolds } from "../model/conditions.ts";
import { tupleKey, parseTupleKey } from "../model/keys.ts";
import { type Arrow, type Labels, type Region, type Walk } from "../model/types.ts";

type Move = { from: string[]; text: string; to: string[] };
type Enabled = { i: number; a: Arrow };

/**
 * Compares the moves the chart implies with the moves the model makes, and describes the first
 * mismatch in the reader's words. Undefined means they agree.
 */
export function checkRegions(
	regions: Region[],
	{ names, keys, sorted, drawnLabels, together }: Labels,
	{ from, to, starts }: Walk,
	order: Int32Array,
) {
	if (names.length < 2) return undefined;
	const combo = (i: number) => {
		const c: string[] = [];
		for (let r = 0; r < names.length; r++) c.push(keys[r][i]);
		return c;
	};
	const words = (c: string[]) => {
		const parts: string[] = [];
		for (let i = 0; i < names.length; i++)
			parts.push(`${names[i]} ${parseTupleKey(c[i]).join(" / ")}`);
		return parts.join(", ");
	};
	const addMove = (moves: Map<string, Move>, m: Move) =>
		moves.set(tupleKey([m.from, m.text, m.to]), m);
	let product: string[][] = [[]];
	for (const r of regions) {
		const next: string[][] = [];
		for (const c of product)
			for (const s of r.states) if (s.start) next.push([...c, tupleKey(s.path)]);
		product = next;
	}
	const realStarts = new Set<string>();
	for (const i of starts) realStarts.add(tupleKey(combo(i)));
	for (const c of product)
		if (!realStarts.has(tupleKey(c)))
			return `The regions chart starts at ${words(c)}, where the model never starts.`;
	// A condition that one 'and' or 'or' cannot express would draw the wrong moves, so refuse to draw
	// it.
	for (const [i, r] of regions.entries())
		for (const a of r.arrows)
			if (a.condition.kind === "tuples")
				return `In ${names[i]}, ${a.label} from ${parseTupleKey(a.from).join(" / ")} depends on the other regions in a way that one "and" or "or" condition cannot say.`;
	const real = new Map<string, Move>();
	for (const j of sorted) {
		const before = combo(from[j]);
		const after = combo(to[j]);
		if (tupleKey(before) !== tupleKey(after))
			addMove(real, { from: before, text: drawnLabels[j], to: after });
	}
	const combos = new Map<string, string[]>();
	for (const i of order) {
		const c = combo(i);
		combos.set(tupleKey(c), c);
	}
	const drawn = new Map<string, Move>();
	for (const c of combos.values()) {
		const enabled = new Map<string, Enabled[]>();
		for (const [i, r] of regions.entries()) {
			const rest: string[] = [];
			for (let k = 0; k < c.length; k++) if (k !== i) rest.push(c[k]);
			for (const a of r.arrows)
				if (a.from === c[i] && conditionHolds(a.condition, rest))
					addToGroup(enabled, a.label, { i, a });
		}
		for (const [text, list] of enabled) {
			let groups: Enabled[][] = [];
			if (together.has(text)) {
				const byRegion = new Map<number, Enabled[]>();
				for (const m of list) addToGroup(byRegion, m.i, m);
				groups = [[]];
				for (const opts of byRegion.values()) {
					const next: Enabled[][] = [];
					for (const g of groups) for (const m of opts) next.push([...g, m]);
					groups = next;
				}
			} else for (const m of list) groups.push([m]);
			for (const group of groups) {
				const to = [...c];
				for (const { i, a } of group) to[i] = a.to;
				addMove(drawn, { from: c, text, to });
			}
		}
	}
	for (const [k, extra] of drawn)
		if (!real.has(k))
			return `The regions chart lets ${words(extra.from)} go to ${words(extra.to)} by ${extra.text}, which the model never does.`;
	for (const [k, missing] of real)
		if (!drawn.has(k))
			return `The model goes from ${words(missing.from)} to ${words(missing.to)} by ${missing.text}, which the regions chart cannot show.`;
	return undefined;
}
