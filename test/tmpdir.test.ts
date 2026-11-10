import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "../src/tlc/check.ts";
import { tmpDir } from "./tmp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(here, "corpus");
const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";

// Alone in this file: check() reads the process-wide TMPDIR, so no other run may share the process.
test(
	"check() leaves no tlachart- folder in the temp dir when it returns and when it throws",
	{ skip },
	async () => {
		const dir = tmpDir("tlachart-tmpdir-");
		const base = path.join(dir, "Broken");
		fs.writeFileSync(
			`${base}.tla`,
			`${["---- MODULE Broken ----", "VARIABLE x", "Init == x = 0", "Next == x' = y", "===="].join("\n")}\n`,
		);
		fs.writeFileSync(`${base}.cfg`, "INIT Init\nNEXT Next\n");
		const login = path.join(corpus, "Login", "Login");
		const tmp = tmpDir("tlachart-tmpdir-");
		const saved = process.env.TMPDIR;
		process.env.TMPDIR = tmp;
		try {
			await check(`${login}.tla`, `${login}.cfg`);
			await assert.rejects(check(`${base}.tla`, `${base}.cfg`), /SANY could not read/);
		} finally {
			if (saved === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = saved;
		}
		assert.deepEqual(fs.readdirSync(tmp), []);
	},
);
