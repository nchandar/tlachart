// Indexes the state graph into typed arrays and walks it breadth-first from the start states, then
// orders states for drawing and finds each rule's shortest bug path.

import { indices, getOrThrow, sortByKeys } from "../model/collections.ts";
import { ruleKey } from "../model/rules.ts";
import { compareText, defaultStateLabel } from "../model/text.ts";
import {
	type Bug,
	type Graph,
	type PathStep,
	type Rule,
	type State,
	type Step,
	type Walk,
} from "../model/types.ts";

/** The graph as state arrays, with each state's index and label rank. */
type Indexed = {
	ids: string[];
	states: State[];
	nameOf: string[];
	starts: number[];
	index: Map<string, number>;
	nameRank: Int32Array;
};

/** The step table as typed arrays, plus one bucket of steps per state for the walk. */
type Edges = {
	from: Int32Array;
	to: Int32Array;
	action: Int32Array;
	first: Int32Array;
	next: Int32Array;
};

/**
 * Numbers the states in TLC's order and ranks their labels, so the chart does not depend on the
 * order TLC dumped them in.
 */
function indexStates(graph: Graph): Indexed {
	const ids: string[] = [];
	const states: State[] = [];
	const nameOf: string[] = [];
	const starts: number[] = [];
	const unique = new Set<string>();
	for (const [id, s] of graph.states) {
		const name = defaultStateLabel(s.vars);
		if (s.start) starts.push(ids.length);
		ids.push(id);
		states.push(s);
		nameOf.push(name);
		unique.add(name);
	}
	const names = Array.from(unique).sort(compareText);
	const rankOf = new Map<string, number>();
	for (let i = 0; i < names.length; i++) rankOf.set(names[i], i);
	const n = ids.length;
	const index = new Map<string, number>();
	const nameRank = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		index.set(ids[i], i);
		nameRank[i] = getOrThrow(rankOf, nameOf[i]);
	}
	return { ids, states, nameOf, starts, index, nameRank };
}

/** One rank per step for its action name, so equal actions sort alike however TLC ordered them. */
function rankActions(steps: readonly Step[]): Int32Array {
	const actions = new Map<string, number>();
	for (const t of steps) if (!actions.has(t.action)) actions.set(t.action, actions.size);
	const actionRank = new Int32Array(actions.size);
	for (const [i, a] of [...actions.keys()].sort(compareText).entries())
		actionRank[getOrThrow(actions, a)] = i;
	const rank = new Int32Array(steps.length);
	for (let j = 0; j < steps.length; j++) rank[j] = actionRank[getOrThrow(actions, steps[j].action)];
	return rank;
}

/**
 * Resolves each step's ends to state indexes and buckets the steps by their start state, so the
 * walk reads only numbers.
 */
function buildEdges(graph: Graph, { index, nameRank }: Indexed, action: Int32Array): Edges {
	const m = graph.steps.length;
	const n = nameRank.length;
	const from = new Int32Array(m);
	const to = new Int32Array(m);
	const toName = new Int32Array(m);
	for (let j = 0; j < m; j++) {
		const t = graph.steps[j];
		from[j] = getOrThrow(index, t.from);
		to[j] = getOrThrow(index, t.to);
		toName[j] = nameRank[to[j]];
	}
	const first = new Int32Array(n + 1);
	for (let j = 0; j < m; j++) first[from[j] + 1]++;
	for (let i = 0; i < n; i++) first[i + 1] += first[i];
	const fill = first.slice(0, n);
	const next = new Int32Array(m);
	for (const j of sortByKeys(indices(m), [action, toName])) next[fill[from[j]]++] = j;
	return { from, to, action, first, next };
}

/**
 * Walks the edge buckets breadth-first from the start states: depth is the shortest distance, via
 * is the step that first reached each state.
 */
function breadthFirst(
	starts: number[],
	nameRank: Int32Array,
	{ to, first, next }: Edges,
): { depth: Int32Array; via: Int32Array; reached: Int32Array } {
	// Start states in label order, so the walk does not depend on TLC's ids.
	starts.sort((a, b) => nameRank[a] - nameRank[b]);
	const n = first.length - 1;
	const depth = new Int32Array(n).fill(-1);
	const via = new Int32Array(n).fill(-1);
	const reached = new Int32Array(n);
	let size = 0;
	for (const s of starts) {
		depth[s] = 0;
		reached[size++] = s;
	}
	for (let q = 0; q < size; q++) {
		const s = reached[q];
		for (let e = first[s]; e < first[s + 1]; e++) {
			const t = to[next[e]];
			if (depth[t] >= 0) continue;
			depth[t] = depth[s] + 1;
			via[t] = next[e];
			reached[size++] = t;
		}
	}
	return { depth, via, reached: reached.subarray(0, size) };
}

/**
 * Ranks states and steps by label and action name, not by TLC's ids, so the chart is the same
 * however TLC numbered its dump.
 */
export function walkGraph(graph: Graph): Walk {
	const indexed = indexStates(graph);
	const edges = buildEdges(graph, indexed, rankActions(graph.steps));
	const { depth, via, reached } = breadthFirst(indexed.starts, indexed.nameRank, edges);
	return {
		ids: indexed.ids,
		states: indexed.states,
		index: indexed.index,
		nameOf: indexed.nameOf,
		nameRank: indexed.nameRank,
		from: edges.from,
		to: edges.to,
		action: edges.action,
		depth,
		via,
		reached,
		starts: indexed.starts,
	};
}

/** Draw states by distance from the start, unreachable ones last, ties broken by label. */
export function drawingOrder({ depth, nameRank }: Walk) {
	const n = depth.length;
	let deepest = 0;
	for (let i = 0; i < n; i++) if (depth[i] > deepest) deepest = depth[i];
	const level = new Int32Array(n);
	for (let i = 0; i < n; i++) level[i] = depth[i] < 0 ? deepest + 1 : depth[i];
	const order = sortByKeys(indices(n), [level, nameRank]);
	const rank = new Int32Array(n);
	for (let p = 0; p < n; p++) rank[order[p]] = p;
	return { order, rank };
}

/**
 * One bug per broken rule: the shortest path to the first state that breaks it, read back through
 * `via`.
 */
export function findBugs(graph: Graph, { ids, from, via, reached }: Walk = walkGraph(graph)) {
	const ends = new Map<string, string>();
	for (const [id, s] of graph.states) for (const rule of s.ends ?? []) ends.set(ruleKey(rule), id);
	const first = new Map<string, { rule: Rule; i: number }>();
	for (const i of reached) {
		const s = getOrThrow(graph.states, ids[i]);
		for (const rule of s.past ? s.ends : s.breaks) {
			const k = ruleKey(rule);
			if (!first.has(k) && (ends.get(k) ?? ids[i]) === ids[i]) first.set(k, { rule, i });
		}
	}
	const found: Bug[] = [];
	for (const { rule, i } of first.values()) {
		const path: PathStep[] = [];
		let start = i;
		for (let j: number; (j = via[start]) >= 0; start = from[j]) {
			const step = graph.steps[j];
			path.unshift({ action: step.action, state: step.to, step });
		}
		found.push({ rule, start: ids[start], path });
	}
	return found;
}
