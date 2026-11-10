// Turns the labelled graph into a chart of regions: the states of each region and arrows that say
// when they apply to the other regions.

import { addToGroup, getOrThrow } from "../model/collections.ts";
import { conditionHolds } from "../model/conditions.ts";
import { tupleKey, parseTupleKey } from "../model/keys.ts";
import { hasRule, ruleKey } from "../model/rules.ts";
import { compareText } from "../model/text.ts";
import { loopIndexes, indexSequence } from "../model/traces.ts";
import {
	type Arrow,
	type Bug,
	type Chart,
	type ChartState,
	type ChartStep,
	type Condition,
	type Labels,
	type Region,
	type Rule,
	type State,
	type View,
	type Walk,
} from "../model/types.ts";

// A single-region arrow has no other regions to depend on.
const anyRest: Condition = { kind: "and", otherKeys: [] };

// Moves between the same two states with different labels chain through `other`.
type RegionMove = {
	f: number;
	t: number;
	text: string;
	group: number[];
	other: RegionMove | undefined;
};

/** Builds each region's states and arrows, then the chart-wide notes, bug paths and loops. */
export function drawRegions(
	walk: Walk,
	labels: Labels,
	order: Int32Array,
	found: Bug[],
	view: View,
): Chart {
	const { states: tla } = walk;
	const { names, drawnLabels, kinds, sorted, notes } = labels;
	const marks = markBugStates(found, walk.index, labels.shapes.length);
	const inside = countInsideSteps(walk, labels);
	const { dirty, clean } = markDirtyCombinations(order, tla, kinds);
	const regions: Region[] = [];
	const objects: ChartState[][] = [];
	for (let r = 0; r < names.length; r++) {
		const built = buildRegion(walk, labels, order, r, marks, clean);
		regions.push(built.region);
		objects.push(built.objects);
	}
	hideBrokenCombinations(dirty, objects, kinds);
	const { paths, loops } = bugRuleNames(found);
	return {
		title: view.title,
		regions,
		notes,
		inside,
		quiet: drawnLabels.length - sorted.length,
		colors: view.colors ?? {},
		paths,
		loops,
	};
}

/** States on a bug's path up to its loop, and the states a liveness loop repeats. */
type BugMarks = { lead: Uint8Array; looped: Uint8Array };

/** Marks every model state a bug walks through and every state a liveness loop repeats. */
function markBugStates(found: Bug[], index: ReadonlyMap<string, number>, n: number): BugMarks {
	const lead = new Uint8Array(n);
	const looped = new Uint8Array(n);
	for (const b of found) {
		for (const i of indexSequence(b, index).slice(0, b.loop)) lead[i] = 1;
		for (const i of loopIndexes(b, index)) looped[i] = 1;
	}
	return { lead, looped };
}

/** Counts the drawn steps that stay inside one label and are not a liveness loop. */
function countInsideSteps(walk: Walk, labels: Labels) {
	const { from, to } = walk;
	const { kinds, sorted, pathSteps } = labels;
	let inside = 0;
	for (const j of sorted)
		if (staysInLabel(j, from, to, kinds) && !isLoopStep(j, kinds.length, pathSteps)) inside++;
	return inside;
}

/** True when every region keeps its label across the step. */
function staysInLabel(j: number, from: Int32Array, to: Int32Array, kinds: Int32Array[]) {
	for (const kind of kinds) if (kind[from[j]] !== kind[to[j]]) return false;
	return true;
}

/** In a single-region chart, a step TLC loops through is drawn again though its label stays. */
function isLoopStep(j: number, R: number, pathSteps: Uint8Array) {
	return R === 1 && pathSteps[j] === 1;
}

/** The combination of labels one model state has, in region order. */
function labelCombination(kinds: Int32Array[], i: number): number | string {
	if (kinds.length === 1) return kinds[0][i];
	let c = "";
	for (let r = 0; r < kinds.length; r++) c += (r ? "," : "") + kinds[r][i];
	return c;
}

/** Finds the label combinations that break a rule, and which chart states have a clean one. */
function markDirtyCombinations(order: Int32Array, tla: State[], kinds: Int32Array[]) {
	const dirty = new Map<number | string, number>();
	for (const i of order)
		if (tla[i].breaks.length) {
			const c = labelCombination(kinds, i);
			if (!dirty.has(c)) dirty.set(c, i);
		}
	const clean = new Uint8Array(tla.length);
	if (dirty.size)
		for (let i = 0; i < tla.length; i++) clean[i] = dirty.has(labelCombination(kinds, i)) ? 0 : 1;
	else clean.fill(1);
	return { dirty, clean };
}

/** One region's chart states by label, with the lookups its moves and arrows need. */
type RegionStates = {
	states: Map<string, ChartState>;
	objectOf: ChartState[];
	keyOf: string[];
	position: Int32Array;
};

/** A chart state before any model state has marked it. */
const newChartState = (path: string[]): ChartState => ({
	path,
	start: false,
	members: [],
	works: false,
	lead: false,
	repeats: false,
	breaks: [],
	group: undefined,
});

/** Builds one region's chart states, merging the model states that share a label. */
function buildRegionStates(
	walk: Walk,
	labels: Labels,
	order: Int32Array,
	r: number,
	marks: BugMarks,
	clean: Uint8Array,
): RegionStates {
	const { states: tla } = walk;
	const { names, shapes, keys, kinds, sizes } = labels;
	const name = names[r];
	const key = keys[r];
	const kind = kinds[r];
	const states = new Map<string, ChartState>();
	const objectOf = new Array<ChartState>(sizes[r]);
	const keyOf = new Array<string>(sizes[r]);
	const position = new Int32Array(sizes[r]);
	for (const i of order) {
		const s = tla[i];
		let o = objectOf[kind[i]];
		if (!o) {
			o = newChartState(shapes[i][name]);
			objectOf[kind[i]] = o;
			keyOf[kind[i]] = key[i];
			position[kind[i]] = states.size;
			states.set(key[i], o);
		}
		o.start ||= s.start;
		o.works ||= clean[i] === 1;
		o.lead ||= marks.lead[i] === 1;
		o.repeats ||= marks.looped[i] === 1;
		o.members.push(i);
	}
	return { states, objectOf, keyOf, position };
}

/** Refuses a label that is both a state and a parent of another, which Mermaid cannot draw. */
function checkStatePaths(states: Map<string, ChartState>, name: string) {
	const parents = new Set<string>();
	for (const s of states.values())
		for (let i = 1; i < s.path.length; i++) parents.add(tupleKey(s.path.slice(0, i)));
	for (const s of states.values())
		if (parents.size && parents.has(tupleKey(s.path)))
			throw new Error(
				`The view's state() returned ${s.path.join(" / ")} both as a state and as a parent state${name ? ` in ${name}` : ""}. Give that state a child name of its own.`,
			);
}

/** Sets the rules a chart state breaks, and whether every member state breaks each one. */
function describeBreaks(s: ChartState, tla: State[]) {
	const rules = new Map<string, Rule>();
	for (const i of s.members) for (const rule of tla[i].breaks) rules.set(ruleKey(rule), rule);
	for (const rule of [...rules.values()].sort(
		(a, b) => compareText(a.name, b.name) || compareText(a.kind, b.kind),
	)) {
		let always = true;
		for (const i of s.members) always &&= hasRule(tla[i].breaks, rule);
		s.breaks.push({ rule, always });
	}
}

/** Sets the group a chart state belongs to, when all its member states share one. */
function describeGroup(s: ChartState, group: (i: number) => unknown) {
	const groups = new Set<unknown>();
	for (const i of s.members) groups.add(group(i));
	s.group = groups.size === 1 ? [...groups][0] : undefined;
}

/** What an arrow needs to say about the regions other than its own. */
type Rest = {
	/** The other regions' indexes. */
	others: number[];
	/** The other regions' labels at a model state, in `others` order. */
	tuple: (i: number) => string[];
	/** Model states sharing each other-region tuple, by this region's chart state. */
	tuplesAt: Map<number, number[]>;
	/** Tuples already read at each chart state of this region. */
	seenAt: Map<number, string[][]>;
	/** True when one other region exists, so its labels read as a bare condition. */
	two: boolean;
	words: (vs: Iterable<string>) => string;
	is: (o: number, vs: Set<string>) => string;
	isNot: (o: number, vs: string[]) => string;
};

/** The labels seen at a move's start and the ones it takes, per other region. */
type Tallies = { all: Set<string>[]; and: Set<string>[]; or: Set<string>[] };

/** Builds one region's states, arrows and steps from the labelled graph. */
function buildRegion(
	walk: Walk,
	labels: Labels,
	order: Int32Array,
	r: number,
	marks: BugMarks,
	clean: Uint8Array,
): { region: Region; objects: ChartState[] } {
	const { states: tla } = walk;
	const { names, group } = labels;
	const built = buildRegionStates(walk, labels, order, r, marks, clean);
	checkStatePaths(built.states, names[r]);
	for (const s of built.states.values()) {
		describeBreaks(s, tla);
		describeGroup(s, group);
	}
	const rest = buildRest(labels, r, order);
	const moves = buildMoves(walk, labels, r, built.position);
	const arrows = buildArrows(walk, rest, moves, built.keyOf);
	const steps = buildSteps(moves, arrows, built.objectOf);
	return {
		region: { name: names[r], states: [...built.states.values()], steps, arrows },
		objects: built.objectOf,
	};
}

/** The other regions' names, labels and lookups that one region's arrows read. */
function buildRest(labels: Labels, r: number, order: Int32Array): Rest {
	const { names, keys, kinds } = labels;
	const others: number[] = [];
	for (let o = 0; o < names.length; o++) if (o !== r) others.push(o);
	const tuple = (i: number) => {
		const t: string[] = [];
		for (const o of others) t.push(keys[o][i]);
		return t;
	};
	const two = others.length === 1;
	const words = (vs: Iterable<string>) => {
		const texts: string[] = [];
		for (const v of vs) texts.push(parseTupleKey(v).join(" / "));
		return texts.sort(compareText).join(two ? " or " : ", ");
	};
	const is = (o: number, vs: Set<string>) =>
		two ? `when ${words(vs)}` : `${names[o]} is ${vs.size > 1 ? "one of " : ""}${words(vs)}`;
	const isNot = (o: number, vs: string[]) =>
		two
			? `unless ${words(vs)}`
			: `${names[o]} is ${vs.length > 1 ? "none of" : "not"} ${words(vs)}`;
	const tuplesAt = new Map<number, number[]>();
	if (others.length) for (const i of order) addToGroup(tuplesAt, kinds[r][i], i);
	return { others, tuple, tuplesAt, seenAt: new Map(), two, words, is, isNot };
}

/** Groups the drawn steps into moves between chart states, one per start, end and label. */
function buildMoves(walk: Walk, labels: Labels, r: number, position: Int32Array): RegionMove[] {
	const { from, to } = walk;
	const { drawnLabels, kinds, sizes, sorted, pathSteps } = labels;
	const R = kinds.length;
	const kind = kinds[r];
	const moves: RegionMove[] = [];
	const pairs = new Map<number, RegionMove>();
	const size = sizes[r];
	for (const j of sorted) {
		const f = kind[from[j]];
		const t = kind[to[j]];
		if (f === t && !isLoopStep(j, R, pathSteps)) continue;
		const text = drawnLabels[j];
		const pair = position[f] * size + position[t];
		let move = pairs.get(pair);
		// The same start and end with another label is a second arrow, chained through `other`.
		while (move && move.text !== text) move = move.other;
		if (!move) {
			move = { f, t, text, group: [], other: pairs.get(pair) };
			pairs.set(pair, move);
			moves.push(move);
		}
		if (R > 1) move.group.push(j);
	}
	return moves;
}

/** One arrow per move, in move order, so each step can find its arrow by index. */
function buildArrows(walk: Walk, rest: Rest, moves: RegionMove[], keyOf: string[]): Arrow[] {
	const arrows: Arrow[] = [];
	for (const move of moves)
		arrows.push(arrowForMove(walk, rest, move, keyOf[move.f], keyOf[move.t]));
	return arrows;
}

/** Decides the condition one move needs on the other regions, from the model's own choices. */
function arrowForMove(walk: Walk, rest: Rest, move: RegionMove, from: string, to: string): Arrow {
	const arrow = { from, to, label: move.text };
	if (!rest.others.length) return { ...arrow, condition: anyRest, when: undefined };
	const ok = new Set<string>();
	for (const j of move.group) ok.add(tupleKey(rest.tuple(walk.from[j])));
	const takes = (t: string[]) => ok.has(tupleKey(t));
	const seen = seenTuples(rest, move.f);
	const tallies = tallyLabels(rest, seen, takes);
	// 'and' (all listed values), else 'or' (any of them), else the exact tuples; fitsChoices proves
	// the condition matches the model's own choices.
	const andHolds: Condition = { kind: "and", otherKeys: tallies.and };
	const orHolds: Condition = { kind: "or", otherKeys: tallies.or };
	if (fitsChoices(seen, takes, andHolds))
		return { ...arrow, condition: andHolds, when: andWhen(rest, tallies) };
	if (fitsChoices(seen, takes, orHolds))
		return { ...arrow, condition: orHolds, when: orWhen(rest, tallies.or) };
	return { ...arrow, condition: { kind: "tuples", otherTuples: ok } };
}

/** For each other region, the labels seen at the move's start and the ones it takes. */
function tallyLabels(rest: Rest, seen: string[][], takes: (t: string[]) => boolean): Tallies {
	const all: Set<string>[] = [];
	const and: Set<string>[] = [];
	const or: Set<string>[] = [];
	for (let j = 0; j < rest.others.length; j++) {
		const values = new Set<string>();
		const taken = new Set<string>();
		const untaken = new Set<string>();
		for (const t of seen) {
			values.add(t[j]);
			if (takes(t)) taken.add(t[j]);
			else untaken.add(t[j]);
		}
		const only = new Set<string>();
		for (const v of values) if (!untaken.has(v)) only.add(v);
		all.push(values);
		and.push(taken);
		or.push(only);
	}
	return { all, and, or };
}

/** True when the condition agrees with the move on every tuple seen at its start. */
function fitsChoices(seen: string[][], takes: (t: string[]) => boolean, condition: Condition) {
	for (const t of seen) if (conditionHolds(condition, t) !== takes(t)) return false;
	return true;
}

/** The words for an 'and' condition, or none when every other region's label is free. */
function andWhen(rest: Rest, { all, and }: Tallies) {
	const parts: string[] = [];
	for (let j = 0; j < rest.others.length; j++) {
		const no: string[] = [];
		for (const v of all[j]) if (!and[j].has(v)) no.push(v);
		// Name the smaller set: the values the move takes, or the ones it leaves out.
		if (no.length)
			parts.push(
				and[j].size <= no.length ? rest.is(rest.others[j], and[j]) : rest.isNot(rest.others[j], no),
			);
	}
	return parts.length ? (rest.two ? parts[0] : `when ${parts.join(" and ")}`) : undefined;
}

/** The words for an 'or' condition: the labels the move may take in each other region. */
function orWhen(rest: Rest, or: Set<string>[]) {
	const parts: string[] = [];
	for (let j = 0; j < rest.others.length; j++)
		if (or[j].size) parts.push(rest.is(rest.others[j], or[j]));
	return `when ${parts.join(" or ")}`;
}

/** The distinct other-region tuples seen at one chart state, read once per region. */
function seenTuples(rest: Rest, f: number) {
	let seen = rest.seenAt.get(f);
	if (!seen) {
		seen = [];
		const seenKeys = new Set<string>();
		for (const i of getOrThrow(rest.tuplesAt, f)) {
			const t = rest.tuple(i);
			const k = tupleKey(t);
			if (seenKeys.has(k)) continue;
			seenKeys.add(k);
			seen.push(t);
		}
		rest.seenAt.set(f, seen);
	}
	return seen;
}

/** The steps Mermaid draws; a label that ends in [..] already states its own condition. */
function buildSteps(moves: RegionMove[], arrows: Arrow[], objectOf: ChartState[]): ChartStep[] {
	const steps: ChartStep[] = [];
	for (const [k, a] of arrows.entries())
		steps.push({
			from: objectOf[moves[k].f].path,
			to: objectOf[moves[k].t].path,
			label: a.label,
			when: a.label.endsWith("]") ? undefined : a.when,
		});
	return steps;
}

/** Clears `works` on the chart states of a breaking combination that still all look fine. */
function hideBrokenCombinations(
	dirty: Map<number | string, number>,
	objects: ChartState[][],
	kinds: Int32Array[],
) {
	const hidden: ChartState[][] = [];
	for (const i of dirty.values()) {
		const ps: ChartState[] = [];
		for (const [r, objs] of objects.entries()) ps.push(objs[kinds[r][i]]);
		let works = true;
		for (const s of ps) works &&= s.works;
		if (works) hidden.push(ps);
	}
	for (const ps of hidden) for (const s of ps) s.works = false;
}

/** The rule names the legend lists for a shortest path and for a liveness loop. */
function bugRuleNames(found: Bug[]) {
	const paths: string[] = [];
	const loops: string[] = [];
	for (const b of found) {
		if (b.loop !== 0) paths.push(b.rule.name);
		if (b.loop !== undefined) loops.push(b.rule.name);
	}
	return { paths, loops };
}
