// Turns TLC counterexamples into paths over the state graph, looking each state up by its values.

import { getOrThrow } from "./collections.ts";
import { hasRule } from "./rules.ts";
import {
	type Bug,
	type Find,
	type PastState,
	type Rule,
	type Trace,
	type TraceState,
	type Value,
	type Vars,
} from "./types.ts";

/** The bug's states as graph indexes, start first. */
export const indexSequence = (bug: Bug, index: ReadonlyMap<string, number>) => {
	const seq = [getOrThrow(index, bug.start)];
	for (const p of bug.path) seq.push(getOrThrow(index, p.state));
	return seq;
};

/** Indexes of the states a liveness counterexample loops through; empty when it has no loop. */
export const loopIndexes = (bug: Bug, index: ReadonlyMap<string, number>) =>
	new Set(bug.loop === undefined ? [] : indexSequence(bug, index).slice(bug.loop));

/** A state's values in the spec's declared order, the form the key and lookups use. */
export const valuesOf = (vars: Vars, names: string[]) => {
	const values: Value[] = [];
	for (const n of names) values.push(vars[n]);
	return values;
};

/**
 * Looks each state up in the graph. TLC's dump lists every state but the last, so only the last may
 * be missing.
 */
export const findTrace = <Id>(
	counterexample: TraceState[],
	names: string[],
	rule: Rule,
	find: Find<Id>,
) => {
	const trace: (TraceState & { values: Value[]; id: Id | undefined })[] = [];
	for (const { action, vars } of counterexample) {
		const values = valuesOf(vars, names);
		trace.push({ action, vars, values, id: find(values) });
	}
	const end = trace.length - 1;
	if (end < 0) throw new Error(`TLC's trace for ${rule.name} has no states.`);
	for (let i = 0; i < end; i++)
		if (trace[i].id === undefined)
			throw new Error(
				`TLC's trace for ${rule.name} has a state before its last that the dump does not list.`,
			);
	return trace;
};

/** The same lookup for a liveness trace, keeping where the loop starts. */
export const findLoop = <Id>({ seq, loop }: Trace, names: string[], find: Find<Id>) => {
	const found: { action: string; id: Id | undefined }[] = [];
	for (const { action, vars } of seq)
		found.push({ action, id: vars && find(valuesOf(vars, names)) });
	return { seq: found, loop };
};

/** A state past a CONSTRAINT bound: TLC checks the rules there but never explores onward. */
export const pastState = (
	vars: Vars,
	start: boolean,
	marked: Iterable<Rule>,
	excluded: boolean,
): PastState => {
	const breaks: Rule[] = [];
	for (const r of marked) if (!hasRule(breaks, r)) breaks.push(r);
	return { vars, start, breaks, ends: [], past: true, excluded };
};
