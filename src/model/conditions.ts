// Decides whether the bracket condition on an arrow holds, given the other regions' labels.

import { tupleKey } from "./keys.ts";
import { type Condition } from "./types.ts";

/** True when the other regions' labels satisfy the condition, so the arrow can be followed now. */
export function conditionHolds(condition: Condition, others: string[]) {
	switch (condition.kind) {
		// and: every other region matches; or: at least one matches; tuples: the whole combination is
		// listed.
		case "and":
			for (let j = 0; j < others.length; j++)
				if (!condition.otherKeys[j].has(others[j])) return false;
			return true;
		case "or":
			for (let j = 0; j < others.length; j++)
				if (condition.otherKeys[j].has(others[j])) return true;
			return false;
		case "tuples":
			return condition.otherTuples.has(tupleKey(others));
	}
}
