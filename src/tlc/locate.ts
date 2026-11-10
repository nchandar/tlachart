// Finds tla2tools.jar and a Java to run it. The TLA2TOOLS and JAVA env vars win; otherwise mise
// installs the pinned versions.

import path from "node:path";
import { miseEnv } from "./env.ts";
import { runChild } from "./process.ts";

// TLC 1.7.4 pinned with its sha256, so every run uses a known jar.
const TLC_TOOL =
	"http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4";

const JAVA_TOOL = "java@temurin-25";

/**
 * Finds the pinned TLC jar and a Java to run it. TLA2TOOLS and JAVA win; otherwise mise installs the
 * pinned versions. `signal` aborts a download when the command is stopping.
 */
export async function findTlc(cwd: string, signal?: AbortSignal) {
	const { TLA2TOOLS, JAVA } = process.env;
	if (TLA2TOOLS) return { jar: TLA2TOOLS, java: JAVA || "java" };
	// MISE_CEILING_PATHS stops mise reading config above the run's folder, so a user's own mise
	// config cannot change the pinned tools. TMPDIR keeps its scratch in the folder the run removes.
	const mise = (...args: string[]) =>
		runChild("mise", args, {
			cwd,
			env: miseEnv({ MISE_CEILING_PATHS: cwd, TMPDIR: cwd }),
			signal,
		});
	const where = () =>
		Promise.all([mise("where", TLC_TOOL), mise("which", "java", "--tool", JAVA_TOOL)]);
	let found = await where();
	if (found.some((r) => r.status !== 0)) {
		const r = await mise("install", JAVA_TOOL, TLC_TOOL);
		if (r.status !== 0)
			throw new Error(
				`Cannot find TLC: mise install failed: ${r.error?.message ?? r.stderr.trim()}\nOr set TLA2TOOLS to the path of tla2tools.jar, and JAVA to a java binary (Java 11 or later).`,
			);
		found = await where();
	}
	return {
		jar: path.join(found[0].stdout.trim(), "tla2tools.jar"),
		java: JAVA || found[1].stdout.trim(),
	};
}
