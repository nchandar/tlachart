// Dependency-free checks that the text src/render/mermaid.ts writes is a well-formed
// stateDiagram-v2: the grammar this renderer emits, checked over every committed corpus chart and
// over random labels pushed through a view. Replaces the check that needed the `mermaid` package.
// The real parser was measured and dropped: it needs a DOM shim and 124 more packages, and it
// sanitizes labels instead of rejecting them, so it misses the unescaped `-->` and `<script>` cases
// this file catches.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { walkGraph } from "../src/analyze/reachability.ts";
import { projectChart } from "../src/build-outputs.ts";
import { escapeLabel } from "../src/render/mermaid-escape.ts";
import { mermaid } from "../src/render/mermaid.ts";
import { type Graph, type Vars, type View } from "../src/model/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// The shapes src/render/mermaid.ts writes. Anything else is a line Mermaid may read as something
// other than the state, arrow or style it was meant to be.
const STATE_OPEN = /^state "(.*)" as (\w+) \{$/;
const STATE_LABEL = /^(\w+): (.*)$/;
const START = /^\[\*\] --> (\w+)$/;
const STEP = /^(\w+) --> (\w+): (.*)$/;
const CLASS = /^class (\w+) (\w+)$/;
const STYLE = /^classDef (\w+) (.+)$/;
const DIRECTION = /^direction (?:LR|RL|TB|BT)$/;
const SEPARATOR = /^--$/;
const CLOSE = /^\}$/;

/**
 * Checks one chart against the grammar mermaid.ts emits, returning one message per problem: the
 * optional front matter, the header, then lines of `state "..." as id {`, `id: label`,
 * `[*] --> id`, `id --> id: label`, `class id name`, `classDef name style`, `--` and `}`. Every id
 * is defined exactly once, every reference names a defined id, blocks nest, and no line holds a
 * raw quote inside a quoted name or a raw newline.
 */
function validate(text: string) {
	const errors: string[] = [];
	const lines = text.split("\n");
	const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
	if (text.includes("\r")) errors.push("the text holds a carriage return");
	let at = 0;
	if (lines[0] === "---") {
		const value = (lines[1] ?? "").startsWith("title: ") ? lines[1].slice("title: ".length) : "";
		if (lines[2] !== "---") errors.push("front matter is not three lines");
		else if (!value) errors.push("front matter has no title line");
		else {
			let parsed: unknown;
			try {
				parsed = JSON.parse(value);
			} catch {
				errors.push("the title is not JSON");
			}
			if (typeof parsed !== "string") errors.push("the title is not a JSON string");
			else if (JSON.stringify(parsed) !== value)
				errors.push("the title is not written as JSON writes it");
		}
		at = 3;
	}
	if (lines[at] !== "stateDiagram-v2") errors.push(`line ${at + 1}: not stateDiagram-v2`);
	const defs = new Map<string, number>();
	const refs: { id: string; line: number }[] = [];
	let depth = 0;
	for (let i = at + 1; i < end; i++) {
		const line = lines[i];
		const body = line.trimStart();
		const indent = line.length - body.length;
		if (!body) {
			errors.push(`line ${i + 1}: empty`);
			continue;
		}
		if (line.slice(0, indent).replaceAll(" ", ""))
			errors.push(`line ${i + 1}: indent is not spaces`);
		else if (indent % 2) errors.push(`line ${i + 1}: odd indent ${indent}`);
		let m: RegExpExecArray | null;
		if ((m = STATE_OPEN.exec(body))) {
			if (m[1].includes('"')) errors.push(`line ${i + 1}: a quoted name holds a raw quote`);
			defs.set(m[2], (defs.get(m[2]) ?? 0) + 1);
			depth += 1;
		} else if (CLOSE.test(body)) {
			depth -= 1;
			if (depth < 0) errors.push(`line ${i + 1}: closes a block that is not open`);
		} else if (SEPARATOR.test(body)) {
			if (!depth) errors.push(`line ${i + 1}: a region separator outside a block`);
		} else if (DIRECTION.test(body)) {
			if (depth) errors.push(`line ${i + 1}: direction inside a block`);
		} else if ((m = STEP.exec(body))) {
			if (!m[3]) errors.push(`line ${i + 1}: an arrow with no label`);
			refs.push({ id: m[1], line: i + 1 }, { id: m[2], line: i + 1 });
		} else if ((m = START.exec(body))) {
			refs.push({ id: m[1], line: i + 1 });
		} else if ((m = CLASS.exec(body))) {
			refs.push({ id: m[1], line: i + 1 });
		} else if (STYLE.test(body)) {
			// classDef names a class, not a state id.
		} else if ((m = STATE_LABEL.exec(body))) {
			if (!m[2]) errors.push(`line ${i + 1}: a state with no label`);
			defs.set(m[1], (defs.get(m[1]) ?? 0) + 1);
		} else errors.push(`line ${i + 1}: not a shape this renderer writes: ${body}`);
	}
	if (depth !== 0) errors.push(`blocks are not balanced: ${depth} left open`);
	for (const [id, count] of defs)
		if (count !== 1) errors.push(`id ${id} is defined ${count} times`);
	for (const { id, line } of refs)
		if (!defs.has(id)) errors.push(`line ${line}: id ${id} is never defined`);
	return errors;
}

// What escapeLabel does to a label, from src/render/mermaid-escape.ts:
// - a space stays one space, and every other White_Space character becomes one space;
// - NUL and the C1 controls become nothing, except U+0085, which is White_Space and so a space;
// - a lone surrogate becomes U+FFFD;
// - every other character stays, or is written as #N; and decoded back here;
// - a label with no text left becomes one space;
// - a whitespace run that `direction` precedes and LR, RL, TB or BT follows becomes one space;
// - a word joiner (U+2060) is added so ﬂ° and ¶ß cannot pair, and dropped again here; a literal
//   U+2060 in a label is dropped too, since decode cannot tell it from the joiner we insert.
const ENTITY = /#(\d+);/g;
const PLACEHOLDER = /ﬂ°°(\d+)¶ß/g;
const JOINER = "\u2060";
const WHITE_SPACE = /\p{White_Space}/u;
const C1 = /[\x80-\x9f]/;
const DIRECTION_RUN = /(direction)\s+(?=LR|RL|TB|BT)/giu;

const decode = (text: string) =>
	text.replace(ENTITY, (_, n: string) => String.fromCodePoint(Number(n))).replaceAll(JOINER, "");

const decodeTitle = (text: string) =>
	text
		.replace(PLACEHOLDER, (_, n: string) => String.fromCodePoint(Number(n)))
		.replaceAll(JOINER, "");

const transform = (text: string) => {
	let out = "";
	for (const c of text) {
		const n = c.codePointAt(0) ?? 0;
		if (n >= 0xd800 && n <= 0xdfff) out += "\ufffd";
		else if (c === " " || WHITE_SPACE.test(c)) out += " ";
		else if (n === 0 || n === 0x2060 || C1.test(c)) continue;
		else out += c;
	}
	return out;
};

const labelText = (text: string) => {
	const out = transform(text).replace(DIRECTION_RUN, "$1 ");
	return out.trim() ? out : " ";
};

const titleText = (text: string) => transform(text);

// The expression mermaid-escape.ts applies once, without `g` so it is safe to test repeatedly.
const HAZARD =
	/:(?=:|$|\S*#)|\\(?=n)|%(?=%)|<(?=[\p{L}/!?])|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/iu;
// The characters escapeLabel may leave as themselves; everything else must be a #N; entity.
const SAFE = /^[\p{L}\p{N} !'()+,\-./=?[\]"_|@{}:\\^%<>]$/u;

const safeText = (text: string) => {
	for (let i = 0; i < text.length;) {
		const entity = /^#\d+;/.exec(text.slice(i));
		if (entity) {
			i += entity[0].length;
			continue;
		}
		const c = String.fromCodePoint(text.codePointAt(i) ?? 0);
		if (!SAFE.test(c)) return false;
		i += c.length;
	}
	return true;
};

const graphOf = (states: [string, Vars, boolean][], steps: [string, string, string][]) => {
	const graph: Graph = { states: new Map(), steps: [] };
	for (const [id, vars, start] of states) graph.states.set(id, { vars, start, breaks: [] });
	for (const [from, to, action] of steps) graph.steps.push({ from, to, action });
	return graph;
};

const chartOf = (graph: Graph, view: View) =>
	mermaid(projectChart(graph, walkGraph(graph), view, []).chart);

// A fixed seed keeps every property test reproducible; the report prints the counterexample.
const options = { seed: 20261110, numRuns: 150, includeErrorInReport: true };

test("every committed corpus chart follows the grammar this renderer writes", () => {
	const dir = path.join(here, "corpus");
	const charts = fs
		.readdirSync(dir)
		.map((name) => path.join(dir, name, "chart.mmd"))
		.filter((file) => fs.existsSync(file));
	assert.ok(charts.length > 0, "no corpus charts found");
	for (const file of charts) {
		const text = fs.readFileSync(file, "utf8");
		assert.deepEqual(validate(text), [], path.relative(here, file));
	}
});

// Hazards, whitespace, controls, the pairs Mermaid rewrites and the words it reads as directives.
const NASTY = [
	"::",
	"\\n",
	"%%",
	"<a",
	"</",
	"<!",
	"<?",
	"_",
	"_a",
	"a_",
	"[[",
	"C4Container",
	"C4Component",
	"direction LR",
	"direction\tBT",
	'marker-end="',
	"ﬂ",
	"°",
	"¶",
	"ß",
	"#35;",
	";",
	'"',
	"\0",
	"\u0085",
	"\u009f",
	"\t",
	"\n",
	"\u2028",
	"\u2060",
	"\ud800",
	"*",
	"`",
];
const label = fc
	.array(fc.oneof(fc.string({ unit: "binary", maxLength: 4 }), fc.constantFrom(...NASTY)), {
		maxLength: 4,
	})
	.map((parts) => parts.join(""));

// src/analyze/label-states.ts refuses a view label that is empty or holds "undefined", "NaN" or
// "[object Object]", so the chart properties only ask for labels that pass.
const REFUSED = /\bundefined\b|\bNaN\b|\[object Object\]/;
const accepted = (text: string) => text !== "" && !REFUSED.test(text);

test("a random state label survives the view and decodes back to itself", () => {
	const graph = graphOf([["s0", { x: 0 }, true]], []);
	fc.assert(
		fc.property(label, (text) => {
			fc.pre(accepted(text));
			const chart = chartOf(graph, { state: () => text });
			assert.deepEqual(validate(chart), [], inspect(text));
			const id = /^ {2}\[\*\] --> (\w+)$/m.exec(chart)?.[1];
			assert.ok(id !== undefined, `no start arrow for ${inspect(text)}`);
			const shown = new RegExp(`^\\s*${id}: (.*)$`, "m").exec(chart)?.[1];
			assert.ok(shown !== undefined, `no label line for ${inspect(text)}`);
			assert.equal(decode(shown), labelText(text), inspect(text));
		}),
		options,
	);
});

test("a random step label survives the view and decodes back to itself", () => {
	const graph = graphOf(
		[
			["s0", { x: 0 }, true],
			["s1", { x: 1 }, false],
		],
		[["s0", "s1", "Go"]],
	);
	fc.assert(
		fc.property(label, (text) => {
			fc.pre(accepted(text));
			const chart = chartOf(graph, {
				state: (v) => (v.x ? "To" : "From"),
				step: () => text,
			});
			assert.deepEqual(validate(chart), [], inspect(text));
			const arrows = [...chart.matchAll(/^\s*\w+ --> \w+: (.*)$/gm)];
			assert.equal(arrows.length, 1, inspect(text));
			assert.equal(decode(arrows[0][1]), labelText(text), inspect(text));
		}),
		options,
	);
});

test("a random title survives the view and decodes back to itself", () => {
	const graph = graphOf([["s0", { x: 0 }, true]], []);
	fc.assert(
		fc.property(label, (text) => {
			const chart = chartOf(graph, { title: text, state: () => "S" });
			assert.deepEqual(validate(chart), [], inspect(text));
			const lines = chart.split("\n");
			const want = titleText(text);
			if (!want) assert.notEqual(lines[0], "---", inspect(text));
			else {
				assert.equal(lines[0], "---", inspect(text));
				assert.ok(lines[1].startsWith("title: "), inspect(text));
				const shown: unknown = JSON.parse(lines[1].slice("title: ".length));
				assert.equal(typeof shown, "string", inspect(text));
				if (typeof shown === "string") assert.equal(decodeTitle(shown), want, inspect(text));
			}
		}),
		options,
	);
});

test("escapeLabel leaves no hazard, no raw quote when quoted, and only safe text or entities", () => {
	fc.assert(
		fc.property(label, (text) => {
			const plain = escapeLabel(text);
			assert.doesNotMatch(plain, HAZARD, inspect(text));
			assert.ok(safeText(plain), `unsafe text for ${inspect(text)}: ${inspect(plain)}`);
			const quoted = escapeLabel(text, true);
			assert.doesNotMatch(quoted, HAZARD, inspect(text));
			assert.ok(safeText(quoted), `unsafe text for ${inspect(text)}: ${inspect(quoted)}`);
			assert.ok(!quoted.includes('"'), `a raw quote in ${inspect(quoted)}`);
		}),
		options,
	);
});

// Text Mermaid's own grammar reads as something else: an edge, a class or init directive, HTML, a
// fence, and the bidirectional overrides a viewer could reorder.
const HOSTILE = [
	"-->",
	"---",
	":::",
	"%%{init: {'securityLevel': 'loose'}}%%",
	"<script>alert(1)</script>",
	"`",
	"\n",
	"\u202A\u202B\u202D\u202E\u2066\u2067\u2068\u2069",
	"x".repeat(2000),
];

test("a hostile state or step label adds no edge, no HTML and no directive to the chart", () => {
	const graph = graphOf(
		[
			["s0", { x: 0 }, true],
			["s1", { x: 1 }, false],
		],
		[["s0", "s1", "Go"]],
	);
	fc.assert(
		fc.property(fc.constantFrom(...HOSTILE), fc.constantFrom(...HOSTILE), (stateText, stepText) => {
			const chart = chartOf(graph, {
				state: (v) => (v.x ? "To" : stateText),
				step: () => stepText,
			});
			const at = inspect([stateText, stepText]);
			assert.deepEqual(validate(chart), [], at);
			assert.ok(!chart.includes("<"), at);
			assert.ok(!chart.includes("%%"), at);
			assert.equal(chart.match(/^\s*\w+ --> \w+: /gm)?.length, 1, at);
		}),
		options,
	);
});
