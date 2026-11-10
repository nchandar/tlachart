import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpDir } from "./tmp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = pathToFileURL(path.join(here, "tmp.ts")).href;

// Runs a plain bun process that makes temp folders and then ends the way a run can end.
const runBun = (lines: string[]) =>
	spawnSync(
		process.execPath,
		["--eval", [`import { tmpDir } from ${JSON.stringify(helper)};`, ...lines].join("\n")],
		{ encoding: "utf8" },
	);

// Runs a bun test over three files, of which the first only imports the helper and the other two
// make a temp folder, and lists what the run leaves in TMPDIR. The first file is the one that can
// bind the helper's after hook, so it covers the case where that file makes no folder itself.
const runSuite = (mode: "--parallel" | "") => {
	const root = tmpDir("tlachart-suite-");
	const tmpdir = path.join(root, "tmp");
	fs.mkdirSync(tmpdir);
	const header = [
		'import fs from "node:fs";',
		'import path from "node:path";',
		'import { test } from "node:test";',
		`import { tmpDir } from ${JSON.stringify(helper)};`,
	];
	const leaves = (prefix: string) => [
		...header,
		`test("makes a temp folder", () => {`,
		`\tfs.writeFileSync(path.join(tmpDir("${prefix}"), "file"), "x");`,
		"});",
		"",
	];
	fs.writeFileSync(
		path.join(root, "aaa-imports.test.ts"),
		[...header, 'test("makes nothing", () => {});', ""].join("\n"),
	);
	fs.writeFileSync(path.join(root, "bbb-leaves.test.ts"), leaves("tlachart-nested-").join("\n"));
	fs.writeFileSync(path.join(root, "ccc-leaves.test.ts"), leaves("tlachart-nested-").join("\n"));
	const args = mode ? ["test", mode, "--timeout", "120000", root] : ["test", root];
	const r = spawnSync(process.execPath, args, {
		encoding: "utf8",
		env: { ...process.env, TMPDIR: tmpdir },
	});
	return { ...r, tmpdir, left: fs.readdirSync(tmpdir) };
};

test("tmpDir makes a fresh folder in the temp dir, named with the prefix", () => {
	const dir = tmpDir("tlachart-helper-");
	assert.equal(path.dirname(dir), os.tmpdir());
	assert.ok(path.basename(dir).startsWith("tlachart-helper-"));
	assert.ok(fs.statSync(dir).isDirectory());
	assert.notEqual(tmpDir("tlachart-helper-"), dir);
});

test("a parallel test run that uses tmpDir leaves nothing in the temp dir", () => {
	const r = runSuite("--parallel");
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(r.left, []);
});

test("a serial test run that uses tmpDir leaves nothing in the temp dir", () => {
	const r = runSuite("");
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(r.left, []);
});

test("the folder is removed when the process that made it exits", () => {
	const r = runBun(['process.stdout.write(tmpDir("tlachart-exit-"));']);
	assert.equal(r.status, 0, r.stderr);
	const dir = r.stdout.trim();
	assert.ok(dir.startsWith(os.tmpdir()), dir);
	assert.equal(fs.existsSync(dir), false, dir);
});

test("the folder is removed when the process exits after a failure", () => {
	const r = runBun([
		'process.stdout.write(tmpDir("tlachart-failed-"));',
		'throw new Error("the test failed");',
	]);
	assert.equal(r.status, 1);
	const dir = r.stdout.trim();
	assert.ok(dir.startsWith(os.tmpdir()), dir);
	assert.equal(fs.existsSync(dir), false, dir);
});

test("a folder the test removed itself does not stop the others from being removed", () => {
	const r = runBun([
		'import fs from "node:fs";',
		'const gone = tmpDir("tlachart-gone-");',
		"fs.rmSync(gone, { recursive: true });",
		'process.stdout.write([gone, tmpDir("tlachart-kept-")].join("\\n"));',
	]);
	assert.equal(r.status, 0, r.stderr);
	const [gone, kept] = r.stdout.trim().split("\n");
	assert.equal(fs.existsSync(gone), false, gone);
	assert.equal(fs.existsSync(kept), false, kept);
});
