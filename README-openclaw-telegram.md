# OpenClaw Telegram Formatter (Port)

This folder contains a self-contained port of OpenClaw's Telegram formatter and a lightweight sender.

## Source snapshot

Raw OpenClaw files downloaded into `tmp/openclaw-telegram/`:

- `tmp/openclaw-telegram/format.ts`
- `tmp/openclaw-telegram/send.ts`

Source repo: https://github.com/openclaw/openclaw

## Entry points (markdown/text -> Telegram HTML)

- `markdownToTelegramHtml` in `telegram-format.ts`
- `renderTelegramHtmlText` in `telegram-format.ts` (selects `markdown` vs `html` mode)

## parse_mode="HTML"

`telegram-send.ts` uses `parse_mode: "HTML"` when sending HTML chunks via the Bot API.

## HTML parse fallback

If Telegram returns a parse error (`can't parse entities` / `parse entities` / `find end of the entity`),
`telegram-send.ts` retries the same chunk as plain text (no `parse_mode`).

## What was adapted

- `telegram-format.ts`
  - Inlined the markdown IR + render pipeline from OpenClaw (`src/markdown/ir.ts` and `src/markdown/render.ts`).
  - Inlined chunking helpers (`src/shared/text-chunking.ts` + minimal `chunkText`).
  - Removed OpenClaw-specific imports and kept the Telegram-specific HTML rules.
- `telegram-send.ts`
  - Replaced OpenClaw/grammY dependencies with a direct `fetch` call to Telegram Bot API.
  - Preserved HTML parse fallback behavior.
  - Preserved HTML-safe chunking behavior using `splitTelegramHtmlChunks`.

## External dependencies

- `markdown-it` (required by `telegram-format.ts`)
- `fetch` global (Node 18+ or a polyfill)

## Files created in this project

- `telegram-format.ts` (self-contained formatter)
- `telegram-send.ts` (self-contained sender)
- `README-openclaw-telegram.md` (this file)
