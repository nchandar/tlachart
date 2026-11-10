// Decides each rule by running TLC and reading its verdict, rerunning without the rules it already
// settled so one break does not hide the rest.

import { readTrace } from "../parse/tlc-trace.ts";
import { type Break, readVerdict } from "../parse/tlc-verdict.ts";
import { getOrThrow } from "../model/collections.ts";
import { RERUN_STATES } from "../model/constants.ts";
import { ruleKey } from "../model/rules.ts";
import {
	type CheckResult,
	type Lasso,
	type Outcome,
	type Property,
	type Rule,
	type Spec,
	type Stop,
	type Trace,
	type Verdict,
} from "../model/types.ts";
import { exitClass, stopOf, tail } from "./exit.ts";
import { messagesOf } from "./output.ts";
import { type FileResult, PINNED_FLAGS } from "./process.ts";
import type { Runner } from "./runner.ts";

const names = (rules: Rule[], kind: Rule["kind"]) => {
	const found: string[] = [];
	for (const rule of rules) if (rule.kind === kind) found.push(rule.name);
	return found;
};

// Maps what TLC said broke back to one of our rules. An invariant name may belong to a property,
// and deadlock has no name; a liveness break names no rule.
const brokenRule = (rules: Rule[], broke: Break) => {
	if (broke.kind === "temporal") return undefined;
	for (const rule of rules)
		if (rule.kind === broke.kind && (broke.kind === "deadlock" || rule.name === broke.name))
			return rule;
	if (broke.kind === "invariant")
		for (const rule of rules) if (rule.kind === "property" && rule.name === broke.name) return rule;
	return undefined;
};

/** What the rule runs established: the first run, why TLC stopped, the state counts and the verdicts. */
export type Judged = {
	first: FileResult;
	stop: Stop | undefined;
	states: CheckResult["states"];
	verdicts: Map<string, Verdict>;
};

/**
 * Decides every rule. A run names one broken rule and the rest are rerun without it. A liveness
 * break names no property, so the properties are then run one by one.
 */
export async function judgeRules(
	{ config, runJava }: Runner,
	spec: Spec,
	all: Rule[],
	specFile: string,
): Promise<Judged> {
	const verdicts = new Map<string, Verdict>();
	const decide = (rule: Rule, outcome: Outcome, r?: FileResult) =>
		verdicts.set(ruleKey(rule), { rule, outcome, messages: r && messagesOf(r.output) });
	const groups = [all];
	let first: FileResult | undefined;
	let stop: Stop | undefined;
	const states = { distinct: 0, initial: 0, complete: false, cut: false };
	for (let k = 1; groups.length;) {
		const group: Rule[] = [];
		for (const rule of groups[0]) if (!verdicts.has(ruleKey(rule))) group.push(rule);
		if (first && !group.length) {
			groups.shift();
			continue;
		}
		const name = `verdict-${k++}`;
		const extra: string[] = [];
		const invariants = names(group, "invariant");
		const properties = names(group, "property");
		if (invariants.length) extra.push(`INVARIANT ${invariants.join(" ")}`);
		if (properties.length) extra.push(`PROPERTY ${properties.join(" ")}`);
		// After the first run each rerun is capped, so a big model cannot hang the command.
		const bounded = first !== undefined && !states.complete;
		if (bounded) extra.push("CONSTRAINT ChartBound");
		const r = await runJava(name, "tlc2.TLC", [
			"-tool",
			...PINNED_FLAGS,
			...(names(group, "deadlock").length ? [] : ["-deadlock"]),
			...config(name, spec.written, extra),
			bounded ? "ChartBound" : spec.module,
		]);
		first ??= r;
		const { broke, distinct, initial } = readVerdict(messagesOf(r.output));
		states.distinct = Math.max(states.distinct, distinct);
		states.initial = Math.max(states.initial, initial);
		const rule = broke && brokenRule(group, broke);
		const cut = bounded && distinct >= RERUN_STATES;
		if (exitClass(r.status) === 2) {
			stop = stopOf(r);
			break;
		} else if (rule) decide(rule, "broken", r);
		else if (cut && (r.status === 0 || broke?.kind === "temporal")) {
			states.cut = true;
			for (const rule of group) decide(rule, "not checked");
		} else if (r.status === 0) {
			states.complete = true;
			for (const rule of group) decide(rule, "holds");
		} else if (broke && properties.length) {
			if (broke.kind === "temporal") {
				states.complete = true;
				for (const rule of group) if (rule.kind !== "property") decide(rule, "holds");
			}
			const pending: Rule[][] = [];
			const rest: Rule[] = [];
			for (const rule of group)
				if (rule.kind === "property") pending.push([rule]);
				else if (!verdicts.has(ruleKey(rule))) rest.push(rule);
			if (pending.length === 1) decide(pending[0][0], "broken", r);
			else groups.splice(0, 1, rest, ...pending);
		} else
			throw new Error(
				`TLC exited ${r.status} on ${specFile}, but its output names no rule that broke:\n${tail(r)}`,
			);
	}
	for (const rule of all) if (!verdicts.has(ruleKey(rule))) decide(rule, "not checked");
	return { first: first!, stop, states, verdicts };
}

/** Each property's verdict, plus its liveness counterexample and whether TLC checked only the start. */
export function propertiesOf(
	all: Rule[],
	verdicts: Map<string, Verdict>,
	initialOnly: Set<string>,
	bugOf: (trace: Trace) => Lasso | undefined,
) {
	const properties: Property[] = [];
	for (const rule of all) {
		if (rule.kind !== "property") continue;
		const v = getOrThrow(verdicts, ruleKey(rule));
		properties.push({
			...v,
			bug: v.outcome === "broken" && v.messages ? bugOf(readTrace(v.messages)) : undefined,
			initialOnly: initialOnly.has(rule.name),
		});
	}
	return properties;
}
