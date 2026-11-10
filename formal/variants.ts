// Each variant is the model with one rule broken on purpose. Each cfg names only the rule under
// test, so a failure can only be that rule.
import fs from "node:fs";
import path from "node:path";
import { namedRule, root, tlc } from "./tlc.ts";

export type Variant = {
	/** Variant and cfg, as printed and as the key in coverage.md. */
	name: string;
	/** The rule this variant must break. */
	expected: string;
	module: string;
	config: string;
};

export const variants: Variant[] = [
	{
		name: "DirectWrite",
		expected: "WholeResult",
		module: "variants/DirectWrite.tla",
		config: "variants/cfg/DirectWrite.WholeResult.cfg",
	},
	{
		name: "OverwriteUser",
		expected: "KeepUserFiles",
		module: "variants/OverwriteUser.tla",
		config: "variants/cfg/OverwriteUser.KeepUserFiles.cfg",
	},
	{
		name: "NoHandshake",
		expected: "NoUnprotectedTlc",
		module: "variants/NoHandshake.tla",
		config: "variants/cfg/NoHandshake.NoUnprotectedTlc.cfg",
	},
	{
		name: "JanitorNoKill",
		expected: "P2",
		module: "variants/JanitorNoKill.tla",
		config: "variants/cfg/JanitorNoKill.P2.cfg",
	},
	{
		name: "JanitorLast (P2)",
		expected: "P2",
		module: "variants/JanitorLast.tla",
		config: "variants/cfg/JanitorLast.P2.cfg",
	},
	{
		name: "JanitorLast (P3)",
		expected: "P3",
		module: "variants/JanitorLast.tla",
		config: "variants/cfg/JanitorLast.P3.cfg",
	},
];

export type Checked = { variant: Variant; named: string; ok: boolean };

/** Runs every variant and reports the rule TLC named against the rule it must break. */
export function check(): Checked[] {
	return variants.map((variant) => {
		const cfg = fs.readFileSync(path.join(root, variant.config), "utf8");
		const run = tlc(variant.module, variant.config);
		const named = namedRule(run.output, cfg) ?? "none";
		// A variant that passes proves nothing about the rule it was made to break.
		const ok = run.status !== 0 && named === variant.expected;
		return { variant, named, ok };
	});
}
