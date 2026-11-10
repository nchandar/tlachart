// Rule identity, and the rules TLC checks for a spec.

import { CHECK_DEADLOCK } from "./constants.ts";
import { tupleKey } from "./keys.ts";
import { type Rule, type Spec } from "./types.ts";

/** Kind plus name identifies a rule, since an invariant and a property can share a name. */
export const ruleKey = (rule: Rule) => tupleKey([rule.kind, rule.name]);

/** True when the list already holds this rule, so a state breaking it twice is marked once. */
export const hasRule = (rules: Rule[], rule: Rule) => {
	for (const r of rules) if (r.kind === rule.kind && r.name === rule.name) return true;
	return false;
};

// TLC checks deadlock by default; its name must not clash with a user's NoDeadlock.
const deadlockRule = ({ invariants, properties }: Spec): Rule => ({
	kind: "deadlock",
	name:
		invariants.includes("NoDeadlock") || properties.includes("NoDeadlock")
			? CHECK_DEADLOCK
			: "NoDeadlock",
});

/** True when the config or spec names any of these section keywords. */
export const hasSection = ({ written }: Spec, ...keys: string[]) => {
	for (const s of written) if (keys.includes(s.key)) return true;
	return false;
};

/** Rules about single states: every invariant, plus deadlock when it is on. */
export const stateRules = (spec: Spec) => {
	const rules: Rule[] = [];
	for (const name of spec.invariants) rules.push({ kind: "invariant", name });
	if (spec.deadlock) rules.push(deadlockRule(spec));
	return rules;
};
