# coverage: OutFolder

The promise: **the tlachart command's `--out` and its processes and folders end well, whichever
signal arrives when.**

Model: `OutFolder.tla` (16 variables, one step per code step). Checked with TLC 2.19, then broken
once per rule, then replayed on the code. The model, its variants and the coverage record live in
`formal/`, versioned with the code they check.

## Where the model lives

| What | Value |
|---|---|
| Repo that holds the covered code | this repository |
| Sync commit | the sync commit is HEAD of the release branch |
| Model folder | `formal/` |
| Drift | `git diff` against the sync commit is empty for the three covered files; the line ranges below are from that tree |

Re-run the model when any of `src/cli/main.ts`, `src/cli/check-worker.ts` or `src/tlc/process.ts`
changes.

## Files and functions covered

| File | What the model names | Lines at the sync commit |
|---|---|---|
| `src/cli/main.ts` | CheckOut, RefuseNonEmpty (the link refusal, readdir then realpath, the non-empty refusal) | 77-109 |
| `src/cli/main.ts` | SpawnJanitor (folder names picked first, janitor spawned before either exists) | 111-134 |
| `src/cli/main.ts` | MakeStage, MakeTmp (mkdir 0700, not mkdtemp) | 136-137 |
| `src/cli/main.ts` | SpawnWorker (detached, stdin pipe), TellJanitor (pgid on stdin), ReleaseWorker (go line) | 155-174 |
| `src/cli/main.ts` | MainRace, KillGroup, Decide, MakeParents, RenameDone, RenameRefused | 175-205 |
| `src/cli/main.ts` | RemoveStage, RemoveTmp, StopJanitor, Exit (the finally and `process.exit`) | 215-220 |
| `src/cli/main.ts` | Sigint, Sigkill (the handler at 31-39 records the first SIGINT/SIGTERM; SIGKILL has no handler) | 31-39 |
| `src/cli/main.ts` | WorkerEofExit (the worker's go handshake) | 171-174 |
| `src/cli/check-worker.ts` | WorkerLoadView, WorkerStartTlc, WorkerSpin, WorkerMakeDraft, WorkerWriteFile, WorkerRenameDone, WorkerExit, WorkerFail | 15-56 |
| `src/tlc/process.ts` | `killGroup` (kill -KILL of the worker's group) | 43-50 |
| `src/tlc/process.ts` | `runToFiles` (TLC runs in the worker's group, so the group kill reaches it) | 73-104 |

## Rules

| Rule | Plain sentence | Kind |
|---|---|---|
| `WholeResult` | A result in `--out` is whole, never a partial one. | P1, safety |
| `KeepUserFiles` | Once the user's files are in `--out`, they stay. | P1, safety (history) |
| `NoUnprotectedTlc` | No TLC runs before the janitor knows the group it must kill. | P2 design rule, safety |
| `P2` | After main is dead, no worker and no TLC remains. | P2, liveness |
| `P3` | After main is dead, neither folder survives. | P3, liveness |

## Bound and what the model leaves out

Bound: 1 main, 1 worker, 1 TLC (folded into the worker's group), 1 janitor, 1 outside writer with
one write, `WorkerFiles = 2` (a result can be partial), one recorded stop (SIGINT and SIGTERM
folded into one action), one SIGKILL, at most one signal of each kind. A view that never returns
is a choice after TLC ends (`WorkerSpin`).

Left out, so a pass holds only without them: timers and `await` latency (the janitor fires "at
EOF", not after N ms), disk durability and fsync, TLC and the config/view logic (collapsed to "a
result or a failure"), file contents, exit code numbers beyond success and failure, stdout
printing and EPIPE, a spawn that misfires (tool resolution before the spawn is folded into this; a
SIGKILL during it can leave mise running until it exits, since mise is neither a worker nor TLC),
a janitor killed by an outsider, and pid reuse.

## Command and result

```sh
export TLA2TOOLS=$HOME/.local/share/tla/tla2tools.jar
bun run model
```

The script runs plain TLC (`-workers 1`) on `formal/OutFolder.tla` with `formal/OutFolder.cfg`, and
prints its output unchanged. A real run ends with:

```
Model checking completed. No error has been found.
1136 states generated, 516 distinct states found, 0 states left on queue.
The depth of the complete state graph search is 27.
```

That proves the design within the bound, not the code; the replay below is the code check.

## Every rule seen failing

Each variant is a copy of `OutFolder.tla` with one check removed or one step reordered in
`formal/variants/`; each cfg names only the rule under test, so the named rule is unambiguous.

| Variant | Break | TLC's line |
|---|---|---|
| `DirectWrite` | the worker writes each file straight into `--out` | `Error: Invariant WholeResult is violated.` |
| `OverwriteUser` | the final rename replaces a non-empty `--out` | `Error: Temporal properties were violated.` (cfg: `PROPERTY KeepUserFiles`) |
| `NoHandshake` | the worker starts TLC as soon as it is spawned, before the janitor has its group | `Error: Invariant NoUnprotectedTlc is violated.` |
| `JanitorNoKill` | the janitor removes the folders but never kills the group | `Error: Temporal properties were violated.` (cfg: `PROPERTY P2`) |
| `JanitorLast` | the old order: stage, tmp, worker, janitor, no go line | `Error: Temporal properties were violated.` for P3 and for P2 |

`bun run model:variants` prints the rule each config declares and the rule TLC named, and exits
non-zero on any mismatch. TLC prints only "Temporal properties were violated" for a property, so
for those the rule is the single property the variant's cfg declares.

`JanitorLast` is the code's old order (B1). Its P3 trace ends with main dead, a janitor that does
not exist, and `stage = "present"`; its P2 trace ends with main dead, no janitor, and a worker
still `drafting`.

Dogfood chart of the B1 counterexample, drawn by the tool under test:

```sh
bun src/cli/main.ts formal/variants/JanitorLast.tla \
  --config formal/variants/cfg/JanitorLast.P3.cfg \
  --view formal/view.mjs --out /tmp/janitor-last-chart
```

That writes `chart.mmd` and `report.md` matching `formal/chart-b1/`.


## Replay on the code (red first, then green)

The hold seam names a file per point: `TLACHART_HOLD_WORKER`, `TLACHART_HOLD_RELEASE` and
`TLACHART_HOLD_RENAME`; main writes `<file>.reached` and waits for `<file>`; inert unless set. The
first two tests kill main at those points with SIGKILL; the last holds main after the
rename.

| Test | Red before the fix | Green |
|---|---|---|
| `a SIGKILL of the command before the worker starts leaves no folder behind` | `[ ".out.tlachart-BpkNQx" ]` left in the parent folder (no janitor existed yet) before the fix | pass after the fix |
| `a SIGKILL of the command after the worker starts stops the worker and removes both folders` | `Process 76914 is still running.` (worker ran on with no janitor to kill it) before the fix | pass after the fix |
| `a result already renamed into --out keeps its exit code when a late read fails` | exit 2 (`2 !== 1`) with the whole folder already in `--out` before the fix | pass after the fix |

Full run after the fix: `bun test test/cli.test.ts` gives 128 pass, 0 fail (52.5 s).

## Accepted risks, with a reason each

| Item | Verdict | Reason |
|---|---|---|
| B2 pid reuse | accepted | The janitor may `kill -KILL -pgid` again after the worker was reaped, if main dies between the reap and the janitor kill. The kernel would have to reuse that pid as a new group leader in that window; no deterministic replay. |
| B3 exit 2 after a whole result is renamed | **fixed** | `report.md` is read from the staged `done` folder before the rename, and the post-rename print is best effort, so a late read failure or a closed stdout keeps the check's exit code. Red then green in the replay table. |
| B4 `rmSync(stage)` throws | accepted | The janitor now always outlives main and removes both folders at exit, so a throw in the finally self-heals; the exit code may still be 2 after a whole result if `rmSync` throws there, which B3's fix does not cover. |
| B5 no `worker.on("error")` | accepted | A spawn failure emits an unhandled `error` and main dies. The janitor now exists before the spawn, so both folders are removed and no worker ran; the harm is an exit code and a stack trace. |
| B6 outsider retargets a symlinked `dest` after realpath | accepted | A link at `--out` itself is refused now; a link swapped in for the empty folder after realpath still makes the rename land on the old real target. Outside P1's text: the folder is still whole and no user file is overwritten; the model has no symlink. |
| B7 the janitor killed by an outsider | accepted | The janitor is a single detached `/bin/sh`. An outsider SIGKILL of it, then a SIGKILL of main, leaks. Not a signal the command receives; a supervisor would be needed to cover it. |
| B1 stage/tmp and the worker unprotected in setup | **fixed** | The janitor is spawned before the folders exist, the group id arrives on its stdin, and the worker starts TLC only after a go line. Replayed red then green above. |

## Re-running

```sh
export TLA2TOOLS=$HOME/.local/share/tla/tla2tools.jar
bun run model
bun run model:variants
bun test test/formal.test.ts
```

`formal.test.ts` skips when `TLA2TOOLS` is unset; `bun run check` does not need it. Both scripts
exit 2 with a message when `TLA2TOOLS` is unset.

