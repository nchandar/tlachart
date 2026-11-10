// @ts-check
import eslint from "@eslint/js";
import tsdoc from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		// formal/*.mjs are view modules loaded by TLC, not code under the TS lint.
		ignores: [
			"node_modules/",
			"formal/**/*.mjs",
			"test/corpus/",
			"test/grid/",
			"examples/",
			"**/*-chart/",
		],
	},
	eslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked,
	{
		// node:test's test() returns a promise the runner already tracks
		files: ["test/**"],
		rules: { "@typescript-eslint/no-floating-promises": "off" },
	},
	{
		// TSDoc comments must parse, so an editor's hover shows the documented contract
		files: ["src/**/*.ts", "formal/**/*.ts"],
		plugins: { tsdoc },
		rules: { "tsdoc/syntax": "error" },
	},
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.js"] },
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
);
