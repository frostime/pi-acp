# pi-acp maintenance instructions

`pi-acp` is an Agent Client Protocol (ACP) adapter for Pi(`@earendil-works/pi-coding-agent`). It speaks ACP JSON-RPC over its own stdio and runs one `pi --mode rpc` subprocess per ACP session.

## Fork & upstream maintenance

This is the `frostime/pi-acp` fork of [`svkozak/pi-acp`](https://github.com/svkozak/pi-acp) (MIT), distributed under GPL-3.0-or-later. Original MIT license is preserved in `LICENSE-MIT`.

### Branch model

- `upstream-main` — pristine mirror of `upstream/main` (MIT), the upstream integration branch. **Never commit fork changes here.**
- `main` — the fork's primary branch (GPL-3.0-or-later). Carries fork metadata + features; integrates upstream updates from `upstream-main`.

`main` intentionally diverges from upstream, so GitHub "Sync fork" does not apply; apply upstream updates manually: `git fetch upstream` → ff-only merge `upstream/main` into `upstream-main` → merge `upstream-main` into `main` (resolve conflicts, keep GPL/fork content).

### Contributing back to upstream

Branch off pristine `upstream-main` and cherry-pick **only** the functional commits (no package name / license / fork doc changes) with cleaning of dirty part, so the PR stays MIT-clean.

## Read before changing code

Start with [`docs/index.md`](docs/index.md). Read the documents selected there rather than reconstructing cross-cutting behavior from scattered code.

Mandatory reading by change type:

- Slash-command discovery, dispatch, prompt completion, queueing, cancellation, or extension UI: [`src/acp/SPEC.md`](src/acp/SPEC.md).
- Pi, ACP SDK, or Zed compatibility work: [`docs/upstream-compatibility.md`](docs/upstream-compatibility.md).
- Testing, debugging, release checks, or upgrade verification: [`docs/validation.md`](docs/validation.md).

## Source-of-truth order

1. This repository's tests and types define the behavior currently implemented here.
2. [`src/acp/SPEC.md`](src/acp/SPEC.md) defines the maintenance contract that refactors must preserve.
3. Upstream protocol types and runtime code define current external behavior. Documentation is a navigation aid, not a substitute for checking implementation when compatibility changes.
4. README content is user-facing and must not override the contract or code.

If code and the SPEC disagree on externally observable behavior, compatibility, lifecycle, or invariants, stop and report the conflict before changing either one casually.

## ACP protocol verification

For ACP-facing changes, compare against the authoritative [ACP v1 schema](https://agentclientprotocol.com/protocol/v1/schema), not a client-specific behavior.

## Architecture boundaries

- `src/acp/*`: ACP-facing behavior and translation.
- `src/pi-rpc/*`: Pi subprocess and JSONL RPC transport.
- Pi owns agent/session logic; this adapter must not reimplement Pi command handlers.
- ACP stdout must remain strict protocol output. Never write diagnostic text, ANSI control sequences, or TUI rendering to stdout.
- External/custom TUI rendering is outside this package. This adapter only preserves the Pi command and prompt lifecycle that such an integration depends on.

## Change discipline

- Preserve command-source information until dispatch. A command's name alone is insufficient for collision handling.
- Do not infer prompt completion from a single Pi event without checking the lifecycle contract.
- Associate delayed checks and callbacks with the active turn ID; stale work must not finish a later queued turn.
- Treat extension UI dialogs and fire-and-forget notifications as different protocols.
- Prefer tolerant parsing at upstream JSON boundaries and strict internal types after normalization.
- Use local comments only for sequencing, compatibility, or rationale that is not obvious from the code.
- Do not commit unless explicitly asked.

## Validation

After code changes, run the applicable focused tests, then the full sequence documented in [`docs/validation.md`](docs/validation.md). At minimum before handoff:

```bash
npm run format
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

When a Pi update is involved, the normal test suite is not sufficient. Run the compatibility checkpoints and end-to-end scenarios in the validation guide.
