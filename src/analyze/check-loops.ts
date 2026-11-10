// Rejects a liveness chart that draws an arrow out of a loop which the loop cannot take.

import { addToGroup, getOrThrow } from "../model/collections.ts";
import { conditionHolds } from "../model/conditions.ts";
import { tupleKey, parseTupleKey } from "../model/keys.ts";
import { loopIndexes } from "../model/traces.ts";
import { type Arrow, type Bug, type Chart, type Labels, type Walk } from "../model/types.ts";

/**
 * For each looping bug, every arrow drawn out of a loop state must stay in the loop or be a step
 * the model really takes there; else a label must say what stops it.
 */
export function checkLoops(
	{ regions, loops }: Chart,
	{ names, keys, drawnLabels, sorted }: Labels,
	{ index, from, to }: Walk,
	found: Bug[],
) {
	const R = names.length;
	const combo = (i: number) => {
		const parts: string[] = [];
		for (let r = 0; r < R; r++) parts.push(keys[r][i]);
		return tupleKey(parts);
	};
	const stepsFrom = new Map<number, number[]>();
	const arrowsFrom: Map<string, Arrow[]>[] = [];
	if (loops.length) {
		for (const j of sorted) addToGroup(stepsFrom, from[j], j);
		for (const { arrows } of regions) {
			const out = new Map<string, Arrow[]>();
			for (const a of arrows) addToGroup(out, a.from, a);
			arrowsFrom.push(out);
		}
	}
	for (const b of found) {
		if (b.loop === undefined) continue;
		const inLoop = new Set<string>();
		// Loop states with the same label combination look identical on the chart, so a step taken from
		// any of them counts for all.
		const twinsOf = new Map<string, number[]>();
		for (const i of loopIndexes(b, index)) {
			inLoop.add(combo(i));
			addToGroup(twinsOf, combo(i), i);
		}
		for (const i of loopIndexes(b, index)) {
			const twins = getOrThrow(twinsOf, combo(i));
			for (const [r, name] of names.entries()) {
				const takes = (a: Arrow) => {
					for (const s of twins)
						for (const j of stepsFrom.get(s) ?? [])
							if (drawnLabels[j] === a.label && keys[r][to[j]] === a.to) return true;
					return false;
				};
				const rest: string[] = [];
				for (let o = 0; o < R; o++) if (o !== r) rest.push(keys[o][i]);
				for (const a of arrowsFrom[r].get(keys[r][i]) ?? []) {
					if (!conditionHolds(a.condition, rest)) continue;
					const next: string[] = [];
					for (let o = 0; o < R; o++) next.push(o === r ? a.to : keys[o][i]);
					if (!inLoop.has(tupleKey(next)) && !takes(a))
						throw new Error(
							`The chart draws the step ${a.label} out of ${name ? `${name} ` : ""}${parseTupleKey(a.from).join(" / ")}, but the ${b.rule.name} loop cannot take it there. Show in a label what stops it.`,
						);
				}
			}
		}
	}
}
