// Draws the chart: the full state graph after a marked second run when the model fits the budget,
// else only the paths to the broken rules taken from TLC's counterexamples.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	addPastStates,
	findLasso,
	markBrokenStates,
	markDeadEnds,
	makeStateFinder,
} from "../analyze/mark-states.ts";
import { buildPathGraph } from "../analyze/bug-paths.ts";
import { readCounterexample, readMarks } from "../parse/counterexample.ts";
import { parseDot } from "../parse/tlc-state-graph.ts";
import { readMessages } from "../parse/tlc-messages.ts";
import { readVerdict } from "../parse/tlc-verdict.ts";
import { getOrThrow } from "../model/collections.ts";
import { CHART_STATES } from "../model/constants.ts";
import { hasSection, ruleKey } from "../model/rules.ts";
import {
	type Bug,
	type CheckResult,
	type Mark,
	type Rule,
	type Spec,
	type Trace,
	type Verdict,
} from "../model/types.ts";
import { checkError } from "./exit.ts";
import { markedRunModule } from "./generated-modules.ts";
import { propertiesOf } from "./judge.ts";
import { fileLines, messagesOf } from "./output.ts";
import { PINNED_FLAGS } from "./process.ts";
import type { Runner } from "./runner.ts";

// Keeps marks only for invariants that really broke, so a mark never blames a rule TLC did not
// report.
function* only(marks: Iterable<Mark>, rules: Set<string>) {
	for (const { values, broken } of marks) {
		const kept: string[] = [];
		for (const name of broken) if (rules.has(name)) kept.push(name);
		if (kept.length) yield { values, broken: kept };
	}
}

/** What drawing needs from the decided check. */
export type DrawInput = {
	run: Runner;
	spec: Spec;
	rules: Rule[];
	all: Rule[];
	verdicts: Map<string, Verdict>;
	initialOnly: Set<string>;
	specFile: string;
};

/** The drawing half of the result: the graph, its bug paths, the properties and the drawing status. */
export type Drawn = Pick<CheckResult, "graph" | "paths" | "properties" | "drawing">;

/**
 * Dumps the whole graph with a marked second run, so TLC explores past bugs and still says where
 * they are. Returns undefined when the model outgrew the chart budget.
 */
export async function drawGraph({
	run,
	spec,
	rules,
	all,
	verdicts,
	initialOnly,
	specFile,
}: DrawInput): Promise<Drawn | undefined> {
	const { dir, config, runJava } = run;
	const tag = `chart-${randomBytes(16).toString("hex")}`;
	fs.writeFileSync(path.join(dir, "ChartRun.tla"), markedRunModule(spec, tag));
	// A second run with ChartMark: it always holds but prints a mark where a rule is broken, so TLC
	// explores past bugs and still says where they are.
	const drawn = await runJava("ChartRun", "tlc2.TLC", [
		"-tool",
		...PINNED_FLAGS,
		"-deadlock",
		...config("ChartRun", spec.written, ["INVARIANT ChartMark", "CONSTRAINT ChartBudget"]),
		"-dump",
		"dot,actionlabels",
		path.join(dir, "graph"),
		"ChartRun",
	]);
	const file = path.join(dir, "graph.dot");
	if (!fs.existsSync(file)) throw checkError(specFile, drawn);
	if (readVerdict(messagesOf(drawn.output)).distinct > CHART_STATES) return undefined;
	const graph = parseDot(fileLines(file));
	const find = makeStateFinder(graph, spec.variables);
	// Records a drawing run that stopped early, so the report can say the chart is partial.
	const drawing = drawn.status === 0 ? undefined : { status: drawn.status };
	const broken = new Set<string>();
	for (const { rule, outcome } of verdicts.values())
		if (rule.kind === "invariant" && outcome === "broken") broken.add(rule.name);
	const marks = only(readMarks(readMessages(fileLines(drawn.stdout)), tag), broken);
	const past = markBrokenStates(graph, marks, spec.variables, rules, find);
	const excludes = hasSection(spec, "ACTION_CONSTRAINT");
	for (const rule of rules) {
		const { outcome, messages } = getOrThrow(verdicts, ruleKey(rule));
		if (
			rule.kind === "deadlock" &&
			outcome === "broken" &&
			!drawing &&
			!hasSection(spec, "CONSTRAINT", "ACTION_CONSTRAINT")
		)
			markDeadEnds(graph, rule);
		if (outcome !== "broken" || !messages) continue;
		const counterexample = readCounterexample(messages);
		if (
			!drawing ||
			findLasso(graph, { seq: counterexample, loop: undefined }, spec.variables, find)
		)
			addPastStates(graph, counterexample, spec.variables, rule, past, excludes, find);
	}
	const properties = propertiesOf(all, verdicts, initialOnly, (trace: Trace) =>
		findLasso(graph, trace, spec.variables, find),
	);
	return { graph, paths: undefined, properties, drawing };
}

/** Draws only the paths to the broken rules, built from TLC's counterexamples. */
export function drawPaths({
	spec,
	rules,
	all,
	verdicts,
	initialOnly,
}: Omit<DrawInput, "run" | "specFile">): Drawn {
	const drawn = buildPathGraph(spec.variables);
	const paths: Bug[] = [];
	for (const rule of rules) {
		const { outcome, messages } = getOrThrow(verdicts, ruleKey(rule));
		if (outcome === "broken" && messages) paths.push(drawn.bug(rule, readCounterexample(messages)));
	}
	const properties = propertiesOf(all, verdicts, initialOnly, drawn.lasso);
	return { graph: drawn.graph, paths, properties, drawing: undefined };
}
