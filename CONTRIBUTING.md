# Contributing

Thanks for helping. The rules are short: nothing merges unless CI is green and a maintainer other than
the author has reviewed it.

## Set up

```sh
git clone https://github.com/<you>/tlachart   # your fork
cd tlachart
bun install --frozen-lockfile
export TLA2TOOLS=$HOME/.local/share/tla/tla2tools.jar   # TLC 1.7.4; Java 11+ on PATH
```

Requirements are in the [README](README.md#requirements).

## Flow

1. Open an issue first for anything bigger than a typo, so we agree on the change before you build it.
2. Fork the repository and branch from `main`: `fix/short-name` or `feat/short-name`.
3. Make the change, with tests (below).
4. Run the checks locally (below). Push to your fork and open a pull request against `main`.
5. A maintainer reviews. Answer comments with new commits; do not force-push over a review in progress.
6. A maintainer merges when CI is green and the review is approved.

Nobody pushes to `main` directly, and nobody merges their own pull request unless they are the only
maintainer (see Maintainers).

## Before you open a pull request

All of these must pass; CI runs the same commands:

| Command                                      | What it checks                                         |
| -------------------------------------------- | ------------------------------------------------------ |
| `bun run check`                              | types, ESLint with TSDoc, Prettier                     |
| `bun run test`                               | the full suite (set `TLA2TOOLS`, or formal tests skip) |
| `bun run model` and `bun run model:variants` | the formal model, when you change the files it covers  |

Run `bun run format` to fix formatting.

## What a good change looks like

- **Tests first.** A bug fix starts with a test that fails, then the fix. A feature comes with tests
  for its behavior. Never weaken, skip or loosen a test to get green; fix the cause.
- **Output stays the same.** The 33 specs in `test/corpus` pin the chart and report byte for byte. A
  change that alters their output must say why in the pull request, and the new output must be
  better, not just different.
- **Formal model.** If you change `src/cli/main.ts`, `src/cli/check-worker.ts` or
  `src/tlc/process.ts`, re-run the model and keep `formal/coverage.md` in sync. A change that breaks a
  promise there (whole result or nothing, no process left behind, no folders left) needs the model
  updated first.
- **Small and focused.** One change per pull request, one commit per step, conventional messages
  (`fix:`, `feat:`, `docs:`, `test:`, `chore:`).
- **No new dependencies** without discussing it in the issue first. The package has no runtime
  dependencies; keep it that way unless there is a strong reason.
- **Style.** Prettier with tabs, comments that say why in one line, TSDoc on exports. Match the code
  around you. Layering is pinned by `test/architecture.test.ts`.
- **Docs.** User-visible behavior changes update the README in the same pull request.

## Pull request checklist

- [ ] Linked issue, or a one-line reason this needs none
- [ ] `bun run check` and `bun run test` pass locally
- [ ] Tests added or changed for the behavior
- [ ] Corpus output unchanged, or the change explained
- [ ] README and `formal/coverage.md` updated when needed

## Reviewing

Reviewers check, in this order: does it do what the issue says, is there a test that would have
caught the bug, does the corpus output change, is anything weaker than before. CI passing is
necessary, not sufficient.

## Maintainers

`@nchandar` owns the project. [`CODEOWNERS`](.github/CODEOWNERS) requests a review on every pull
request. While there is a single maintainer, the maintainer's own changes go through a pull request
with CI green and may be merged without a second reviewer; every contribution from anyone else needs
the maintainer's approval. When a second maintainer joins, the maintainer's changes need their
review too.

## Licence

By contributing you agree your work is released under the [MIT licence](LICENSE).
