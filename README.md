# @frostime/pi-acp

Personal-use fork of [svkozak/pi-acp](https://github.com/svkozak/pi-acp), an [Agent Client Protocol](https://agentclientprotocol.com/overview/introduction) (ACP) adapter for the [Pi](https://github.com/earendil-works/pi) coding agent.

`pi-acp` speaks ACP JSON-RPC over stdio to a client such as [Zed](https://zed.dev), and runs one `pi --mode rpc` subprocess for each ACP session.

The original project remains the reference for the adapter's general feature set, supported ACP clients, authentication, and known limitations. Use [its README](https://github.com/svkozak/pi-acp#readme) for that material. This README documents the fork-specific choices needed to run and maintain this package.

## What differs from upstream

`main` deliberately diverges from the original project. It currently adds:

| Area                      | Change in this fork                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi extension commands     | Discovers and advertises commands registered by Pi extensions, forwards them to Pi unchanged, and gives them priority when names collide with local commands. Completion is reconciled so commands that do not start a model turn do not leave the ACP client waiting.                                                          |
| Session metadata          | Bridges Pi `setTitle` and `session_info_changed` events to ACP `session_info_update`, so clients can display updated session titles.                                                                                                                                                                                            |
| Usage reporting           | Emits ACP usage updates after a turn and after a model change.                                                                                                                                                                                                                                                                  |
| Streaming updates         | Coalesces consecutive assistant, thought, and Bash-output deltas before sending ACP notifications. This reduces notification, serialization, and client-rendering work during bursts while preserving content and ordering. It is a targeted adapter optimization, not a claim that all Pi or Zed CPU and memory use will fall. |
| Packaging and maintenance | Publishes as `@frostime/pi-acp`, is distributed under GPL-3.0-or-later, and includes fork-specific maintenance and compatibility documentation.                                                                                                                                                                                 |

The fork is maintained for local use. If none of these differences are needed, prefer the [original project](https://github.com/svkozak/pi-acp).

## Zed quick start

Install and configure Pi first. The `pi` executable must be available on `PATH`; Pi owns model-provider and API-key configuration.

Add this server entry to Zed's `settings.json`:

```json
{
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "@frostime/pi-acp"],
      "env": {}
    }
  }
}
```

`npx` always resolves the current published package. To use a pinned or local build instead, replace `command` and `args` with either `pi-acp` after a global install, or `node` and the absolute path to `dist/index.js` after `npm install && npm run build`.

The ACP Registry entry named `pi ACP` points to the upstream package, not this fork. Use one of the configurations above when the fork behavior is required.

## Fork configuration

Set these values in the server's `env` object when needed:

| Variable                         | Default         | Effect                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI_ACP_ENABLE_EMBEDDED_CONTEXT` | unset (`false`) | Advertises ACP embedded-context support. When disabled, supplied resources are converted to plain-text prompt context.                                                                                                                                                          |
| `PI_ACP_SESSION_UPDATE_MODE`     | `coalesced`     | Controls the session update pump. `coalesced` batches compatible stream deltas for at most 25 ms or 8 KiB. `legacy` sends each delta separately, matching the pre-optimization behavior for diagnosis and A/B comparison. Any other value prevents the ACP agent from starting. |

Use `legacy` only to establish a comparison baseline. Keep the default `coalesced` mode for ordinary use.

## Pi commands and authentication

Pi skills, file prompts, and extension commands are loaded by Pi and become available in ACP sessions. This fork additionally preserves the Pi extension-command lifecycle described above. For Pi command conventions, ACP terminal authentication, and the broader adapter behavior, see the [upstream README](https://github.com/svkozak/pi-acp#readme).

To launch Pi's interactive login in a terminal:

```bash
pi-acp --terminal-login
```

## Maintenance

The repository's maintenance map starts at [`docs/index.md`](docs/index.md). It links the ACP lifecycle contract, upstream compatibility notes, and validation guide. `upstream-main` is a pristine mirror of the original project's `main`; this fork's `main` is intentionally separate.

## License

This combined work is distributed under [GPL-3.0-or-later](LICENSE). It is derived from [svkozak/pi-acp](https://github.com/svkozak/pi-acp), originally MIT © 2025 Sergii Kozak; the original notice and license remain in [LICENSE-MIT](LICENSE-MIT).
