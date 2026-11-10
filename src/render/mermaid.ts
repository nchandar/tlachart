// Draws the chart as Mermaid stateDiagram-v2 text: states, arrows, bug marks and a legend.

import { addToGroup } from "../model/collections.ts";
import { tupleKey } from "../model/keys.ts";
import { compareText, groupText } from "../model/text.ts";
import { type Chart, type ChartState, type Region } from "../model/types.ts";
import { encodeText, escapeLabel } from "./mermaid-escape.ts";

const joinWithOr = (names: Iterable<string>) => [...names].sort(compareText).join(" or ");

const MARK_STYLES = {
	breaks: "fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834",
	mayBreak: "fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06",
};

/** The chart as Mermaid stateDiagram-v2 lines: states, arrows, bug marks and a legend. */
export function mermaidLines(chart: Chart) {
	let next = 0;
	const marks: string[] = [];
	const used = new Set<string>();
	const rules = { breaks: new Set<string>(), mayBreak: new Set<string>() };
	const region = (r: Region) => {
		const out: string[] = [];
		const topIds = new Map<string, string>();
		const nestedIds = new Map<string, string>();
		// Short ids (s0, s1, ...) because a label can repeat or hold text that cannot be an id.
		const id = (path: string[]) => {
			const top = path.length === 1;
			const named = top ? topIds : nestedIds;
			const k = top ? path[0] : tupleKey(path);
			let s = named.get(k);
			if (s === undefined) named.set(k, (s = `s${next++}`));
			return s;
		};
		const known = new Map<string[], string>();
		const idOf = (path: string[]) => {
			let s = known.get(path);
			if (s === undefined) known.set(path, (s = id(path)));
			return s;
		};
		const tree = (prefix: string[], indent: string, below: ChartState[]) => {
			const heads = new Map<string, ChartState[]>();
			for (const s of below) addToGroup(heads, s.path[prefix.length], s);
			for (const [head, under] of heads) {
				const path = [...prefix, head];
				let leaf: ChartState | undefined;
				const inner: ChartState[] = [];
				for (const s of under)
					if (s.path.length > path.length) inner.push(s);
					else leaf = s;
				if (inner.length) {
					out.push(`${indent}state "${escapeLabel(head, true)}" as ${id(path)} {`);
					tree(path, indent + "  ", inner);
					out.push(`${indent}}`);
				} else if (leaf) {
					const sid = idOf(leaf.path);
					out.push(`${indent}${sid}: ${escapeLabel(head)}`);
					// breaks: a rule breaks in every model state behind this chart state; mayBreak: only in
					// some of them.
					let mark: "breaks" | "mayBreak" | undefined =
						leaf.breaks.length && !leaf.works ? "mayBreak" : undefined;
					if (mark) for (const b of leaf.breaks) if (b.always) mark = "breaks";
					if (mark) for (const b of leaf.breaks) rules[mark].add(b.rule.name);
					const trail = [leaf.lead && "bugPath", leaf.repeats && "repeats"];
					const color = leaf.group === undefined ? undefined : chart.colors[groupText(leaf.group)];
					// Colors and marks are classes, so any Mermaid viewer can restyle them; only the bug
					// marks get a built-in style.
					for (const cls of [color, mark, ...trail])
						if (cls) {
							used.add(cls);
							marks.push(`  class ${sid} ${cls}`);
						}
				}
			}
		};
		tree([], "  ", r.states);
		for (const s of r.states) if (s.start) out.push(`  [*] --> ${idOf(s.path)}`);
		for (const s of r.steps)
			out.push(
				`  ${idOf(s.from)} --> ${idOf(s.to)}: ${escapeLabel(s.label + (s.when ? ` [${s.when}]` : ""))}`,
			);
		return out;
	};
	let body: string[];
	if (chart.regions.length > 1) {
		// Regions draw as concurrent composite states, split by `--`.
		body = [`  state "At the same time" as all {`];
		for (const [i, r] of chart.regions.entries()) {
			if (i) body.push("    --");
			body.push(`    state "${escapeLabel(r.name, true)}" as r${i} {`);
			for (const line of region(r)) body.push(`    ${line}`);
			body.push("    }");
		}
		body.push("  }");
	} else body = region(chart.regions[0]);
	const legend: string[][] = [];
	for (const entry of [
		...Object.entries(chart.colors),
		[`Breaks ${joinWithOr(rules.breaks)}`, "breaks"],
		[`Breaks ${joinWithOr(rules.mayBreak)} in some cases`, "mayBreak"],
		[`Path to the ${joinWithOr(chart.paths)} bug`, "bugPath"],
		[`Repeats forever, so ${joinWithOr(chart.loops)} breaks`, "repeats"],
	])
		if (used.has(entry[1])) legend.push(entry);
	const lines: string[] = [];
	// The front-matter title goes through Mermaid's own entity step, so it uses that step's
	// placeholder form.
	const title =
		chart.title && encodeText(chart.title, (n) => `ﬂ°°${n}¶ß`).replaceAll("<", "ﬂ°°60¶ß");
	if (title) lines.push("---", `title: ${JSON.stringify(title)}`, "---");
	lines.push("stateDiagram-v2");
	if (chart.regions.length > 1) lines.push("  direction LR");
	if (legend.length) {
		lines.push(`  state "Legend" as legend {`);
		for (const [i, [text]] of legend.entries()) lines.push(`    lg${i}: ${escapeLabel(text)}`);
		lines.push("  }");
		for (const [i, [, cls]] of legend.entries()) lines.push(`  class lg${i} ${cls}`);
	}
	for (const line of body) lines.push(line);
	for (const [cls, style] of Object.entries(MARK_STYLES))
		if (used.has(cls)) lines.push(`  classDef ${cls} ${style}`);
	for (const line of marks) lines.push(line);
	return lines;
}

/** The same chart as one string, ready to write to chart.mmd. */
export const mermaid = (chart: Chart) => mermaidLines(chart).join("\n");
