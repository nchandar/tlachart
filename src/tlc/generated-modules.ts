// Builds the text of the small TLA+ modules and config the command adds to a run, so the user's own
// files are never edited.

import { CHART_STATES, RERUN_STATES } from "../model/constants.ts";
import { type ConfigSection, type Spec } from "../model/types.ts";

/** Rebuilds a config from the kept sections plus the lines this run adds. */
export function formatConfig(sections: ConfigSection[], extra: string[]) {
	const lines: string[] = [];
	for (const s of sections) lines.push(`${s.key} ${s.tokens.join(" ")}`);
	lines.push(...extra);
	return lines.join("\n");
}

/** A constraint that stops TLC at RERUN_STATES distinct states. */
export const boundedRunModule = (module: string) =>
	[
		`---- MODULE ChartBound ----`,
		`EXTENDS ${module}`,
		`ChartTLC == INSTANCE TLC`,
		`ChartNaturals == INSTANCE Naturals`,
		`ChartBound == ChartNaturals!<(ChartTLC!TLCGet("distinct"), ${RERUN_STATES})`,
		`====`,
	].join("\n");

/**
 * Prints a tagged mark for each state that breaks an invariant, so the parser can find it in TLC's
 * output; the CONSTRAINT stops exploring at CHART_STATES.
 */
export function markedRunModule({ module, variables, invariants }: Spec, tag: string) {
	const every: string[] = [];
	for (const name of invariants) every.push(`(IF ~${name} THEN {"${name}"} ELSE {}) \\cup `);
	return [
		`---- MODULE ChartRun ----`,
		`EXTENDS ${module}`,
		`ChartTLC == INSTANCE TLC`,
		`ChartNaturals == INSTANCE Naturals`,
		`ChartBudget == ChartNaturals!<=(ChartTLC!TLCGet("distinct"), ${CHART_STATES})`,
		`ChartBroken == ${every.join("")}{}`,
		`ChartMark == ChartBroken = {} \\/ ChartTLC!PrintT(<<"${tag}", <<${variables.join(", ")}>>, ChartBroken>>)`,
		`====`,
	].join("\n");
}
