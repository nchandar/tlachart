// Re-prints TLC's tool-mode messages the way plain TLC does, so tlc.out reads like an ordinary run.

import { EC, LEVEL, PART } from "../model/constants.ts";
import { type Message, type Part } from "../model/types.ts";

const PREFIX: { [level: number]: string } = {
	[LEVEL.ERROR]: "Error: ",
	[LEVEL.TLCBUG]: "TLC Bug: ",
	[LEVEL.WARNING]: "Warning: ",
	[LEVEL.STATE]: "State ",
};
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * TLC reports elapsed milliseconds; show them as plain TLC does (12s, 3min 4s, 2h 5min, or days).
 */
export function formatRuntime(ms: number) {
	const t = new Date(ms > DAY ? ms - DAY : ms);
	const [hh, mm, ss] = [t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()].map(pad);
	if (ms > DAY)
		return `${Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY) + 1}d ${hh}h`;
	if (ms > HOUR) return `${hh}h ${mm}min`;
	if (ms > MINUTE) return `${mm}min ${ss}s`;
	return `${ss}s`;
}

const firstLine = ({ code, level }: Message, line: string) => {
	if (code === EC.TLC_BACK_TO_STATE)
		return line.replace(/^(\d+): Back to state: /, "Back to state $1: ");
	if (code === EC.TLC_FINISHED)
		return line.replace(
			/^Finished in (\d+)ms/,
			(_, ms: string) => `Finished in ${formatRuntime(Number(ms))}`,
		);
	return (PREFIX[level] ?? "") + line;
};

const render = (m: Message): string =>
	(m.beforeMarker ?? "") +
	firstLine(m, m.body.map((part) => (typeof part === "string" ? part : render(part))).join("\n"));

// Follows plain TLC: no SANY markers, a progress line dropped when a final stats line follows it,
// and the -nowarning hint once after the first warning.
function* printed(parts: Iterable<Part>): Generator<string> {
	let warned = false;
	let progress: Message | undefined;
	for (const part of parts) {
		if (progress?.body.length && (typeof part === "string" || part.code !== EC.TLC_STATS))
			yield render(progress);
		progress = undefined;
		if (typeof part === "string") {
			yield part;
			continue;
		}
		if (part.code === EC.TLC_SANY_START || part.code === EC.TLC_SANY_END) continue;
		if (part.code === EC.TLC_PROGRESS_STATS) progress = part;
		else if (part.body.length) yield render(part);
		if (part.level === LEVEL.WARNING && !warned) {
			yield "(Use the -nowarning option to disable this warning.)";
			warned = true;
		}
	}
	if (progress?.body.length) yield render(progress);
}

/** Plain-TLC text in chunks of about PART characters. */
export function* formatMessages(parts: Iterable<Part>): Generator<string> {
	let chunk = "";
	for (const line of printed(parts)) {
		chunk += `${line}\n`;
		if (chunk.length >= PART) {
			yield chunk;
			chunk = "";
		}
	}
	if (chunk) yield chunk;
}
