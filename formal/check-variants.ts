// Runs every variant and fails when one does not break the rule it was made to break.
import { check } from "./variants.ts";
import { jar } from "./tlc.ts";

jar();
const results = check();
for (const { variant, named, ok } of results) {
	console.log(
		`${variant.name} expected=${variant.expected} named=${named} ${ok ? "ok" : "MISMATCH"}`,
	);
}
if (results.some((result) => !result.ok)) process.exit(1);
