import { useState, useRef } from "react"

export function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  function show() {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
  }

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", marginLeft: 5, verticalAlign: "middle" }}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      <span ref={ref} style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: "50%",
        fontSize: 9, fontWeight: 700, lineHeight: 1,
        background: "var(--ds-border)", color: "var(--text-muted)",
        cursor: "default", userSelect: "none", flexShrink: 0,
      }}>?</span>

      {pos && (
        <span style={{
          position: "fixed",
          left: pos.x,
          top: pos.y - 6,
          transform: "translate(-50%, -100%)",
          zIndex: 9999,
          width: 210,
          background: "#1e293b",
          color: "#f1f5f9",
          fontSize: 11.5,
          lineHeight: 1.5,
          padding: "7px 10px",
          borderRadius: 8,
          boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
          pointerEvents: "none",
          whiteSpace: "normal",
          textAlign: "left",
          fontWeight: 400,
        }}>
          {text}
          <span style={{
            position: "absolute",
            top: "100%", left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid #1e293b",
          }} />
        </span>
      )}
    </span>
  )
}
