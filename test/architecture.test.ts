// Pins the layering of src/ by reading import statements, so it runs the same on any runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");

type Import = { target: string; typeOnly: boolean };

const COMMENT =
	/("(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|`(?:[^`\\]|\\[\s\S])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const codeOf = (file: string) =>
	fs
		.readFileSync(path.join(src, file), "utf8")
		.replace(COMMENT, (_: string, text: string | undefined) => text ?? " ");

// Globals that tie a file to one runtime, and any dynamic import.
const RUNTIME =
	/\b(?:process|require|globalThis|global|Deno|Bun|Buffer|setImmediate|clearImmediate|fetch)\b|\bimport\s*\(/g;
const STATIC_IMPORT = /\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;

// A folder gives every .ts file under it, a file gives itself; paths are relative to src/.
const sources = (target: string) => {
	const full = path.join(src, target);
	if (!fs.statSync(full).isDirectory()) return [target];
	return fs
		.readdirSync(full, { recursive: true, encoding: "utf8" })
		.map((entry) => path.join(target, entry))
		.filter((file) => fs.statSync(path.join(src, file)).isFile());
};

// Relative targets resolve to a path under src/; node: and package names stay as written.
const importsOf = (file: string): Import[] =>
	Array.from(codeOf(file).matchAll(STATIC_IMPORT), (m) => ({
		typeOnly: m[1] !== undefined,
		target: m[2].startsWith(".") ? path.normalize(path.join(path.dirname(file), m[2])) : m[2],
	}));

// Every module a file loads at run time, through any chain of imports.
const loadedBy = (files: string[]) => {
	const seen = new Set<string>();
	const queue = [...files];
	for (let file = queue.pop(); file !== undefined; file = queue.pop())
		for (const { target, typeOnly } of importsOf(file)) {
			if (typeOnly || seen.has(target)) continue;
			seen.add(target);
			if (!target.startsWith("node:") && target.endsWith(".ts")) queue.push(target);
		}
	return [...seen];
};

const nodeModules = (files: string[]) => loadedBy(files).filter((to) => to.startsWith("node:"));

// The model, the analysis, the build step, the parsers and the renderers run on any runtime;
// only the TLC process code and the command line may touch node:.
const PURE = [
	"model",
	"analyze",
	"build-outputs.ts",
	"parse",
	"render",
	"tlc/generated-modules.ts",
	"tlc/format-message.ts",
];

test("each model file imports only other model files", () => {
	const files = sources("model");
	assert.ok(files.length > 0);
	for (const file of files)
		for (const { target } of importsOf(file))
			assert.ok(target.startsWith("model/"), `${file} imports ${target}`);
});

test("each analysis pass imports only from model/", () => {
	const files = sources("analyze");
	assert.ok(files.length > 0);
	for (const file of files)
		for (const { target } of importsOf(file))
			assert.ok(target.startsWith("model/"), `${file} imports ${target}`);
});

test("build-outputs.ts loads no node: module and takes its types only from model/", () => {
	assert.deepEqual(nodeModules(["build-outputs.ts"]), []);
	for (const { target, typeOnly } of importsOf("build-outputs.ts"))
		if (typeOnly)
			assert.ok(target.startsWith("model/"), `build-outputs.ts imports types from ${target}`);
});

test("the pure folders and every file they load are .ts files that name no runtime global", () => {
	const files = PURE.flatMap(sources);
	const loaded = loadedBy(files).filter((to) => !to.startsWith("node:"));
	for (const file of new Set([...files, ...loaded])) {
		assert.ok(file.endsWith(".ts"), `${file} is not a .ts file`);
		assert.deepEqual(codeOf(file).match(RUNTIME), null, file);
	}
});

test("no parser or renderer loads a node: module, even through another file", () => {
	for (const target of ["parse", "render", "tlc/generated-modules.ts", "tlc/format-message.ts"]) {
		const files = sources(target);
		assert.ok(files.length > 0, target);
		for (const file of files) assert.deepEqual(nodeModules([file]), [], file);
	}
});
