// Runs TLC for the formal model, with the same jar convention as the tests.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(fileURLToPath(import.meta.url));

export const JAR_MESSAGE = `Set TLA2TOOLS to the path of tla2tools.jar, for example:
  export TLA2TOOLS=$HOME/.local/share/tla/tla2tools.jar`;

/** Returns the jar path, or exits 2 with a clear message when TLA2TOOLS is unset. */
export function jar(): string {
	const value = process.env.TLA2TOOLS;
	if (!value) {
		console.error(JAR_MESSAGE);
		process.exit(2);
	}
	return value;
}

export type Run = { status: number | null; output: string };

/** Runs TLC on `file` with `config`, both relative to formal/, and returns its output. */
export function tlc(file: string, config: string): Run {
	const metadir = fs.mkdtempSync(path.join(os.tmpdir(), "tlachart-formal-"));
	try {
		const result = spawnSync(
			process.env.JAVA ?? "java",
			[
				"-XX:+UseParallelGC",
				"-cp",
				process.env.TLA2TOOLS ?? "",
				"tlc2.TLC",
				"-workers",
				"1",
				"-metadir",
				metadir,
				"-config",
				config,
				file,
			],
			{ cwd: root, encoding: "utf8", maxBuffer: 1 << 30 },
		);
		return { status: result.status, output: `${result.stdout}${result.stderr}` };
	} finally {
		fs.rmSync(metadir, { recursive: true, force: true });
	}
}

/** The rule names a cfg asks TLC to check. */
export function properties(cfg: string): string[] {
	const names: string[] = [];
	let section = "";
	for (const line of cfg.split("\n")) {
		section = line.match(/^[A-Z_]+/)?.[0] ?? section;
		if (/^PROPERT(Y|IES)$/.test(section))
			for (const word of line.trim().split(/\s+/)) if (word && word !== section) names.push(word);
	}
	return names;
}

/**
 * The rule TLC named as broken. Invariants appear in its output; a violated temporal property only
 * prints "Temporal properties were violated", so a variant cfg names exactly one property.
 */
export function namedRule(output: string, cfg: string): string | undefined {
	const invariant = output.match(/^Error: (?:Invariant|Action property) (\S+) is violated/m)?.[1];
	if (invariant) return invariant;
	const broken = /^Error: Temporal properties were violated\./m.test(output);
	const declared = properties(cfg);
	return broken && declared.length === 1 ? declared[0] : undefined;
}
