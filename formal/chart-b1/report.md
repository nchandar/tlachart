# JanitorLast

TLC reached 572 states, more than the chart budget of 500, so the chart draws only the bug paths: 8 states and 9 arrows.

## P3 breaks
TLC's counterexample has 9 steps:
0. start / none / none
1. CheckOut: checked / none / none
2. MakeStage: stage / none / none
3. MakeTmp: tmp / none / none
4. OutsideWrite: tmp / none / none
5. SpawnWorker: spawned / waiting / none
6. Sigint: spawned / waiting / none
7. Sigkill: dead / waiting / none
8. WorkerLoadView: dead / loading / none
9. WorkerFail: dead / exited / none
The run stops in "dead / exited / none" forever.
