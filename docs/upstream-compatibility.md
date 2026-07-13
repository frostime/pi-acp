---
title: Upstream compatibility guide
description: Locates the Pi, ACP, and Zed sources that define pi-acp behavior and provides a repeatable workflow for investigating upstream changes.
scope:
  - /package.json
  - /src/acp/**
  - /src/pi-rpc/**
  - /test/**
updated: 2026-07-13
---

# Upstream compatibility guide

Use this guide when Pi behaves differently after an update, an RPC event or response shape changes, Zed stops showing commands, or the ACP SDK is upgraded.

## Authority map

Check runtime code as well as prose documentation. Protocol documents describe the intended interface; implementation code determines the exact sequencing used by an installed release.

### Pi Coding Agent

Repository root: [earendil-works/pi](https://github.com/earendil-works/pi). Older links under `badlogic/pi-mono` may redirect, but new references should use the current repository.

| Question                                                        | Start here                                                                                                              | Then inspect                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| RPC commands, events, state fields, and extension UI categories | [`packages/coding-agent/docs/rpc.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) | `packages/coding-agent/src/modes/rpc/rpc-types.ts`                                          |
| Exact request dispatch and response timing in `--mode rpc`      | `packages/coding-agent/src/modes/rpc/rpc-mode.ts`                                                                       | Search for the request type: `prompt`, `get_commands`, `get_state`, `extension_ui_response` |
| Direct extension command execution and agent lifecycle          | `packages/coding-agent/src/core/agent-session.ts`                                                                       | Search for `prompt`, `tryExecuteExtensionCommand`, `_runAgentPrompt`, `agent_settled`       |
| Extension command registry, duplicate names, and lookup         | `packages/coding-agent/src/core/extensions/runner.ts`                                                                   | Search for `getRegisteredCommands` and `getCommand`                                         |
| Extension API and `ctx.ui` contracts                            | `packages/coding-agent/src/core/extensions/types.ts`                                                                    | Search for `ExtensionUIContext`, `custom`, and command handler types                        |
| Current integration examples                                    | `packages/coding-agent/examples/rpc-extension-ui.ts` and `packages/coding-agent/examples/extensions/rpc-demo.ts`        | Run or adapt the examples against the installed Pi version                                  |
| Release-level behavior changes                                  | `packages/coding-agent/CHANGELOG.md`                                                                                    | Confirm every relevant changelog statement in types/runtime code                            |

Repository paths can move. If a path no longer exists, search from the repository root for the symbol or RPC message name rather than assuming the feature was removed.

For a local reference checkout:

```bash
git clone --depth 1 https://github.com/earendil-works/pi.git ../pi-upstream
cd ../pi-upstream
rg -n 'get_commands|agent_settled|extension_ui_request' packages/coding-agent
```

Refresh or recreate this checkout before investigating a new release. Do not copy upstream code into this repository merely to make it searchable.

### Agent Client Protocol

- [Slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands): command advertisement and dynamic updates.
- [Schema](https://agentclientprotocol.com/protocol/v1/schema): `AvailableCommand`, session updates, permissions, and stop reasons.
- [Prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn): request/update/final-response lifecycle.
- [`@agentclientprotocol/sdk`](https://github.com/agentclientprotocol/typescript-sdk): generated/current TypeScript behavior used by this project.

When upgrading the SDK, compare protocol schema changes and compile errors before adapting behavior. A newly available TypeScript field does not imply Zed already renders or supports it.

### Zed

- [Zed repository](https://github.com/zed-industries/zed)
- [External agents documentation](https://zed.dev/docs/agents/external-agents/)
- Search current Zed issues for `ACP`, `available_commands_update`, `slash command`, `permission`, and the relevant protocol method.

Zed is the primary client for this fork, but client behavior must not be mistaken for ACP protocol semantics. Diagnose in this order:

1. confirm Pi emitted the expected RPC data;
2. confirm pi-acp emitted valid ACP in the correct session and order;
3. then inspect Zed handling and current issues.

## Semantic checkpoints for a Pi update

Review each checkpoint whenever the installed Pi package changes materially.

| Checkpoint                  | Current adapter assumption                                                                                        | Local dependency                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `get_commands` envelope     | Commands may be top-level or under `data`; malformed non-object entries and unknown metadata are tolerated        | `/src/acp/pi-commands.ts`                     |
| Command source              | Extension ownership is identified by `source === "extension"`                                                     | command priority and turn classification      |
| Command ordering/duplicates | Pi returns multiple source types; local first-wins merge gives extension commands priority over adapter built-ins | `/src/acp/agent.ts → mergeCommands()`         |
| Direct extension execution  | Pi awaits the extension handler before the direct command's RPC prompt response returns                           | external TUI and pure-extension completion    |
| Normal prompt response      | The RPC response is not the final agent completion signal                                                         | turn state machine                            |
| Agent finality              | `agent_settled` is stronger than `agent_end`; retrying `agent_end` is not final                                   | `/src/acp/session.ts`                         |
| Busy state                  | `isStreaming`, `isCompacting`, and `pendingMessageCount` indicate observable pending work                         | idle reconciliation                           |
| Extension failures          | Command handler failures may arrive as `extension_error` while the RPC prompt response still succeeds             | visible failure reporting and internal result |
| UI response classes         | Dialog methods require responses; fire-and-forget methods do not                                                  | extension UI router                           |
| UI timeout/cancellation     | Pi may resolve timed dialogs and abort work independently of the ACP client's UI                                  | cancellation and late-response handling       |
| Event/request correlation   | Events do not necessarily carry an ACP turn ID                                                                    | local monotonically increasing turn ID guards |

Any failed checkpoint requires code and regression-test changes in the same changeset. Update [`../src/acp/SPEC.md`](../src/acp/SPEC.md) only if the intended compatibility contract changes; otherwise update the implementation to preserve it.

## Upgrade workflow

1. **Record versions before reproducing**

   ```bash
   pi --version
   node --version
   npm ls @agentclientprotocol/sdk
   npm view @earendil-works/pi-coding-agent version
   ```

   Also record whether Zed is stable, preview, or a specific build.

2. **Reproduce outside Zed when possible**

   Run Pi in RPC mode and exercise the smallest relevant request. Preserve stderr separately; stdout is JSONL protocol data.

3. **Compare upstream release notes and code**

   Inspect Pi's coding-agent changelog, protocol types, RPC dispatcher, and the core implementation behind the affected request. Do not stop after finding a matching documentation paragraph.

4. **Trace the local dependency**

   Use the authority table and symptom map below to locate the adapter assumption. Check [`../src/acp/SPEC.md`](../src/acp/SPEC.md) before changing sequencing or compatibility behavior.

5. **Add a regression that fails under the old assumption**

   Prefer a fake RPC process test for event ordering and response shape. Use a real-client acceptance test when the problem depends on Zed timing or rendering.

6. **Run the full validation sequence and acceptance matrix**

   Follow [`validation.md`](validation.md), including the Pi-version-specific scenarios.

7. **Update documentation in the same change**

   Bump the `updated` field only in documents whose meaningful content changed. Do not add a changelog section; git retains history.

## Symptom-to-source map

| Symptom                                          | First local checks                                                                       | Upstream inspection                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Extension command missing in Zed                 | command update emitted after session exists; `includeExtensionCommands`; parsed `source` | Pi `get_commands` in `rpc-mode.ts`, ACP slash-command update schema, Zed ACP command handling/issues |
| Command appears but adapter built-in runs        | cached source registry and collision tests                                               | Pi extension registry duplicate-name behavior in `runner.ts`                                         |
| `/command` is expanded as a file prompt          | turn classification before `expandSlashCommand()`                                        | Pi command source/name returned by `get_commands`                                                    |
| Pure extension command never finishes            | RPC prompt response observed; idle reconciliation runs; state fields parsed              | `agent-session.ts` direct handler path and `rpc-mode.ts` prompt response timing                      |
| Extension command finishes before its TUI closes | handler actually awaits the TUI; prompt response is not synthesized early                | extension handler implementation and Pi direct-command await path                                    |
| LLM result arrives after ACP turn closed         | `agent_start`, `agent_end`, `agent_settled`, and prompt response ordering                | Pi agent events and any new continuation/retry events                                                |
| Turn never settles after retry/compaction        | `willRetry`, busy state, settlement event                                                | Pi RPC event types and `agent_settled` implementation                                                |
| Notifications cause unmatched-response errors    | fire-and-forget classification                                                           | Pi `ExtensionUIContext` types and RPC UI dispatcher                                                  |
| Dialog remains after timeout/cancel              | pending permission/request cleanup; late response                                        | Pi timeout behavior, ACP cancellation support, Zed permission UI behavior                            |
| Raw RPC parsing breaks                           | stdout contamination, envelope/type changes                                              | Pi RPC types and JSONL transport implementation                                                      |

## Compatibility red lines

- Never print logs, ANSI frames, or user-facing diagnostics to stdout while running as an ACP agent or Pi RPC process.
- Never treat a repository README or changelog as sufficient evidence for event ordering.
- Never replace bounded lifecycle checks with an arbitrary long sleep to support unawaited future work.
- Never send `extension_ui_response` to a method that upstream defines as fire-and-forget.
- Never assume a Zed UI limitation is an ACP protocol prohibition without checking the schema and another client or raw protocol trace.
