/**
 * server/planner/narrate.ts — LLM plan narration (Task #8).
 *
 * Builds a compact JSON summary of a solver result and calls GPT-4o-mini to
 * produce a plain-English shift-plan explanation for yard managers.
 *
 * Safety contract:
 *  - If OPENAI_API_KEY is not set, returns null (graceful skip).
 *  - Narration failures never throw — callers receive null and continue.
 *  - The key is read from process.env; it is never logged or exposed.
 */
import OpenAI from 'openai'

// ── Input shape ───────────────────────────────────────────────────────────────

export interface NarrationInput {
  plan_id:         number
  plan_date:       string
  strategy:        string
  solve_seconds:   number
  total_moves:     number
  unplaced_count:  number
  move_breakdown:  Record<string, number>   // reason → count
  jockey_summary:  { name: string; certs: string[]; move_count: number }[]
  top_moves:       { container_id: string; reason: string; start_min: number; duration_min: number }[]
  unplaced:        { container_id: string; reason: string }[]
}

// ── OpenAI client (lazy, gated on key presence) ────────────────────────────

function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  return new OpenAI({ apiKey: key })
}

// ── Prompt builder (≈ 600–900 tokens) ─────────────────────────────────────

function buildPrompt(input: NarrationInput): string {
  // Limit top moves to 5 to stay within budget
  const topSlice = input.top_moves.slice(0, 5)

  const summary = {
    plan_date:      input.plan_date,
    strategy:       input.strategy,
    solve_seconds:  input.solve_seconds,
    total_moves:    input.total_moves,
    unplaced_count: input.unplaced_count,
    move_breakdown: input.move_breakdown,
    jockey_assignments: input.jockey_summary.map(j => ({
      operator:   j.name,
      certs:      j.certs.length ? j.certs.join(', ') : 'standard',
      moves_assigned: j.move_count,
    })),
    first_5_priority_moves: topSlice.map(m => ({
      container: m.container_id,
      type:      m.reason.replace(/_/g, ' '),
      starts_at_shift_minute: Math.round(m.start_min),
      duration_min: Math.round(m.duration_min),
    })),
    unplaced_containers: input.unplaced.slice(0, 10).map(u => ({
      container: u.container_id,
      reason:    u.reason.replace(/_/g, ' '),
    })),
  }

  return JSON.stringify(summary, null, 2)
}

// ── Main narration function ────────────────────────────────────────────────

/**
 * Narrate a shift plan in plain English.
 * Returns null if the OpenAI key is absent or if the API call fails.
 */
export async function narratePlan(input: NarrationInput): Promise<string | null> {
  const client = getClient()
  if (!client) {
    console.log('[narrate] OPENAI_API_KEY not set — skipping narration')
    return null
  }

  const promptText = buildPrompt(input)

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 350,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You are a yard operations assistant at a container terminal. ' +
            'Given a JSON summary of a shift plan produced by the planning engine, ' +
            'write a concise plain-English narration (3–5 sentences) for the yard manager. ' +
            'Explain what the plan does, which containers are prioritised and why, how operators ' +
            'are distributed, and flag any unplaced containers or notable constraints. ' +
            'Use clear operational language. Do not use bullet points or headings. ' +
            'Do not repeat raw numbers from the JSON verbatim — interpret them.',
        },
        {
          role: 'user',
          content: promptText,
        },
      ],
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? null
    console.log(`[narrate] plan #${input.plan_id} narrated (${text?.length ?? 0} chars)`)
    return text
  } catch (err) {
    console.error('[narrate] OpenAI call failed:', err)
    return null
  }
}
