/**
 * The library entry: run the check, then turn its result into the chart and report files. The
 * command line is the main way in; these exports let a script skip it.
 */

export { buildOutputs } from "./build-outputs.ts";
export { check } from "./tlc/check.ts";
export { checkView } from "./parse/view-module.ts";
export type { CheckResult, View } from "./model/types.ts";
