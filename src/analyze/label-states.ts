// Asks the user's view for the words on every state and step, checks the answers, and numbers them
// for the drawing passes.

import { getOrThrow, sortByKeys } from "../model/collections.ts";
import { valueKey, tupleKey } from "../model/keys.ts";
import { isRecord, joinList, stateText } from "../model/text.ts";
import { loopIndexes } from "../model/traces.ts";
import {
	type Answers,
	type Bug,
	type Graph,
	type Hidden,
	type Labels,
	type Rule,
	type Shape,
	type Step,
	type Story,
	type Vars,
	type View,
	type Walk,
} from "../model/types.ts";

// A label must be real text; 'undefined' or '[object Object]' in it means the view missed a case.
const isLabel = (l: unknown): l is string =>
	typeof l === "string" && l !== "" && !/\bundefined\b|\bNaN\b|\[object Object\]/.test(l);

// Normalizes a state() answer: a string is flat, an array is a parent path, an object is regions.
// All become {region: path}.
const shapeOf = (shape: unknown, vars: Vars): Shape => {
	function fail(): never {
		throw new Error(
			`The view's state() returned ${JSON.stringify(shape) ?? "undefined"} for the state ${stateText(vars)}. Return a string, an array of strings, or an object of those.`,
		);
	}
	const path = (p: unknown) => {
		const labels: string[] = [];
		for (const l of [p].flat()) {
			if (!isLabel(l)) fail();
			labels.push(l);
		}
		if (!labels.length) fail();
		return labels;
	};
	const regions: [string, unknown][] = isRecord(shape) ? Object.entries(shape) : [["", shape]];
	const pairs: [string, string[]][] = [];
	for (const [k, v] of regions) pairs.push([k, path(v)]);
	return pairs.length ? Object.fromEntries(pairs) : fail();
};

// step() may return null to hide a step; without a step() the label is the action's own name.
const stepOf = (view: View) => (action: string, from: Vars, to: Vars) => {
	const label = (view.step ?? ((a: string) => a))(action, from, to);
	if (label === null || isLabel(label)) return label;
	throw new Error(
		`The view's step() returned ${JSON.stringify(label) ?? "undefined"} for the step ${action}.`,
	);
};

// A hidden step on a bug's path would break the story the report tells, so refuse and name the
// step.
function refuseHiddenStep(
	action: string,
	before: Vars,
	after: Vars,
	bug: { rule: Rule; loop?: number },
): never {
	const changed: string[] = [];
	for (const k of Object.keys(after))
		if (valueKey(before[k]) !== valueKey(after[k])) changed.push(k);
	throw new Error(
		`The view's step() returned null for the step ${action} that changes ${changed.join(", ") || "nothing"}. It is on the path to the ${bug.rule.name} bug${bug.loop === undefined ? "" : " or leaves its loop"}, so label it.`,
	);
}

/**
 * Calls state() and step() once per state and step, and group() lazily and once, since a view may
 * not define it.
 */
export function applyView(
	graph: Graph,
	{ states: tla, nameOf, from, to }: Walk,
	view: View,
): Answers {
	const n = nameOf.length;
	const m = from.length;
	const state = view.state;
	const shapes = new Array<Shape>(n);
	for (let i = 0; i < n; i++)
		shapes[i] = shapeOf(state ? state(tla[i].vars) : nameOf[i], tla[i].vars);
	const names = Object.keys(shapes[0] ?? { "": [] });
	const regionsKey = tupleKey(names);
	for (let i = 0; i < n; i++)
		if (tupleKey(Object.keys(shapes[i])) !== regionsKey)
			throw new Error(
				`The view's state() returned the regions ${names.join(", ")} for one state and ${Object.keys(shapes[i]).join(", ")} for the state ${stateText(tla[i].vars)}. Return the same regions for every state.`,
			);
	const step = stepOf(view);
	const labels = new Array<string | Hidden>(m);
	for (let j = 0; j < m; j++)
		labels[j] = step(graph.steps[j].action, tla[from[j]].vars, tla[to[j]].vars);
	const groups = new Array<unknown>(n);
	const asked = new Uint8Array(n);
	const group = (i: number) => {
		if (view.group && !asked[i]) {
			groups[i] = view.group(tla[i].vars);
			asked[i] = 1;
		}
		return groups[i];
	};
	return { names, shapes, labels, group };
}

/** Re-reads a regions answer as one parent path (region name, then label) for the nested chart. */
export function asParents(
	{ states: tla }: Walk,
	{ names, shapes, labels, group }: Answers,
): Answers {
	const parents = new Array<Shape>(shapes.length);
	for (let i = 0; i < shapes.length; i++) {
		const path: string[] = [];
		for (const n of names) for (const p of shapes[i][n]) path.push(`${n} ${p}`);
		parents[i] = shapeOf(path, tla[i].vars);
	}
	return { names: [""], shapes: parents, labels, group };
}

/** Maps each step on a bug's path to its index, and flags those indexes for the drawing passes. */
function bugPathSteps(graph: Graph, found: Bug[]) {
	const onPath = new Set<Step>();
	for (const b of found) for (const p of b.path) onPath.add(p.step);
	const pathStepIndex = new Map<Step, number>();
	if (onPath.size)
		for (let j = 0; j < graph.steps.length; j++)
			if (onPath.has(graph.steps[j])) pathStepIndex.set(graph.steps[j], j);
	const pathSteps = new Uint8Array(graph.steps.length);
	for (const j of pathStepIndex.values()) pathSteps[j] = 1;
	return { pathStepIndex, pathSteps };
}

/**
 * Per region, each state's key and kind number, so a step can say which regions it changes and a
 * reader can follow the nesting.
 */
function regionKeys(names: string[], shapes: Shape[]) {
	const n = shapes.length;
	const keys: string[][] = [];
	const kinds: Int32Array[] = [];
	const sizes: number[] = [];
	for (const name of names) {
		const key = new Array<string>(n);
		const kind = new Int32Array(n);
		const tops = new Map<string, number>();
		const nested = new Map<string, number>();
		const keyOf: string[] = [];
		for (let i = 0; i < n; i++) {
			const path = shapes[i][name];
			const top = path.length === 1;
			const seen = top ? tops : nested;
			const k = top ? path[0] : tupleKey(path);
			let c = seen.get(k);
			if (c === undefined) {
				seen.set(k, (c = keyOf.length));
				keyOf.push(top ? tupleKey(path) : k);
			}
			key[i] = keyOf[c];
			kind[i] = c;
		}
		keys.push(key);
		kinds.push(kind);
		sizes.push(keyOf.length);
	}
	return { keys, kinds, sizes };
}

/**
 * Refuses a hidden step that a bug's story needs: one on its path, or one that leaves its
 * liveness loop.
 */
function refuseHiddenBugSteps(
	graph: Graph,
	{ index, from, to }: Walk,
	stepLabels: (string | Hidden)[],
	found: Bug[],
	pathStepIndex: Map<Step, number>,
): void {
	const m = stepLabels.length;
	for (const b of found) {
		let t: Step | undefined;
		for (const p of b.path)
			if (stepLabels[getOrThrow(pathStepIndex, p.step)] === null) {
				t = p.step;
				break;
			}
		if (!t) {
			const inLoop = loopIndexes(b, index);
			if (inLoop.size)
				for (let j = 0; j < m; j++)
					if (inLoop.has(from[j]) && !inLoop.has(to[j]) && stepLabels[j] === null) {
						t = graph.steps[j];
						break;
					}
		}
		if (t)
			refuseHiddenStep(
				t.action,
				getOrThrow(graph.states, t.from).vars,
				getOrThrow(graph.states, t.to).vars,
				b,
			);
	}
}

/**
 * The steps the view keeps, in drawing order: by start rank, then end rank, then action name, so
 * the chart is the same however TLC ordered its dump.
 */
function drawnSteps(stepLabels: (string | Hidden)[], rank: Int32Array, { from, to, action }: Walk) {
	const m = stepLabels.length;
	const drawn: number[] = [];
	const drawnLabels = new Array<string>(m);
	for (let j = 0; j < m; j++) {
		const label = stepLabels[j];
		if (label === null) continue;
		drawn.push(j);
		drawnLabels[j] = label;
	}
	const fromRank = new Int32Array(m);
	const toRank = new Int32Array(m);
	for (let j = 0; j < m; j++) {
		fromRank[j] = rank[from[j]];
		toRank[j] = rank[to[j]];
	}
	const sorted = sortByKeys(Int32Array.from(drawn), [fromRank, toRank, action]);
	return { drawnLabels, sorted };
}

/**
 * Notes a label whose steps change several regions together or one at a time, so the reader knows
 * why one arrow names more than one region.
 */
function regionNotes(
	names: string[],
	kinds: Int32Array[],
	sorted: Int32Array,
	drawnLabels: string[],
	{ from, to }: Walk,
): { together: Set<string>; notes: string[] } {
	const R = names.length;
	const byLabel = new Map<string, { changed: Uint8Array; sets: Set<string> }>();
	if (R > 1)
		for (const j of sorted) {
			let entry = byLabel.get(drawnLabels[j]);
			if (!entry)
				byLabel.set(drawnLabels[j], (entry = { changed: new Uint8Array(R), sets: new Set() }));
			const changed: string[] = [];
			for (let r = 0; r < R; r++)
				if (kinds[r][from[j]] !== kinds[r][to[j]]) {
					changed.push(names[r]);
					entry.changed[r] = 1;
				}
			if (changed.length > 1) entry.sets.add(joinList(changed));
		}
	const together = new Set<string>();
	for (const [text, { sets }] of byLabel) if (sets.size) together.add(text);
	const notes: string[] = [];
	for (const [text, entry] of byLabel) {
		const changed: string[] = [];
		for (let r = 0; r < R; r++) if (entry.changed[r]) changed.push(names[r]);
		if (changed.length < 2) continue;
		if (!together.has(text)) {
			notes.push(`The step ${text} changes only one of ${joinList(changed)} at a time.`);
			continue;
		}
		const sets = [...entry.sets];
		notes.push(
			`The step ${text} changes ${sets.length > 1 ? `${sets.join(", or ")},` : sets[0]} at the same time.`,
		);
	}
	return { together, notes };
}

/**
 * Per region: each state's key and kind, and a check that bug-path steps stay drawn. Also notes
 * labels whose steps change several regions together.
 */
export function labelGraph(
	graph: Graph,
	walk: Walk,
	answers: Answers,
	rank: Int32Array,
	found: Bug[],
): Labels {
	const { names, shapes, labels: stepLabels } = answers;
	const { pathStepIndex, pathSteps } = bugPathSteps(graph, found);
	const { keys, kinds, sizes } = regionKeys(names, shapes);
	refuseHiddenBugSteps(graph, walk, stepLabels, found, pathStepIndex);
	const { drawnLabels, sorted } = drawnSteps(stepLabels, rank, walk);
	const { together, notes } = regionNotes(names, kinds, sorted, drawnLabels, walk);
	return {
		...answers,
		drawnLabels,
		keys,
		kinds,
		sizes,
		sorted,
		pathStepIndex,
		pathSteps,
		together,
		notes,
	};
}

type Told<Id> = { rule: Rule; start: Id; path: { action: string; state: Id }[]; loop?: number };

// Builds each bug's story: the states and step labels in the order the reader will see them.
function buildStories<Id, B extends Told<Id>>(
	states: ReadonlyMap<Id, { vars: Vars }>,
	found: B[],
	shapeAt: (id: Id) => Shape,
	labelAt: (bug: B, k: number, from: Id) => string | Hidden,
) {
	const vars = (id: Id) => getOrThrow(states, id).vars;
	const stories = new Map<B, Story>();
	for (const bug of found) {
		const story: Story = [{ state: shapeAt(bug.start) }];
		let from: Id = bug.start;
		for (const [k, p] of bug.path.entries()) {
			const step = labelAt(bug, k, from);
			if (step === null) refuseHiddenStep(p.action, vars(from), vars(p.state), bug);
			story.push({ step, state: shapeAt(p.state) });
			from = p.state;
		}
		stories.set(bug, story);
	}
	return stories;
}

/**
 * Each bug's story in reader order: the start state, then each step label and the state it leads
 * to.
 */
export const storiesOf = (
	graph: Graph,
	found: Bug[],
	{ index }: Walk,
	{ shapes, drawnLabels, pathStepIndex }: Labels,
) =>
	buildStories(
		graph.states,
		found,
		(id) => shapes[getOrThrow(index, id)],
		(bug, k) => drawnLabels[getOrThrow(pathStepIndex, bug.path[k].step)],
	);
