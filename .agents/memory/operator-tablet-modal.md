---
name: Operator Tablet modal
description: How the Operator Tablet is surfaced as a sidebar popup button rather than a nav screen, and the inModal prop pattern used to strip desktop chrome.
---

## Rule
The Operator Tablet is NOT a nav item. It is an amber launch button pinned above the user row in the sidebar. Clicking it opens a full-screen fixed overlay that centers the phone frame.

**Why:** The 340×680 phone frame is always self-contained; it doesn't need the full main content area. Moving it to a popup keeps the main workspace uninterrupted and communicates the device-bound nature of the tablet role.

## How to apply
- `src/App.tsx` — `operatorOpen` boolean state; button in sidebar; `{operatorOpen && <div fixed overlay>…<OperatorTablet inModal />…</div>}`; "operator" removed from `NAV_ITEMS`
- `src/screens/OperatorTablet.tsx` — `inModal?: boolean` prop (default false); `shell()` helper inside the component wraps each early-return phone div (returns phone bare when `inModal`, full desktop shell otherwise); main wizard outer wrapper uses `className={inModal ? "contents" : "flex flex-col h-full…"}` + `{!inModal && <toolbar>}` to strip chrome without duplicating 700 lines of phone content.

## Key details
- `display: contents` on the outer wrappers makes them layout-transparent — the fixed-size phone div becomes the only visible element the modal's flex centering sees.
- The hidden right-panel div (`className="hidden"`) is left as-is in modal mode; it's already `display:none` so it doesn't affect layout.
- TSC passes clean (zero errors) after this change.
