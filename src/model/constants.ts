// Constants shared across the layers: TLC's codes, size limits and a brand.

/** TLC's message codes. The parser keys on these, never on message text, which varies. */
export const EC = {
	TLC_INVARIANT_VIOLATED_INITIAL: 2107,
	TLC_PROPERTY_VIOLATED_INITIAL: 2108,
	TLC_INVARIANT_VIOLATED_BEHAVIOR: 2110,
	TLC_ACTION_PROPERTY_VIOLATED_BEHAVIOR: 2112,
	TLC_DEADLOCK_REACHED: 2114,
	TLC_TEMPORAL_PROPERTY_VIOLATED: 2116,
	TLC_BACK_TO_STATE: 2122,
	TLC_FINISHED: 2186,
	TLC_INIT_GENERATED1: 2190,
	TLC_INIT_GENERATED2: 2191,
	TLC_STATS: 2199,
	TLC_PROGRESS_STATS: 2200,
	TLC_STATE_PRINT2: 2217,
	TLC_STATE_PRINT3: 2218,
	TLC_SANY_END: 2219,
	TLC_SANY_START: 2220,
} as const;

/** TLC's message severity levels. */
export const LEVEL = { NONE: 0, ERROR: 1, TLCBUG: 2, WARNING: 3, STATE: 4 } as const;

/** Each rerun after a first break stops here, so a big model cannot run forever. */
export const RERUN_STATES = 100_000;

/** Past this many states a chart is unreadable, so only the bug paths are drawn. */
export const CHART_STATES = 500;

/** Brand that marks a view checkView has already validated. */
export const checked = Symbol("checked");

/** Chunk size for streaming TLC files and generated text (16 MiB). */
export const PART = 1 << 24;

/**
 * The config keyword for the deadlock check; also the rule's name when the spec has its own
 * NoDeadlock.
 */
export const CHECK_DEADLOCK = "CHECK_DEADLOCK";
