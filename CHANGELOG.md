# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts with changes made by this fork after `upstream-main`; it does
not repeat the history of the [original project](https://github.com/svkozak/pi-acp).

## [Unreleased]

## [0.2.0] - 2026-07-14

### Added

- `PI_ACP_SESSION_UPDATE_MODE=legacy` restores the pre-coalescing stream-update
  behavior for diagnosis and A/B benchmarking.
- A session-update-pump benchmark compares the production `legacy` and
  `coalesced` modes under text, model-cadence, and Bash-output workloads.

### Changed

- Consecutive assistant, thought, and Bash-output deltas are coalesced before
  ACP delivery by default. Coalescing preserves content, FIFO barriers, terminal
  tool identity, and prompt-completion flushing while reducing notification and
  serialization work during bursts.

## [0.1.2] - 2026-07-14

### Added

- ACP `usage_update` notifications report context usage and cumulative cost
  after completed turns and model changes.

## [0.1.1] - 2026-07-14

### Fixed

- Pi `setTitle` and `session_info_changed` events update ACP session metadata,
  allowing clients to display current session titles.

## [0.1.0] - 2026-07-13

### Added

- Pi extension commands are discovered through RPC, advertised to ACP clients,
  and forwarded to Pi without being reimplemented by the adapter.

### Changed

- The fork is published as `@frostime/pi-acp` and distributed under
  GPL-3.0-or-later. The original MIT notice remains in
  [LICENSE-MIT](LICENSE-MIT).

### Fixed

- Pi extension commands take priority over colliding adapter-local commands and
  file prompts.
- Direct extension commands that do not start a model turn finish their ACP
  prompt instead of leaving the client waiting.
- Restored sessions republish extension-command discovery and retain the same
  dispatch behavior as new sessions.

[Unreleased]: https://github.com/frostime/pi-acp/compare/d273167...main
[0.2.0]: https://github.com/frostime/pi-acp/compare/6a42226...d273167
[0.1.2]: https://github.com/frostime/pi-acp/compare/4493355...6a42226
[0.1.1]: https://github.com/frostime/pi-acp/compare/b3b90fd...4493355
[0.1.0]: https://github.com/frostime/pi-acp/compare/upstream-main...b3b90fd
