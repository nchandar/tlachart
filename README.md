# tlachart

[![CI](https://github.com/nchandar/tlachart/actions/workflows/ci.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/ci.yml)
[![ESLint](https://github.com/nchandar/tlachart/actions/workflows/eslint.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/eslint.yml)
[![TypeScript](https://github.com/nchandar/tlachart/actions/workflows/types.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/types.yml)
[![Tests](https://github.com/nchandar/tlachart/actions/workflows/test.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/test.yml)
[![Package](https://github.com/nchandar/tlachart/actions/workflows/package.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/package.yml)
[![Formal model](https://github.com/nchandar/tlachart/actions/workflows/formal.yml/badge.svg)](https://github.com/nchandar/tlachart/actions/workflows/formal.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Mermaid chart for TLA+ specs. Give it a spec; TLC checks the rules, and you get a chart of the
states in the reader's words plus a report with the shortest path to each broken rule.

Bun is required. Node is not supported: it refuses TypeScript under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).

## Requirements

- Bun 1.1.5 or later. Tested with 1.4.4.
- Java 11 or later. Tested with 25.
- TLC 1.7.4 as `tla2tools.jar`, from the [TLA+ releases](https://github.com/tlaplus/tlaplus/releases).
- Either set `TLA2TOOLS` (path to the jar) and optionally `JAVA` (default `java`), or install
  [mise](https://mise.jdx.dev). Without `TLA2TOOLS` the command asks mise for the pinned Java 25 and
  TLC, a download of about 535 MB.

## Install and run

```sh
bunx tlachart SPEC.tla
```

`bunx` runs the published package without installing it. To keep the command:

```sh
bun add -g tlachart
tlachart SPEC.tla
```

It prints the report and writes `chart.mmd`, `report.md`, `tlc.out` and `tlc-RULE.out` to a new
folder next to the spec (`SPEC-chart/`), or to `--out`, which must be new or empty and not a symlink. `chart.mmd` is
Mermaid text: paste it into a Mermaid viewer or a fenced `mermaid` block on GitHub.

## From source

```sh
git clone https://github.com/nchandar/tlachart
cd tlachart
bun install --frozen-lockfile
export TLA2TOOLS=$HOME/.local/share/tla/tla2tools.jar
bun src/cli/main.ts examples/checkout/Checkout.tla --view examples/checkout/view.mjs --out /tmp/checkout-chart
```

It exits 1 because the seeded bug breaks a rule. The report ends with:

```
## NeverChargedTwice breaks
The shortest path has 5 steps:
0. Screen Cart, Payment No charge
1. you go to the address step: Screen Address, Payment No charge
2. you go to payment: Screen Paying, Payment No charge
3. you double-click Pay: Screen Paying, Payment Two charges pending
4. the charge goes through: Screen Paying, Payment Charged once, one pending
5. the charge goes through: Screen Paid, Payment Charged twice

## Rules that hold
NoDeadlock
```

The fixed spec holds, so the command exits 0:

```sh
bun src/cli/main.ts examples/checkout/CheckoutFixed.tla --view examples/checkout/view.mjs --out /tmp/checkout-fixed
```

## Examples

Each example has a buggy spec, a fixed spec, a view, and the chart and report for both.

| Example                       | What it models                                                                           | Buggy rule                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Checkout](examples/checkout) | Front end: cart, address, payment, paid; Pay and a double click; regions Screen, Payment | Never charged twice                                               |
| [Retry](examples/retry)       | Back end: client, server, timeout, duplicate request, idempotency key                    | Charge applied at most once; the request eventually settles holds |
| [Order](examples/order)       | Order lifecycle: placed, paid, shipped, cancelled, refunded; groups and colors           | No refund before payment                                          |

The `Fixed` spec removes the seeded bug and exits 0. Committed output is under `buggy/` and `fixed/`.
Run any example with:

```sh
bun src/cli/main.ts examples/retry/Retry.tla --view examples/retry/view.mjs --out /tmp/retry-chart
```

## The view module

The view decides the words. It is a `.mjs` or `.ts` module passed with `--view`.

`state(vars)` returns one of:

- a string, for a flat chart: `export const state = (v) => (v.paid ? "Paid" : "Paying")`
- an array, for parent states: `export const state = (v) => v.main.split(".")`
- an object, for one parallel region per key: `export const state = (v) => ({ Screen: v.screen, Payment: v.payment })`

`step(action, from, to)` returns the words for an arrow, or `null` to hide it. Steps from the same
state to the same state with the same label share one arrow. A step that stays in one label is not
drawn.

`group(vars)` returns a phase name. `colors` is then required, and gives each phase one of `blue`,
`orange`, `purple`, `yellow`, `teal`, `tan`, `pink`. `title` is a string at the top of the chart.

```js
const label = {
	placed: "Placed",
	paid: "Paid",
	shipped: "Shipped",
	cancelled: "Cancelled",
	refunded: "Refunded",
};

export const state = (v) => label[v.status];

export const step = (action) =>
	({
		Pay: "you pay",
		Ship: "the order ships",
		Cancel: "you cancel",
		RequestRefund: "you ask for a refund",
		Done: null,
	})[action] ?? action;

export const group = (v) =>
	v.status === "cancelled" || v.status === "refunded" ? "Closed" : "Open";

export const colors = { Open: "blue", Closed: "tan" };

export const title = "Order lifecycle";
```

`vars` is plain JSON: a TLA+ sequence is an object with keys from 1, and a set is an array. Each
function depends only on its arguments: the command calls it once and uses that answer in both the
chart and the report.

In a regions chart, write a condition in brackets only when it concerns the same region. The command
writes the other regions' conditions itself, such as `[when Sending]`. Keep the chart near 20 arrows
or fewer. Return `null` from `step()` for steps the reader does not need, but keep every chart state
reachable and an arrow out of every state that has a step.

## Reading the chart and report

`report.md` gives the state count, each broken rule with its shortest path, and the rules that hold.
TLC goes past a state that breaks a rule, so the chart also shows the states after the bug.

The chart marks states with CSS classes, and the Legend names the rule behind each mark:

| Mark       | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `breaks`   | The rule breaks in every model state behind this chart state. |
| `mayBreak` | The rule breaks in some of the model states behind it.        |
| `bugPath`  | The state is on the shortest path to a bug.                   |
| `repeats`  | A liveness counterexample loops through this state.           |

`tlc.out` is what TLC printed for the config as written. Each property that breaks and each rule
that breaks off the chart also writes `tlc-RULE.out`.

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | Every rule holds. Output is written.                                |
| 1    | A rule breaks. Output is written.                                   |
| 2    | TLC stopped with an error, or the command could not run. No output. |
| 130  | SIGINT stopped the check. No output.                                |
| 143  | SIGTERM stopped the check. No output.                               |

## Limits

- The chart budget is 500 states. Above it the chart draws only the paths to broken rules; with no
  broken rule there is no `chart.mmd`, and the report still gives the state count and each path.
- After the first broken rule, each rerun stops at 100,000 distinct states. Rules it did not reach
  are listed under "Rules not checked" in the report.
- TLC runs with one worker, so shortest paths are deterministic.
- Windows is unsupported: the command stops TLC through a process group with `/bin/sh`.
- Add `EXTENDS Naturals` when a spec uses `+` or `<=`, or TLC cannot read it.

## Trust model

A spec is code for TLC, and so is its `.cfg`. A `.jar` or `.class` file beside the spec may be
loaded too, and the `--view` module is imported into the command's own process. All of this runs
as you, with your files and network. Use only specs you trust, or run the command in a container
or a VM.

There is no timeout and no cap on memory or disk. The command passes a trimmed environment to
TLC and to the view, but that bounds what such code reads, not what it can do.

The mise child, which downloads the pinned Java and TLC, alone gets the proxy and certificate
variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` in either case, plus
`SSL_CERT_FILE`, `SSL_CERT_DIR` and `CURL_CA_BUNDLE`); TLC and the view get none of them. Behind
a proxy you can instead set `TLA2TOOLS` and `JAVA` to skip mise.

## Formal model

`formal/` holds a TLA+ model of the command's output handling.

- **P1, whole or nothing:** a result in `--out` is whole or absent, and user files already there are
  never overwritten.
- **P2, nothing outlives the command:** after the command is dead no worker and no TLC remains,
  whichever signal arrives when.
- **P3, no folders left:** the staging and temp folders are removed whichever way the command ends.

Run it with `TLA2TOOLS` set (`bun run check` does not need it):

```sh
bun run model          # the real model: no error
bun run model:variants # each broken copy must fail on the rule it breaks
```

It covers `src/cli/main.ts`, `src/cli/check-worker.ts` and `src/tlc/process.ts`: re-run it when any
of them changes. The bound, the variants and the accepted risks are in
[formal/coverage.md](formal/coverage.md).

## Credit

Inspired by the `statechart` skill in Lauren Tan's [pstack](https://github.com/cursor/plugins) (MIT).
Her licence is in [LICENSE-pstack](LICENSE-pstack); this project is MIT, see [LICENSE](LICENSE).
