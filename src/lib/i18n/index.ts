/**
 * i18n — lightweight translation layer for YardOS.
 *
 * Usage:
 *   const { t, lang, setLang } = useLang()
 *   t("nav.plan")              → "Planner" | "Planificador"
 *   t("planner.kpi.onShift", 4, 6) → "4 of 6 on shift" | "4 de 6 en turno"
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, createElement } from "react"
import { en } from "./en"
import { es } from "./es"

export type Lang = "en" | "es"

const DICTS: Record<Lang, Record<string, string>> = { en, es }

const LS_KEY = "yardos:lang"

/** Resolve {0}, {1} … placeholders */
function interpolate(template: string, args: (string | number)[]): string {
  return args.reduce<string>(
    (s, arg, i) => s.replaceAll(`{${i}}`, String(arg)),
    template
  )
}

/** Translate a key, with optional positional interpolation args */
export function translate(lang: Lang, key: string, ...args: (string | number)[]): string {
  const dict = DICTS[lang]
  const template = dict[key] ?? DICTS["en"][key] ?? key
  return args.length ? interpolate(template, args) : template
}

// ── Context ───────────────────────────────────────────────────────────────────

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => Promise<void>
  t: (key: string, ...args: (string | number)[]) => string
}

const LangContext = createContext<LangCtx>({
  lang: "en",
  setLang: async () => {},
  t: (key) => key,
})

export function useLang() {
  return useContext(LangContext)
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface Props { children: ReactNode }

export function LangProvider({ children }: Props) {
  // Initialise from localStorage for instant first paint — DB overrides after mount
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(LS_KEY)
    return saved === "es" ? "es" : "en"
  })

  // On mount, fetch from DB to ensure cross-browser sync
  useEffect(() => {
    fetch("/api/settings/language")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.value === "es" || data?.value === "en") {
          setLangState(data.value as Lang)
          localStorage.setItem(LS_KEY, data.value)
        }
      })
      .catch(() => {/* silently fall back to localStorage value */})
  }, [])

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l)
    localStorage.setItem(LS_KEY, l)
    // Persist to DB
    await fetch("/api/settings/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: l }),
    })
  }, [])

  const t = useCallback(
    (key: string, ...args: (string | number)[]) => translate(lang, key, ...args),
    [lang]
  )

  return createElement(LangContext.Provider, { value: { lang, setLang, t } }, children)
}
