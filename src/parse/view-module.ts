// Checks a user's view module and hands it plain JSON, so a view never sees the checker's
// internals.

import { checked } from "../model/constants.ts";
import { groupText, joinList } from "../model/text.ts";
import { type CheckedView, type Value, type Vars } from "../model/types.ts";

type Json = boolean | number | string | Json[] | { [key: string]: Json };

const projected = new WeakMap<object, Json>();

/**
 * Sets become arrays and functions become objects (a non-string key is its JSON text); cached per
 * value.
 */
export const json = (v: Value): Json => {
	if (typeof v !== "object") return v;
	if (v.kind === "model") return v.name;
	let j = projected.get(v);
	if (j === undefined) {
		if (v.kind === "interval") {
			const members: Json[] = [];
			for (let k = v.lo; k <= v.hi; k++) members.push(k);
			j = members;
		} else if (v.kind === "set") {
			const members: Json[] = [];
			for (const m of v.members) members.push(json(m));
			j = members;
		} else {
			const fields: [string, Json][] = [];
			for (let i = 0; i < v.keys.length; i++) {
				const k = json(v.keys[i]);
				fields.push([typeof k === "object" ? JSON.stringify(k) : String(k), json(v.values[i])]);
			}
			j = Object.fromEntries(fields);
		}
		projected.set(v, j);
	}
	return j;
};

const projectedVars = new WeakMap<Vars, { [name: string]: Json }>();

const jsonVars = (vars: Vars) => {
	let j = projectedVars.get(vars);
	if (j === undefined) {
		const fields: [string, Json][] = [];
		for (const [name, v] of Object.entries(vars)) fields.push([name, json(v)]);
		j = Object.fromEntries(fields);
		projectedVars.set(vars, j);
	}
	return j;
};

const THEME_COLORS = ["blue", "orange", "purple", "yellow", "teal", "tan", "pink"];

const isFunction = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === "function";

const isPlainObject = (v: unknown): v is { [key: string]: unknown } => {
	if (typeof v !== "object" || v === null) return false;
	const proto: unknown = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

const isString = (v: unknown) => typeof v === "string";

const VIEW_EXPORTS = ["state", "step", "group", "colors", "title"];

type Inspect = (value: unknown, options: { breakLength: number }) => string;

/**
 * Rejects anything the command would silently ignore: unknown exports, wrong types, bad colors. Each
 * error says how to fix it.
 */
export function checkView(
	view: { readonly [name: string]: unknown },
	inspect: Inspect,
): CheckedView {
	const literal = (v: unknown) =>
		typeof v === "string" ? JSON.stringify(v) : inspect(v, { breakLength: Infinity });
	const extra: string[] = [];
	for (const name of Object.keys(view)) if (!VIEW_EXPORTS.includes(name)) extra.push(name);
	if (extra.length)
		throw new Error(
			`The view exports ${joinList(extra)}, which the command does not read. Export only ${joinList(VIEW_EXPORTS)}.`,
		);
	const wrong: string[] = [];
	const pick = <T>(name: string, kind: string, fits: (v: unknown) => v is T) => {
		const v = view[name];
		if (v === undefined || fits(v)) return v;
		wrong.push(`${name} must be ${kind}`);
		return undefined;
	};
	const state = pick("state", "a function", isFunction);
	const step = pick("step", "a function", isFunction);
	const group = pick("group", "a function", isFunction);
	const exported = pick("colors", "a plain object", isPlainObject);
	const title = pick("title", "a string", isString);
	if (wrong.length) throw new Error(`The view's ${joinList(wrong)}.`);
	if (group !== undefined && exported === undefined)
		throw new Error("The view exports group() but no colors. Give each group a color in colors.");
	const colors = Object.create(null) as { [group: string]: string };
	const bad: string[] = [];
	for (const [name, color] of Object.entries(exported ?? {})) {
		if (typeof color === "string" && THEME_COLORS.includes(color)) colors[name] = color;
		else bad.push(`${JSON.stringify(name)} the color ${literal(color)}`);
	}
	if (bad.length)
		throw new Error(
			`The view's colors give ${joinList(bad)}. Give each group ${joinList(THEME_COLORS, "or")}.`,
		);
	// A group the colors table does not name fails at once, not later as an uncolored node.
	const named =
		group &&
		((vars: Vars) => {
			const g = group(jsonVars(vars));
			if (g !== undefined && !Object.hasOwn(colors, typeof g === "symbol" ? g : groupText(g)))
				throw new Error(
					`The view's group() returned ${literal(g)}, which colors does not name. Give each group a color in colors.`,
				);
			return g;
		});
	return {
		state: state && ((vars: Vars) => state(jsonVars(vars))),
		step:
			step &&
			((action: string, from: Vars, to: Vars) => step(action, jsonVars(from), jsonVars(to))),
		group: named,
		colors,
		title,
		[checked]: true,
	};
}
