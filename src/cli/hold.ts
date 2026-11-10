import fs from "node:fs";

/**
 * Test-only: writes `<file>.reached` and waits for `<file>`, so a replay can kill a process at a
 * named point. Inert unless `TLACHART_HOLD_<POINT>` names a file.
 */
export const hold = (point: string, value: string) => {
	const file = process.env[`TLACHART_HOLD_${point}`];
	if (!file) return;
	// A reader that kills on the marker must not see it before its content, so publish it atomically.
	fs.writeFileSync(`${file}.reached.tmp`, value);
	fs.renameSync(`${file}.reached.tmp`, `${file}.reached`);
	while (!fs.existsSync(file)) {
		// A SIGKILL still lands: the loop is only here to stay alive.
	}
};
