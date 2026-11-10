// Names each model state in the code's words, so the chart reads like the command.
export const title = "OutFolder: a SIGKILL before the janitor exists";
export const state = (v) => `${v.mainPc} / ${v.workerPc} / ${v.janitorState}`;
export const step = (action) => action;
