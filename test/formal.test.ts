// Keeps the formal model honest: the real model finds no error, and every variant still breaks the
// rule it was made to break.
import assert from "node:assert/strict";
import { test } from "node:test";
import { limit } from "./limit.ts";
import { tlc } from "../formal/tlc.ts";
import { check, variants } from "../formal/variants.ts";

const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";

test("the real model finishes with no error", { skip }, async () => {
	const run = await limit(() => Promise.resolve(tlc("OutFolder.tla", "OutFolder.cfg")));
	assert.equal(run.status, 0, run.output);
	assert.match(run.output, /^Model checking completed\. No error has been found\.$/m);
});

test("every variant breaks the rule it was made to break", { skip }, async () => {
	const results = await limit(() => Promise.resolve(check()));
	assert.equal(results.length, variants.length);
	for (const { variant, named, ok } of results)
		assert.ok(ok, `${variant.name} expected ${variant.expected}, TLC named ${named}`);
});
