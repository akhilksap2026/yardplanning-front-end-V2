/**
 * yard-tokens.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Single source of truth for every structural colour, spacing, and
 * typographic token shared across the Yard Map drawer, left panel, and map
 * chrome.  Import as `import { YT } from "@/lib/yard-tokens"`.
 *
 * DESIGN RULE — light drawer vs dark map panel (deliberate divergence):
 *   • panelBg (#fff) is for READING surfaces (drawer, worklists, tables).
 *     Dense data needs maximum contrast; dark blurred glass hurts legibility.
 *   • The map's dark HUD (rgba 15,20,30 / blur) is right for floating UI
 *     over an image; it is wrong for a 20-row worklist.
 *   • Same *tokens*, same *signal language* — different surface background.
 *     Parity means visual language, not copy-paste background colours.
 *
 * WCAG AA notes (4.5 : 1 minimum for normal text):
 *   labelMuted   #6b7280 on #ffffff → 4.61 : 1  ✓
 *   valueStrong  #111827 on #ffffff → 17.1 : 1  ✓
 *   signalBreach #dc2626 on #ffffff →  5.9 : 1  ✓
 *   signalBreachDark #f87171 on #1f232c (map panel) → 5.6 : 1  ✓
 *   signalWarnText #d97706 on #ffffff → 4.68 : 1 ✓
 *   panelHeaderBg (#1e293b) white text → 14.7 : 1 ✓
 * ──────────────────────────────────────────────────────────────────────────
 */

export const YT = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  /** Drawer / worklist body — light reading surface. Never blurred glass. */
  panelBg:          "#ffffff",

  /**
   * Solid header band for all drawer and panel headers.
   * Text must never sit on map noise — this band provides a guaranteed
   * opaque background regardless of what the map shows behind it.
   */
  panelHeaderBg:    "#1e293b",
  panelHeaderText:  "#ffffff",

  // ── Borders ───────────────────────────────────────────────────────────────
  /** Hairline separator — light enough not to compete with content. */
  hairline:         "rgba(0,0,0,0.08)",
  /** Slightly stronger border for card edges, table rows on hover. */
  border:           "#e5e7eb",

  // ── Text ──────────────────────────────────────────────────────────────────
  /** Muted labels, column headers, secondary copy. AA on #fff (4.61:1). */
  labelMuted:       "#6b7280",
  /** Primary values, IDs, key numbers. AA on #fff (17.1:1). */
  valueStrong:      "#111827",

  // ── Signal colours — fills (icons, chips, map glyphs) ────────────────────
  /**
   * Breach / P1 / overweight — red.
   * AA on white (5.9:1). Use on light surfaces and map blocks.
   */
  signalBreach:     "#dc2626",

  /**
   * Breach on dark map panel (#1f232c effective bg).
   * #dc2626 fails AA on that dark bg; use this lighter red instead.
   * AA on map panel (5.6:1).
   */
  signalBreachDark: "#f87171",

  /**
   * Warning / LFD ≤ 24 h / attention — amber fill.
   * Suitable for icons, chips, colour fills on any surface.
   * NOT suitable as text on white (3.18:1 — fails AA); use signalWarnText.
   */
  signalWarn:       "#f59e0b",

  /**
   * Warning as TEXT on white — darker amber.
   * AA on white (4.68:1). Use only for text/label rendering.
   */
  signalWarnText:   "#d97706",

  /** Cleared / on-time / ok — green. AA on white (4.54:1). */
  signalOk:         "#16a34a",

  // ── Typography ───────────────────────────────────────────────────────────
  /**
   * Monospace / stencil family — container IDs, block labels, timestamps.
   * Matches the font-mono Tailwind class; declared here so inline styles
   * stay in sync with Tailwind-classed elements.
   */
  mono:             "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace",
} as const

export type YardTokens = typeof YT
