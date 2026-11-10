// Runs the whole TLC check for one spec: read the config, ask SANY for the variables, decide each
// rule, then draw the chart when the model fits its budget.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type Checks,
	initialOnlyProperties,
	readChecks,
	readSany,
	readSpec,
} from "../parse/sany-spec.ts";
import { readConfig } from "../parse/tlc-config.ts";
import { getOrThrow } from "../model/collections.ts";
import { CHART_STATES } from "../model/constants.ts";
import { ruleKey, stateRules } from "../model/rules.ts";
import { type CheckResult } from "../model/types.ts";
import { drawGraph, drawPaths } from "./draw.ts";
import { checkError, exitClass, tail } from "./exit.ts";
import { boundedRunModule } from "./generated-modules.ts";
import { judgeRules } from "./judge.ts";
import { messagesOf } from "./output.ts";
import { makeRunner, type Runner } from "./runner.ts";

/**
 * Runs the whole check for one spec: decides each rule with TLC, then dumps the graph when the
 * model fits the chart budget.
 */
export async function check(specFile: string, configFile: string): Promise<CheckResult> {
	const cfg = readConfig({ file: configFile, text: fs.readFileSync(configFile, "utf8") });
	const checks = readChecks({ configFile, config: cfg });
	const folder = path.dirname(path.resolve(specFile));
	// Every TLC file lives in one temp folder that is always removed, even when the check throws.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tlachart-"));
	try {
		const run = await makeRunner(dir, folder);
		const { sany, spec } = await sanySpec(run, folder, specFile, checks);
		const rules = stateRules(spec);
		const all = [...rules];
		for (const name of spec.properties) all.push({ kind: "property", name });
		fs.writeFileSync(path.join(dir, "ChartBound.tla"), boundedRunModule(spec.module));
		const judged = await judgeRules(run, spec, all, specFile);
		const { verdicts } = judged;
		const exit = exitClass(judged.first.status);
		if (exit === 2) throw checkError(specFile, judged.first);
		const initialOnly = initialOnlyProperties(sany, spec);
		const common = {
			spec,
			exit,
			stop: judged.stop,
			states: judged.states,
			messages: messagesOf(judged.first.output),
			rules: rules.map((rule) => getOrThrow(verdicts, ruleKey(rule))),
		};
		const input = { run, spec, rules, all, verdicts, initialOnly, specFile };
		// Only a model within the chart budget is dumped as a full graph; a bigger one draws only its
		// bug paths.
		const drawn =
			judged.states.distinct <= CHART_STATES
				? ((await drawGraph(input)) ?? drawPaths(input))
				: drawPaths(input);
		return { ...common, ...drawn };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Runs SANY over the spec and reads the variables and definitions it declares. */
async function sanySpec(run: Runner, folder: string, specFile: string, checks: Checks) {
	const xml = await run.runJava(
		"sany",
		"tla2sany.xml.XMLExporter",
		["-o", "-I", folder, path.resolve(specFile)],
		["-XX:TieredStopAtLevel=1"],
	);
	if (xml.status !== 0)
		throw new Error(`SANY could not read ${specFile} (exit ${xml.status}):\n${tail(xml)}`);
	const sany = readSany(fs.readFileSync(xml.stdout, "utf8"));
	const module = path.basename(specFile, ".tla");
	return { sany, spec: { ...readSpec({ module, sany, checks }), folder } };
}
