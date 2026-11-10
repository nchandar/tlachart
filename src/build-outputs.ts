// Turns a check result into output files: find the bugs, label the graph with the user's view, draw
// the chart, build the report.

import { mermaidLines } from "./render/mermaid.ts";
import { formatMessages } from "./tlc/format-message.ts";
import { report } from "./render/report.ts";
import { PART } from "./model/constants.ts";
import { ruleKey } from "./model/rules.ts";
import {
	type Answers,
	type Bug,
	type CheckedView,
	type CheckResult,
	type Graph,
	type Story,
	type View,
	type Walk,
} from "./model/types.ts";
import { asParents, applyView, labelGraph, storiesOf } from "./analyze/label-states.ts";
import { liftChart } from "./analyze/lift-to-parents.ts";
import { checkLoops } from "./analyze/check-loops.ts";
import { findBugs, drawingOrder, walkGraph } from "./analyze/reachability.ts";
import { checkRegions } from "./analyze/check-regions.ts";
import { drawRegions } from "./analyze/draw-regions.ts";

// Splits a big chart into parts of about PART bytes, so no single string is huge.
function* inParts(lines: string[]) {
	let start = 0;
	let size = 0;
	for (let i = 0; i < lines.length; i++) {
		size += lines[i].length + 1;
		if (size > PART || i === lines.length - 1) {
			yield (start ? "\n" : "") + lines.slice(start, i + 1).join("\n");
			start = i + 1;
			size = 0;
		}
	}
}

const shortestFirst = (a: { path: unknown[] }, b: { path: unknown[] }) =>
	a.path.length - b.path.length;

/**
 * Draw as regions first; if the regions chart would mislead, redraw with parent states, then check
 * loops and lift shared arrows.
 */
export function projectChart(graph: Graph, walked: Walk, view: View, found: Bug[]) {
	const { order, rank } = drawingOrder(walked);
	const draw = (answers: Answers) => {
		const labels = labelGraph(graph, walked, answers, rank, found);
		return { labels, chart: drawRegions(walked, labels, order, found, view) };
	};
	const answers = applyView(graph, walked, view);
	const first = draw(answers);
	const lie = checkRegions(first.chart.regions, first.labels, walked, order);
	const { labels, chart } = lie ? draw(asParents(walked, answers)) : first;
	checkLoops(chart, labels, walked, found);
	return {
		chart: liftChart(lie ? { ...chart, lie } : chart),
		stories: storiesOf(graph, found, walked, first.labels),
	};
}

/**
 * Turns a result into the files to write and the exit code. A model over the budget with no broken
 * rule gets no chart; the report is always written.
 */
export function buildOutputs(result: CheckResult, view: CheckedView) {
	const walked = walkGraph(result.graph);
	const found = [...(result.paths ?? findBugs(result.graph, walked))].sort(shortestFirst);
	for (const p of result.properties) if (p.bug) found.push({ rule: p.rule, ...p.bug });
	const { chart, stories } =
		found.length || !result.paths
			? projectChart(result.graph, walked, view, found)
			: { chart: undefined, stories: new Map<Bug, Story>() };
	const text = report(result, found, chart, stories);
	const files = new Map<string, Iterable<string | Uint8Array>>();
	if (chart) files.set("chart.mmd", inParts(mermaidLines(chart)));
	files.set("report.md", [text]);
	files.set("tlc.out", formatMessages(result.messages));
	const drawn = new Set<string>();
	for (const b of found) if (b.rule.kind !== "property") drawn.add(ruleKey(b.rule));
	for (const { rule, outcome, messages } of [...result.rules, ...result.properties])
		if (outcome === "broken" && messages && !drawn.has(ruleKey(rule)))
			files.set(`tlc-${rule.name}.out`, formatMessages(messages));
	return { report: text, files, exit: result.exit };
}
