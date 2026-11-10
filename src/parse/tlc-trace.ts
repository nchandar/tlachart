// Reads a liveness counterexample from TLC's messages, with the state it loops back to.

import { EC } from "../model/constants.ts";
import { type Part, type Trace } from "../model/types.ts";
import { actionOf, messageState, textOf } from "./tlc-messages.ts";

/**
 * TLC ends a loop two ways: a final state print means it stutters there, or 'Back to state N'
 * (1-based) names where it loops.
 */
export function readTrace(messages: Iterable<Part>): Trace {
	const seq: Trace["seq"] = [];
	for (const m of messages) {
		if (typeof m === "string") continue;
		if (m.code === EC.TLC_STATE_PRINT3) return { seq, loop: seq.length - 1 };
		const back = m.code === EC.TLC_BACK_TO_STATE && /^(\d+): Back to state: /.exec(textOf(m));
		if (back) {
			const loop = Number(back[1]) - 1;
			seq.push({ action: actionOf(m) ?? "", vars: seq[loop]?.vars });
			return { seq, loop };
		}
		const action = m.code === EC.TLC_STATE_PRINT2 ? actionOf(m) : undefined;
		if (action !== undefined) seq.push({ action, vars: messageState(m) });
		else if (
			m.code === EC.TLC_INVARIANT_VIOLATED_INITIAL ||
			m.code === EC.TLC_PROPERTY_VIOLATED_INITIAL
		)
			seq.push({ action: "", vars: messageState(m) });
	}
	return { seq, loop: undefined };
}
