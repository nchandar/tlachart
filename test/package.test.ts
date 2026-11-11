// Pins the package metadata that publishing depends on, so a rename or a stray test folder breaks
// this check rather than the release.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildOutputs, check, checkView } from "../src/index.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
	private?: boolean;
	author: string;
	repository: { type: string; url: string };
	homepage: string;
	bugs: { url: string };
	bin: { [name: string]: string };
	files: string[];
	exports: { [key: string]: string };
	types: string;
};
const file = (relative: string) => path.join(root, relative);

test("the bin target is an executable Bun script", () => {
	const target = pkg.bin.tlachart;
	assert.ok(target, "package.json gives the command a bin");
	const full = file(target);
	assert.ok(fs.existsSync(full), `${target} exists`);
	assert.equal(fs.readFileSync(full, "utf8").split("\n")[0], "#!/usr/bin/env bun");
	assert.notEqual(fs.statSync(full).mode & 0o111, 0, `${target} is executable`);
});

test("the published files leave out the tests", () => {
	assert.ok(pkg.files.includes("src"));
	assert.ok(!pkg.files.some((entry) => entry === "test" || entry.startsWith("test/")));
});

test("the library entry is both the export and the types", () => {
	const target = pkg.exports["."];
	assert.ok(target, 'package.json exports "."');
	assert.ok(fs.existsSync(file(target)), `${target} exists`);
	assert.equal(pkg.types, target);
});

test("the package is publishable and points at the repo", () => {
	assert.ok(!pkg.private, "package.json is not private");
	assert.equal(pkg.author, "Niranjan Chandarraj");
	assert.equal(pkg.repository.url, "git+https://github.com/nchandar/tlachart.git");
	assert.equal(pkg.homepage, "https://github.com/nchandar/tlachart");
	assert.equal(pkg.bugs.url, "https://github.com/nchandar/tlachart/issues");
});

test("the library entry exposes the check, the outputs and the view check", () => {
	assert.equal(typeof check, "function");
	assert.equal(typeof buildOutputs, "function");
	assert.equal(typeof checkView, "function");
});
