// Wires TLC to one temp folder: every run writes its config there and starts Java with its own
// output and temp folders.

import fs from "node:fs";
import path from "node:path";
import { type ConfigSection } from "../model/types.ts";
import { childEnv } from "./env.ts";
import { formatConfig } from "./generated-modules.ts";
import { findTlc } from "./locate.ts";
import { type FileResult, runToFiles } from "./process.ts";

/** What a check's TLC runs share: the temp folder, the Java found for it and the config writer. */
export type Runner = {
	/** The one temp folder every run writes into. */
	dir: string;
	/** Writes a run's config into the temp folder and returns TLC's config arguments. */
	config: (name: string, sections: ConfigSection[], extra: string[]) => string[];
	/** Starts one TLC main in the temp folder, keeping its output and its temp files there. */
	runJava: (name: string, main: string, args: string[], jvm?: string[]) => Promise<FileResult>;
};

/** Finds TLC and gives it `dir`, the temp folder that no check outlives. */
export async function makeRunner(dir: string, folder: string): Promise<Runner> {
	const tlc = await findTlc(dir);
	const config = (name: string, sections: ConfigSection[], extra: string[]) => {
		fs.writeFileSync(path.join(dir, `${name}.cfg`), formatConfig(sections, extra));
		return [`-metadir`, path.join(dir, `meta-${name}`), "-config", path.join(dir, `${name}.cfg`)];
	};
	// Off macOS the locale is forced to UTF-8, so a spec path with non-ASCII characters still
	// works.
	const runJava = (name: string, main: string, args: string[], jvm: string[] = []) => {
		const tmp = path.join(dir, `tmp-${name}`);
		fs.mkdirSync(tmp);
		return runToFiles(
			tlc.java,
			[`-Djava.io.tmpdir=${tmp}`, `-DTLA-Library=${folder}`, ...jvm, "-cp", tlc.jar, main, ...args],
			{
				cwd: dir,
				out: path.join(dir, name),
				env: childEnv(process.platform === "darwin" ? {} : { LC_ALL: "C.UTF-8" }),
			},
		);
	};
	return { dir, config, runJava };
}
