import os from "node:os";

// TLACHART_TEST_SLOTS pins the count so a small runner can be reproduced on a big machine.
const slots = Math.max(
	1,
	Math.floor(Number(process.env.TLACHART_TEST_SLOTS) || Math.min(8, os.availableParallelism())),
);
const waiting: (() => void)[] = [];
let free = slots;

/** Runs `job` once one of `slots` places is free, so TLC runs never pile up. */
export const limit = async <T>(job: () => Promise<T>): Promise<T> => {
	if (free > 0) free--;
	else await new Promise<void>((resolve) => waiting.push(resolve));
	try {
		return await job();
	} finally {
		// Hand the place straight to the next waiter so a new caller cannot take it.
		const next = waiting.shift();
		if (next) next();
		else free++;
	}
};
