// The data every layer shares: parsed TLC output, the state graph and the chart. No logic lives
// here.

import { checked } from "./constants.ts";

/** A TLA+ value as TLC prints it. */
export type Value =
	| boolean
	| number
	| string
	| { kind: "model"; name: string }
	| { kind: "set"; members: Value[] }
	| { kind: "interval"; lo: number; hi: number }
	| { kind: "function"; printedAs: "tuple" | "record" | "pairs"; keys: Value[]; values: Value[] };

/** One state's variables, by name. */
export type Vars = { [name: string]: Value };

/** A rule TLC checks: an invariant, a property or the deadlock check. */
export type Rule = { kind: "invariant" | "deadlock" | "property"; name: string };

type StateBase = { vars: Vars; start: boolean; breaks: Rule[] };

/** A state past a CONSTRAINT bound; checked for rules but not explored. */
export type PastState = StateBase & { ends: Rule[]; past: true; excluded: boolean };

/** A state TLC listed, either explored or past a CONSTRAINT bound. */
export type State =
	(StateBase & { ends?: Rule[]; past?: undefined; excluded?: undefined }) | PastState;

/** One edge of TLC's graph: the action TLC took and the state keys at each end. */
export type Step = { from: string; to: string; action: string };

/** TLC's state graph: every state it listed and every step between them. */
export type Graph = { states: Map<string, State>; steps: Step[] };

/** One drawn step of a bug path: its action, the state key it lands in and the graph step. */
export type PathStep = { action: string; state: string; step: Step };

/** A child process's output as byte chunks, so a long TLC run is never held whole. */
export type Output = Iterable<Uint8Array>;

/** A liveness counterexample: the path to the loop and where the loop starts. */
export type Lasso = {
	start: string;
	path: PathStep[];
	loop: number | undefined;
	stutters: boolean;
};

/** A marked state from the drawing run: the values TLC printed and the rules it breaks. */
export type Mark = { values: Value[]; broken: string[] };

/** The rules each state key breaks past a CONSTRAINT bound, by state key. */
export type Past = Map<string, Set<Rule>>;

/** One state of a TLC counterexample, with the action that reached it. */
export type TraceState = { action: string; vars: Vars };

/** A liveness counterexample: its states and where the loop starts, if it has one. */
export type Trace = {
	seq: { action: string; vars: Vars | undefined }[];
	loop: number | undefined;
};

/** Looks a state up by its values; undefined when the graph does not list it. */
export type Find<Id> = (values: Value[]) => Id | undefined;

/** A shortest path to a rule that breaks, ready to draw. */
export type Bug = {
	rule: Rule;
	start: string;
	path: PathStep[];
	loop?: number;
	stutters?: boolean;
};

/** One line of a TLC config: the keyword, its line number and the tokens after it. */
export type ConfigSection = { key: string; line: number; tokens: string[] };

/** A TLC config, with the sections the checker reads pulled out by name. */
export type Config = {
	sections: ConfigSection[];
	invariants: string[];
	properties: string[];
	constraints: string[];
	actionConstraints: string[];
	checkDeadlock?: boolean;
	init?: string;
	next?: string;
	spec?: string;
	view?: string;
	symmetry?: string;
	type?: string;
	typeConstraint?: string;
};

/** The checks to run and the spec's variables, as the config and SANY report them. */
export type Spec = {
	module: string;
	variables: string[];
	invariants: string[];
	properties: string[];
	deadlock: boolean;
	written: ConfigSection[];
};

/** One structured TLC message: its code, severity level and body, which may hold more messages. */
export type Message = { code: number; level: number; body: Part[]; beforeMarker?: string };

/** A plain line of TLC output that is not part of a message. */
export type Line = string;

/** One piece of TLC output, a plain line or a structured message. */
export type Part = Line | Message;

/** What TLC found for a rule in one run. */
export type Outcome = "broken" | "holds" | "not checked";

/** TLC's finding for one rule, with the messages it printed while checking it. */
export type Verdict = {
	rule: Rule;
	outcome: Outcome;
	messages: Iterable<Part> | undefined;
};

/** A property's verdict, with its liveness counterexample when it breaks. */
export type Property = Verdict & { bug: Lasso | undefined; initialOnly: boolean };

/** How a TLC run ended when it did not finish on its own. */
export type Stop = { status: number | null; message: string };

/** Everything one checker run produced, before the chart is built. */
export type CheckResult = {
	spec: Spec & { folder: string };
	graph: Graph;
	paths: Bug[] | undefined;
	rules: Verdict[];
	properties: Property[];
	exit: 0 | 1 | 2;
	stop: Stop | undefined;
	drawing: { status: number | null } | undefined;
	states: { distinct: number; initial: number; complete: boolean; cut: boolean };
	messages: Iterable<Part>;
};

/** The optional view module's hooks; each answer becomes a label, a group or a color. */
export type View = {
	state?: (vars: Vars) => unknown;
	step?: (action: string, from: Vars, to: Vars) => unknown;
	group?: (vars: Vars) => unknown;
	colors?: { [group: string]: string };
	title?: string;
};

/** A view that passed validation; the brand keeps unchecked views out of the drawing code. */
export type CheckedView = View & { readonly [checked]: true };

/** One state's label in each parallel region, by region name. */
export type Shape = { [region: string]: string[] };

/** The state graph as index arrays, so the analyses search and sort without map lookups. */
export type Walk = {
	ids: string[];
	states: State[];
	index: Map<string, number>;
	nameOf: string[];
	nameRank: Int32Array;
	from: Int32Array;
	to: Int32Array;
	action: Int32Array;
	depth: Int32Array;
	via: Int32Array;
	reached: Int32Array;
	starts: number[];
};

/** A step the view hides, so no arrow is drawn for it. */
export type Hidden = null;

/** What the view answered for every state and step, before equal labels are merged. */
export type Answers = {
	names: string[];
	shapes: Shape[];
	labels: (string | Hidden)[];
	group: (i: number) => unknown;
};

/** The merged label state the drawing steps pass along. */
export type Labels = Answers & {
	drawnLabels: string[];
	keys: string[][];
	kinds: Int32Array[];
	sizes: number[];
	sorted: Int32Array;
	pathStepIndex: Map<Step, number>;
	pathSteps: Uint8Array;
	together: Set<string>;
	notes: string[];
};

/** A bug's path as the report tells it: each state, with the step label that reaches it. */
export type Story = { step?: string; state: Shape }[];

/** A state as the chart draws it, with the marks and group it carries. */
export type ChartState = {
	path: string[];
	start: boolean;
	members: number[];
	works: boolean;
	lead: boolean;
	repeats: boolean;
	breaks: { rule: Rule; always: boolean }[];
	group: unknown;
};

/** The other regions' labels an arrow needs; and, or, or the whole combination spelled out. */
export type Condition =
	{ kind: "and" | "or"; otherKeys: Set<string>[] } | { kind: "tuples"; otherTuples: Set<string> };

/** An arrow drawn between chart states, with its bracket condition. */
export type Arrow = {
	from: string;
	to: string;
	label: string;
	condition: Condition;
	when?: string;
};

/** A step of a region: the state path at each end, its label and the condition it carries. */
export type ChartStep = {
	from: string[];
	to: string[];
	label: string;
	when: string | undefined;
};

/** One region of the chart: its states, steps and arrows. */
export type Region = {
	name: string;
	states: ChartState[];
	steps: ChartStep[];
	arrows: Arrow[];
};

/** The finished chart, ready to print as Mermaid and to describe in the report. */
export type Chart = {
	title: string | undefined;
	regions: Region[];
	notes: string[];
	inside: number;
	quiet: number;
	colors: { [group: string]: string };
	paths: string[];
	loops: string[];
	lie?: string;
};
