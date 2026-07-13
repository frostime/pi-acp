---
title: Developer documentation index
description: Routes maintainers and coding agents to the smallest document needed for a pi-acp change or investigation.
scope:
  - /AGENTS.md
  - /README.md
  - /docs/**
  - /src/acp/**
updated: 2026-07-13
---

# Developer documentation index

Read only the documents relevant to the current task:

- [`../src/acp/SPEC.md`](../src/acp/SPEC.md) — Read before modifying slash-command discovery or priority, prompt/turn completion, queueing, cancellation, or Pi extension UI handling. It defines the behavior and invariants a change must preserve.
- [`upstream-compatibility.md`](upstream-compatibility.md) — Read when Pi, ACP, the SDK, or Zed changes; when behavior differs by installed version; or when locating the upstream implementation behind an RPC field or event.
- [`validation.md`](validation.md) — Read when implementing, reviewing, debugging, packaging, or upgrading. It maps risks to focused tests and defines the real Zed → pi-acp → Pi acceptance matrix.

User installation and feature documentation remains in [`../README.md`](../README.md). Do not place maintenance contracts or upgrade diagnostics there.
