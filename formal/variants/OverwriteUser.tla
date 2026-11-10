---- MODULE OverwriteUser ----
\* The --out promise of the tlachart command. Steps map to src/cli/main.ts and
\* src/cli/check-worker.ts in ~/tlachart (branch fv at the sync commit in coverage.md).
\*
\* P1 a whole result or nothing, and a non-empty --out is never overwritten.
\* P2 no java or worker outlives the command, whichever signal arrives when.
\* P3 the staging and temp folders are removed whichever way the command ends.
\*
\* What the model leaves out: timers and await latency, disk durability and fsync,
\* TLC and the view logic (the worker makes a result or fails), file contents,
\* exit code numbers beyond success and failure, stdout printing, misfiring spawn.
\* A passing run proves the design under those bounds, not the code.

EXTENDS Naturals

CONSTANTS WorkerFiles \* files the worker writes into draft; 2 covers partial

VARIABLES
  mainPc, mainAlive, stopSignal, \* main's step, its liveness, the first SIGINT/SIGTERM recorded
  goSent, \* main told the worker to start, after the janitor knew the worker's group
  workerPc, workerVerdict, javaAlive, \* the worker's step, its exit code, TLC's liveness
  janitorState, janitorKnown, \* "none" | "armed" | "dead" | "fired"; does the janitor know the pgid
  stage, tmp, draftFiles, doneDir, \* the two folders and what the worker has staged in stage
  destUser, destResult, destWhole \* --out: user's files present, a result present, the result whole

vars ==
  <<mainPc, mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
    janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
    destUser, destResult, destWhole>>

workerAlive ==
  workerPc \in {"waiting", "loading", "checking", "drawing", "spinning", "drafting", "finished"}

success == workerPc = "exited" /\ workerVerdict \in {0, 1} /\ doneDir /\ ~stopSignal

Init ==
  /\ mainPc = "start"
  /\ mainAlive = TRUE
  /\ stopSignal = FALSE
  /\ goSent = FALSE
  /\ workerPc = "none"
  /\ workerVerdict = 0
  /\ javaAlive = FALSE
  /\ janitorState = "none"
  /\ janitorKnown = FALSE
  /\ stage = "none"
  /\ tmp = "none"
  /\ draftFiles = 0
  /\ doneDir = FALSE
  /\ destUser = FALSE
  /\ destResult = FALSE
  /\ destWhole = TRUE

\* main.ts:64-77: readdir(out) then realpath(out).
CheckOut ==
  /\ mainPc = "start"
  /\ mainPc' = "checked"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:79-82: entries in --out refuse the run before anything is made.
RefuseNonEmpty ==
  /\ mainPc = "checked"
  /\ destUser
  /\ mainPc' = "exited"
  /\ mainAlive' = FALSE
  /\ UNCHANGED
      <<stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:125-136: the janitor is spawned before either folder exists, so no kill can
\* leave a folder with no cleaner.
SpawnJanitor ==
  /\ mainPc = "checked"
  /\ ~destUser
  /\ mainPc' = "janitor"
  /\ janitorState' = "armed"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:87: mkdtemp stage beside --out.
MakeStage ==
  /\ mainPc = "janitor"
  /\ mainPc' = "stage"
  /\ stage' = "present"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:93: mkdtemp tmp.
MakeTmp ==
  /\ mainPc = "stage"
  /\ mainPc' = "tmp"
  /\ tmp' = "present"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:107-122: detached worker; its stdin is a pipe from main.
SpawnWorker ==
  /\ mainPc = "tmp"
  /\ workerPc = "none"
  /\ mainPc' = "spawned"
  /\ workerPc' = "waiting"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:157: main sends the worker's group id to the janitor.
TellJanitor ==
  /\ mainPc = "spawned"
  /\ mainPc' = "told"
  /\ janitorKnown' = TRUE
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:157: the go line, sent only after TellJanitor, so TLC never starts unprotected.
ReleaseWorker ==
  /\ mainPc = "told"
  /\ workerPc = "waiting"
  /\ mainPc' = "released"
  /\ goSent' = TRUE
  /\ UNCHANGED
      <<mainAlive, stopSignal, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:18-25: load the view.
WorkerLoadView ==
  /\ goSent
  /\ workerPc = "waiting"
  /\ workerPc' = "loading"
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:26 via tlc/check.ts:94: TLC runs.
WorkerStartTlc ==
  /\ workerPc = "loading"
  /\ workerPc' = "checking"
  /\ javaAlive' = TRUE
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* tlc/check.ts: the TLC run ends; the worker draws the chart next.
WorkerFinishTlc ==
  /\ workerPc = "checking"
  /\ workerPc' = "drawing"
  /\ javaAlive' = FALSE
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* A view whose state() never returns: the worker cannot notice its pipe closing.
WorkerSpin ==
  /\ workerPc = "drawing"
  /\ workerPc' = "spinning"
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:28: mkdir draft.
WorkerMakeDraft ==
  /\ workerPc = "drawing"
  /\ workerPc' = "drafting"
  /\ draftFiles' = 0
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:29-38: write one file into draft.
WorkerWriteFile ==
  /\ workerPc = "drafting"
  /\ draftFiles < WorkerFiles
  /\ draftFiles' = draftFiles + 1
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:39: rename(draft, done) is the only way a result becomes visible.
WorkerRenameDone ==
  /\ workerPc = "drafting"
  /\ draftFiles = WorkerFiles
  /\ workerPc' = "finished"
  /\ workerVerdict' \in {0, 1}
  /\ doneDir' = TRUE
  /\ draftFiles' = 0
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, javaAlive,
        janitorState, janitorKnown, stage, tmp,
        destUser, destResult, destWhole>>

\* check-worker.ts:40: exit 0 or 1 after a whole result is staged.
WorkerExit ==
  /\ workerPc = "finished"
  /\ workerPc' = "exited"
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* check-worker.ts:41-43: a throw leaves no done folder and exit 2.
WorkerFail ==
  /\ workerPc \in {"loading", "checking", "drawing"}
  /\ workerPc' = "exited"
  /\ workerVerdict' = 2
  /\ javaAlive' = FALSE
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:142: the race resolves when the worker exits.
MainRaceWorker ==
  /\ mainPc = "released"
  /\ workerPc = "exited"
  /\ mainPc' = "reaped"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:142: the race resolves when SIGINT or SIGTERM was recorded.
MainRaceStop ==
  /\ mainPc = "released"
  /\ stopSignal
  /\ mainPc' = "reaped"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:143: killGroup(worker.pid) reaches the worker, TLC and any stray in its group.
KillGroup ==
  /\ mainPc = "reaped"
  /\ mainPc' = "groupKilled"
  /\ workerPc' = IF workerAlive THEN "killed" ELSE workerPc
  /\ javaAlive' = FALSE
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerVerdict,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:144: await the worker's exit after the group kill.
AwaitExit ==
  /\ mainPc = "groupKilled"
  /\ workerPc \in {"exited", "killed"}
  /\ mainPc' = "waited"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:145-167: stopSignal, then a killed worker, then a whole result, else exit 2.
Decide ==
  /\ mainPc = "waited"
  /\ mainPc' = IF success THEN "parents" ELSE "cleanup"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:152: mkdir -p dirname(dest). It makes no state the promises name.
MakeParents ==
  /\ mainPc = "parents"
  /\ mainPc' = "renaming"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:156: the only write into --out. rename(2) into a non-empty folder fails, so
\* an absent or empty dest becomes the whole result.
RenameDone ==
  /\ mainPc = "renaming"
  /\ ~destResult
  /\ mainPc' = "cleanup"
  /\ destResult' = TRUE
  /\ destWhole' = TRUE
  /\ destUser' = FALSE
  /\ doneDir' = FALSE
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles>>

\* main.ts:157-162: ENOTEMPTY or EEXIST from the rename names the outsider's file and
\* exits 2, and the user's folder is untouched.
RenameRefused ==
  /\ mainPc = "renaming"
  /\ destUser
  /\ mainPc' = "cleanup"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:169: rm stage.
RemoveStage ==
  /\ mainPc = "cleanup"
  /\ mainPc' = "cleanedStage"
  /\ stage' = "removed"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:170: rm tmp.
RemoveTmp ==
  /\ mainPc = "cleanedStage"
  /\ mainPc' = "cleanedTmp"
  /\ tmp' = "removed"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:171: kill the janitor, now that both folders are gone.
StopJanitor ==
  /\ mainPc = "cleanedTmp"
  /\ mainPc' = "cleaned"
  /\ janitorState' = "dead"
  /\ UNCHANGED
      <<mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:173: process.exit.
Exit ==
  /\ mainPc = "cleaned"
  /\ mainPc' = "exited"
  /\ mainAlive' = FALSE
  /\ UNCHANGED
      <<stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:32-35: the first SIGINT or SIGTERM is recorded; a later one is ignored.
Sigint ==
  /\ mainAlive
  /\ ~stopSignal
  /\ mainPc # "exited"
  /\ stopSignal' = TRUE
  /\ UNCHANGED
      <<mainPc, mainAlive, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* No handler: main dies at once and its finally never runs.
Sigkill ==
  /\ mainAlive
  /\ mainPc # "exited"
  /\ mainAlive' = FALSE
  /\ mainPc' = "dead"
  /\ UNCHANGED
      <<stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* main.ts:129: on EOF the janitor kills the worker's group, if main told it the pgid,
\* and removes both folders.
JanitorFire ==
  /\ ~mainAlive
  /\ janitorState = "armed"
  /\ janitorState' = "fired"
  /\ stage' = "removed"
  /\ tmp' = "removed"
  /\ workerPc' = IF janitorKnown /\ workerAlive THEN "killed" ELSE workerPc
  /\ javaAlive' = IF janitorKnown THEN FALSE ELSE javaAlive
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict,
        janitorKnown, draftFiles, doneDir, destUser, destResult, destWhole>>

\* check-worker.ts handshake: main died before the go line, so the worker exits without
\* ever starting TLC.
WorkerEofExit ==
  /\ ~mainAlive
  /\ ~goSent
  /\ workerPc = "waiting"
  /\ workerPc' = "killed"
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destUser, destResult, destWhole>>

\* An outsider creates or fills --out while the check runs (one action).
OutsideWrite ==
  /\ ~destResult
  /\ ~destUser
  /\ destUser' = TRUE
  /\ UNCHANGED
      <<mainPc, mainAlive, stopSignal, goSent, workerPc, workerVerdict, javaAlive,
        janitorState, janitorKnown, stage, tmp, draftFiles, doneDir,
        destResult, destWhole>>

Next ==
  \/ CheckOut \/ RefuseNonEmpty \/ SpawnJanitor \/ MakeStage \/ MakeTmp
  \/ SpawnWorker \/ TellJanitor \/ ReleaseWorker
  \/ WorkerLoadView \/ WorkerStartTlc \/ WorkerFinishTlc \/ WorkerSpin
  \/ WorkerMakeDraft \/ WorkerWriteFile \/ WorkerRenameDone \/ WorkerExit \/ WorkerFail
  \/ MainRaceWorker \/ MainRaceStop \/ KillGroup \/ AwaitExit \/ Decide
  \/ MakeParents \/ RenameDone \/ RenameRefused
  \/ RemoveStage \/ RemoveTmp \/ StopJanitor \/ Exit
  \/ Sigint \/ Sigkill \/ JanitorFire \/ WorkerEofExit \/ OutsideWrite

Spec == Init /\ [][Next]_vars /\ WF_vars(JanitorFire) /\ WF_vars(WorkerEofExit) /\ WF_vars(WorkerExit)

\* P1: --out holds a whole result or nothing.
WholeResult == [](destResult => destWhole)

\* P1: a non-empty --out is never overwritten.
KeepUserFiles == [](destUser => []destUser)

\* P2's design rule: no TLC runs before the janitor can kill its group.
NoUnprotectedTlc == [](javaAlive => janitorKnown)

\* P2: after main is dead, no worker and no TLC remains.
P2 == [](mainAlive = FALSE => <>(~workerAlive /\ ~javaAlive))

\* P3: after main is dead, neither folder survives.
P3 == [](mainAlive = FALSE => <>(stage \in {"none", "removed"} /\ tmp \in {"none", "removed"}))

====
