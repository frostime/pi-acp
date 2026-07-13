---
title: Validation and debugging workflow
description: Defines focused regression tests, full verification commands, raw Pi RPC checks, and Zed/external-TUI acceptance scenarios.
scope:
  - /package.json
  - /scripts/**
  - /src/**
  - /test/**
updated: 2026-07-13
---

# Validation and debugging workflow

Use the narrowest focused test while iterating, then run the complete verification sequence before handoff. A passing unit suite does not replace a real Zed/Pi acceptance test for command advertisement and client timing.

## Standard verification

From the repository root:

```bash
npm install
npm run format
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Use `npm ci` instead of `npm install` in a clean environment when the lockfile is authoritative. Do not include `node_modules` or `.git` in distributable source archives.

## Test-to-risk map

| Change area                             | Focused tests                                                                                                                            | What they must prove                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pi command parsing and source retention | `test/unit/pi-commands.test.ts`, `test/unit/extension-command-advertising.test.ts`                                                       | supported envelopes, extension inclusion, descriptions, malformed input tolerance                   |
| Command advertisement and collisions    | `test/unit/extension-command-advertising.test.ts`, `test/unit/builtin-commands.test.ts`, `test/component/session-slash-commands.test.ts` | post-session update, extension-first priority, unchanged forwarding, file-prompt behavior           |
| Turn completion and event ordering      | `test/component/session-events.test.ts`                                                                                                  | pure extension completion, agent settlement, retry, prompt-response ordering, stale check isolation |
| Queue and cancellation                  | `test/component/session-queue-cancel.test.ts`, relevant cases in `session-events.test.ts`                                                | queued order, abort, cleared queue, no cross-turn completion                                        |
| Extension UI                            | extension UI cases in `test/component/session-events.test.ts`                                                                            | dialogs receive a response; fire-and-forget does not; unsupported text input cancels visibly        |
| Pi process/JSONL transport              | process and stdout-related unit tests plus `npm run smoke`                                                                               | no protocol contamination, process errors mapped, closed stdout does not crash                      |
| Session restore/load                    | `test/component/session-list-and-load.test.ts`, `test/unit/session-restore.test.ts`, `test/unit/startup-info-load-session.test.ts`       | restored subprocess and commands behave like a new session                                          |

Run one test file with Node's test runner, for example:

```bash
node --import tsx --test test/component/session-events.test.ts
```

Use `--test-name-pattern` to isolate a case when supported by the installed Node version.

## Raw Pi RPC investigation

Raw RPC isolates Pi behavior from ACP and Zed. Launch:

```bash
pi --mode rpc 2>pi-rpc.stderr.log
```

Send one JSON object per line. Typical probes:

```json
{"type":"get_commands"}
{"type":"get_state"}
{"type":"prompt","message":"/your-extension-command"}
```

Capture and inspect the full ordering of:

- command response objects;
- `agent_start`, `agent_end`, and `agent_settled`;
- `extension_ui_request` methods and IDs;
- `get_state` before, during, and after execution;
- the final prompt response relative to the extension handler's visible effects.

Rules:

- stdout is protocol data; do not add shell prefixes, debug output, or terminal escape sequences to it;
- stderr is the safe diagnostic stream;
- do not assume event order from timestamps shown by a terminal multiplexer—preserve the original line order;
- redact model content, paths, and secrets before attaching traces.

If an upstream field or sequence differs, follow [`upstream-compatibility.md`](upstream-compatibility.md) before adapting local code.

## Real acceptance matrix

For this fork, the critical path is:

```text
Zed → ACP stdio → pi-acp → Pi JSONL RPC → extension handler → optional external TUI
```

Run these scenarios after Pi, Zed, ACP SDK, command lifecycle, or external-TUI-related changes.

| Scenario                   | Expected result                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Command discovery          | A Pi extension command such as `/inspect` appears after both new session and restored session                           |
| Pure synchronous extension | Handler runs once; no agent event is required; Zed turn returns to idle                                                 |
| External TUI               | Zed remains running while the awaited terminal UI is open; closing/completing it ends the same turn                     |
| Extension starts LLM       | Agent output stays in the same turn; completion waits through retry/compaction until settled                            |
| Name collision             | Extension with a built-in or file-prompt name is advertised and executed by Pi, not intercepted locally                 |
| Notification               | `notify` is visible or safely degraded; Pi receives no unmatched UI response                                            |
| Stop/cancel                | Zed Stop aborts the active Pi work; queued prompts are cleared; external UI closes if its adapter receives cancellation |
| Two consecutive prompts    | A delayed state check from the first prompt cannot complete or corrupt the second                                       |
| Session restore            | Reloaded session republishes the extension command registry and executes commands with the same priority                |

The known non-contractual case is an extension handler that returns and later starts work from an unawaited timer. Record such a failure as an extension lifecycle violation unless Pi adds an explicit observable background-work primitive.

## Diagnosing by boundary

1. **Pi boundary** — Verify with raw RPC that `get_commands`, prompt response timing, events, and UI requests are correct.
2. **Adapter boundary** — Run focused tests or add trace logging to stderr. Confirm session ID, turn ID, command kind, and emitted ACP update order.
3. **ACP boundary** — Validate payloads against the SDK/schema; distinguish request responses from session notifications.
4. **Zed boundary** — Check Zed logs and current issues only after the previous boundaries are proven.
5. **External TUI boundary** — Confirm the extension awaits completion and propagates abort/close; the renderer must not write to either protocol stdout.

This ordering prevents compensating in pi-acp for an upstream or client-specific bug without evidence.

## Packaging checks

After a successful build:

```bash
npm pack --dry-run
```

Confirm the npm package contains the intended `dist` artifacts and excludes source-only secrets or local files. For a source archive, inspect its file list before delivery:

```bash
unzip -l path/to/archive.zip
```

A patch intended for the original fork baseline must be verified with `git apply --check` in a clean copy.

## Upgrade acceptance

A Pi upgrade is accepted only when:

- the semantic checkpoints in [`upstream-compatibility.md`](upstream-compatibility.md) have been reviewed;
- focused regression tests cover every changed assumption;
- the full verification sequence passes;
- the real acceptance matrix passes for the installed Pi and Zed versions, or any untested item is explicitly reported;
- affected documents have been updated without retaining stale historical behavior.
