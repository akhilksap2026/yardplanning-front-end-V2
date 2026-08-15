---
name: i18n architecture
description: Lightweight EN/ES translation layer — LangContext, useLang hook, DB persistence, key naming conventions
---

## Pattern
- `src/lib/i18n/en.ts` + `src/lib/i18n/es.ts` — flat Record<string, string> dictionaries; every key in en.ts must exist in es.ts
- `src/lib/i18n/index.ts` — exports `LangProvider`, `useLang()`, `translate()`, `Lang` type
- `LangProvider` wraps the app in `src/main.tsx` (outside DataProvider)
- `useLang()` returns `{ lang, setLang, t }` — use `t("key", ...args)` for interpolation with `{0}`, `{1}` placeholders
- Language default: `"en"`. Persisted to DB (`settings` table, key `"language"`) and `localStorage` key `"yardos:lang"` for instant first paint

## DB
- Table: `settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, note TEXT)`
- API endpoints in `server/app.ts`: `GET /api/settings/:k` → `{k, value, note}`, `PATCH /api/settings/:k` body `{value}` → `{k, value}`
- Seeded with `('language', 'en', ...)` in schema migration

## Key naming conventions
- `app.*` — chrome (title, nav, topbar buttons)
- `nav.*` — nav group keys and item keys
- `persona.*` — persona names and subtitles
- `planner.*`, `yard.*`, `gate.*`, `tower.*`, `operator.*` — screen-specific keys
- `settings.*` — settings screen
- `common.*` — shared labels (cancel, confirm, loading, etc.)
- `state.*` — move states (PLANNED, ASSIGNED, etc.)
- `gateStatus.*` — visit lifecycle states
- `lang.*`, `settings.lang.*` — language picker UI

## Applied screens
All 6 screens + App chrome translated: NightPlanner, YardMap, GateConsole, ControlTower, OperatorTablet, Settings

## Topbar toggle
`EN | ES` pill in topbar — calls `setLang()` from `useLang()`. The `setLang` must be destructured from `useLang()` (not imported separately).

**Why:** Arrow symbols in translation values (e.g. `"app.refresh": "↻ Refresh"`) — do NOT add `↻` in JSX template; the key already includes it. `app.syncing` (no arrow) vs `app.syncing_btn` (has arrow) — use the right one depending on context.
