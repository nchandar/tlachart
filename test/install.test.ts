// Installs the packed tarball the way users do and runs the checkout example, so a package that
// npm or pnpm cannot install fails here rather than on the first user.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./tmp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const checkout = path.join(root, "examples", "checkout");
const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";

// Bun runs the installed bin through the shebang, so the test puts the running Bun on PATH.
const env = {
	...process.env,
	PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
};

const has = (command: string) =>
	spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;
const pnpm = has("pnpm") ? ["pnpm"] : has("corepack") ? ["corepack", "pnpm"] : undefined;
const skipPnpm =
	skip ||
	(pnpm
		? undefined
		: "pnpm and corepack are both missing; install pnpm or corepack to run this check");

const invoked = (command: string, args: string[], cwd: string) =>
	spawnSync(command, args, { cwd, encoding: "utf8", env });

let packed: string | undefined;

function tarball(): string {
	if (packed) return packed;
	const dir = tmpDir("tlachart-install-pack-");
	const pack = invoked("npm", ["pack", "--pack-destination", dir], root);
	assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
	const file = fs.readdirSync(dir).find((name) => name.endsWith(".tgz"));
	assert.ok(file, "npm pack wrote a tarball");
	packed = path.join(dir, file);
	return packed;
}

function installed(dir: string, command: string[]): string {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), '{"private":true}\n');
	const install = invoked(command[0], [...command.slice(1), tarball()], dir);
	assert.equal(install.status, 0, `${command.join(" ")} failed: ${install.stderr}`);
	const bin = path.join(dir, "node_modules", ".bin", "tlachart");
	assert.ok(fs.existsSync(bin), `${command.join(" ")} installed the bin`);
	return bin;
}

function runs(bin: string) {
	const target = path.join(path.dirname(bin), "..", "tlachart", "src", "cli", "main.ts");
	assert.ok(fs.existsSync(target), "the installed package keeps the bin target");
	assert.equal(fs.readFileSync(target, "utf8").split("\n")[0], "#!/usr/bin/env bun");
	assert.notEqual(fs.statSync(target).mode & 0o111, 0, "the installed bin target is executable");
	for (const [spec, status] of [
		["Checkout", 1],
		["CheckoutFixed", 0],
	] as const) {
		const out = path.join(tmpDir("tlachart-install-out-"), "out");
		const run = invoked(
			bin,
			[path.join(checkout, `${spec}.tla`), "--view", path.join(checkout, "view.mjs"), "--out", out],
			root,
		);
		assert.equal(run.status, status, `${spec} exit: ${run.stderr}`);
		assert.ok(fs.existsSync(path.join(out, "chart.mmd")), `${spec} wrote chart.mmd`);
	}
}

test(
	"npm installs the tarball and its bin runs the checkout example",
	{ skip, timeout: 60000 },
	() => {
		runs(installed(path.join(tmpDir("tlachart-install-npm-"), "project"), ["npm", "install"]));
	},
);

test(
	"pnpm installs the tarball and its bin runs the checkout example",
	{ skip: skipPnpm, timeout: 60000 },
	() => {
		const dir = path.join(tmpDir("tlachart-install-pnpm-"), "project");
		// Keep pnpm's content-addressable store in the scratch folder, not the user's home.
		runs(installed(dir, [...pnpm!, "add", "--store-dir", path.join(dir, ".pnpm-store")]));
	},
);
