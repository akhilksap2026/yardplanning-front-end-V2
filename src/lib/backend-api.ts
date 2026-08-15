/**
 * Backend API client — typed wrappers for the YardOS Express API.
 * This file is the ONLY place that talks to the backend.
 * Every function returns a Promise. If the backend is unreachable,
 * the caller (DataContext) falls back to seed data — this file never
 * catches errors silently.
 *
 * NOTE: All routes are public within this deployment (loopback-only API,
 * no external port mapping). No authentication headers are needed.
 */

const API_BASE = "/api"; // proxied via vite.config.ts in dev; same-origin in prod

// ── Base request helper ───────────────────────────────────────────────
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail: unknown;
    try { detail = JSON.parse(text)?.detail; } catch { /* not JSON */ }
    throw new Error(typeof detail === "string" ? detail : `API ${res.status} ${path}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Types (mirror the Express API schema) ───────────────────────────

// Gate container row enriched by the live DB join
export interface LiveGateRow {
  containerId:     string
  type:            "inbound" | "outbound"
  scac:            string        // shipping-line BIC/SCAC
  size:            string
  consignee:       string
  carrierName:     string
  truckerScac:     string
  trucker:         string
  truckerFullName: string | null
  truckerRegion:   string | null
  driver:          string
  plate:           string
  channel:         "verde" | "naranja" | "rojo"
  appt:            string
  gateStatus:      string
  hoursToLFD:      number
  hold:            string | null
  excl:            string | null
  grossKg:         number
  isoType:         string
  sealNumber:      string
  updatedAt:       string
  freeDays:        number | null       // from carriers table
  detentionBasis:  string | null       // from carriers table
}

export type ContainerStatus = "in_transit" | "yard" | "staged" | "departed";
export type DamageStatus = "none" | "minor" | "major" | "hold";
export type OrderType = "inbound_full" | "outbound_empty_to_port" | "outbound_full_to_dc" | "outbound_empty_for_pickup";
export type JockeyStatus = "available" | "busy" | "on_break" | "off_shift";
export type PlanStatus = "draft" | "confirmed" | "in_progress" | "superseded";
export type MoveStatus = "planned" | "in_progress" | "done" | "cancelled";
export type MoveReason = "inbound_placement" | "outbound_staging" | "shuffle" | "re_marshal" | "replan_reassignment";
export type DisruptionType = "truck_accident" | "ship_delay" | "inspection_hold" | "out_of_sequence_arrival" | "jockey_unavailable";
export type SolveStrategy = "cp_sat" | "greedy";

export interface BackendYardSlot {
  id: number; yard_id: number; block: string; bay: number; row: number; tier: number;
  is_hazmat_approved: boolean; is_reefer_capable: boolean; occupied_container_id: number | null;
}
export interface BackendYard { id: number; name: string; rows: number; bays_per_row: number; max_tier: number; }
export interface BackendYardState { yard: BackendYard; slots: BackendYardSlot[]; }
export interface BackendOrder {
  id: number; origin: string; destination: string; eta: string; priority: number;
  order_type: OrderType; customer_name: string;
}
export interface BackendContainer {
  id: number; container_number: string; order_id: number | null; size_ft: number;
  status: ContainerStatus; is_hazmat: boolean; hazmat_class: string | null;
  damage_status: DamageStatus; detention_expiry: string | null; current_slot_id: number | null;
}
export interface BackendContainerDetail extends BackendContainer {
  order?: BackendOrder | null; current_slot?: BackendYardSlot | null;
}
export interface BackendJockey {
  id: number; name: string; speed_factor: number; status: JockeyStatus; restrictions: string[];
}
export interface BackendMove {
  id: number; plan_id: number; container_id: number; jockey_id: number | null;
  from_slot_id: number | null; to_slot_id: number; sequence_number: number;
  estimated_duration_min: number; status: MoveStatus; reason: MoveReason; scanned_confirmed: boolean;
}
export interface BackendMoveDetail extends BackendMove {
  container: BackendContainer; to_slot: BackendYardSlot; from_slot?: BackendYardSlot | null;
}
export interface BackendPlan {
  id: number; plan_date: string; status: PlanStatus; strategy: SolveStrategy;
  generated_at: string; confirmed_at: string | null; parent_plan_id: number | null;
  solve_seconds: number | null; objective_value: number | null; best_bound: number | null;
  gap_percent: number | null; solver_status: string | null; solver_config_id: number | null;
}
export interface BackendPlanDetail extends BackendPlan { moves: BackendMove[]; }
export interface BackendDisruption {
  id: number; event_type: DisruptionType; affected_container_id: number | null;
  affected_order_id: number | null; affected_jockey_id: number | null;
  occurred_at: string; description: string; triggered_replan_id: number | null;
}
export interface BackendWeight {
  id: number; factor_name: string; weight: number; is_hard_constraint: boolean;
  transform_type: string | null; source_field: string | null;
  transform_params: Record<string, unknown> | null; null_default: number | null;
  display_order: number; updated_at: string; updated_by: string;
}
export interface BackendForecastPoint {
  day: string; projected_inbound: number; projected_occupancy: number; capacity: number; over_capacity: boolean;
}
export interface BackendForecast {
  points: BackendForecastPoint[]; first_over_capacity_day: string | null; assumptions: Record<string, unknown>;
}
export interface BackendGateTransaction {
  id: number; gate_type: "in" | "out"; carrier_ref: string | null; container_id: number | null;
  order_id: number | null; truck_license_plate: string | null; driver_ref: string | null;
  scheduled_time: string | null; actual_arrival: string | null; actual_departure: string | null;
  created_at: string;
}

// ─── Solver config ───────────────────────────────────────────────────
export interface BackendSolverConfig {
  id: number;
  version: number;
  source: "manual" | "tuned";
  is_active: boolean;
  created_by: string;
  tuning_run_id: number | null;
  notes: string | null;
  num_search_workers: number;
  candidate_k: number | null;
  portfolio_variant_count: number;
  base_move_minutes: number;
  gate_bay: number;
  gate_row: number;
  max_travel_distance: number;
  jockey_speed_distance_divisor: number;
  detention_urgency_window_days: number;
  unplaced_penalty: number;
  score_scaling_factor: number;
  tier_multiplier: number;
  created_at: string;
}

// ─── Optimizer runs ──────────────────────────────────────────────────
export type OptimizerRunStatus = "pending" | "running" | "completed" | "cancelled" | "failed";

export interface BackendOptimizerRun {
  id: number;
  status: OptimizerRunStatus;
  total_trials: number;
  batch_size: number;
  replay_sample_size: number;
  replay_window_days: number;
  data_source: "historical" | "synthetic_fallback";
  replay_plan_ids: number[] | null;
  best_score: number | null;
  best_knobs: Record<string, number | null> | null;
  created_at: string;
  completed_at: string | null;
  applied_at: string | null;
  error_message: string | null;
}

// ─── API functions ───────────────────────────────────────────────────

export const backendApi = {
  // Yard
  yard: () => request<BackendYardState>("/yard"),

  // Containers
  containers: (params?: { status?: ContainerStatus }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<BackendContainer[]>(`/containers${qs ? `?${qs}` : ""}`);
  },
  container: (id: number) => request<BackendContainerDetail>(`/containers/${id}`),

  // Orders
  orders: () => request<BackendOrder[]>("/orders"),

  // Jockeys (= operators in old seed data)
  jockeys: () => request<BackendJockey[]>("/jockeys"),

  // Plans — THE PLANNING ENGINE
  plans: () => request<BackendPlan[]>("/plans"),
  plan: (id: number) => request<BackendPlanDetail>(`/plans/${id}`),
  generatePlan: (body: { plan_date?: string | null; strategy: SolveStrategy; time_budget_seconds?: number | null }) =>
    request<BackendPlanDetail>("/plans/generate", { method: "POST", body: JSON.stringify(body) }),
  confirmPlan: (id: number) => request<BackendPlan>(`/plans/${id}/confirm`, { method: "POST" }),
  replan: (id: number, reason: string, timeBudget?: number) =>
    request<BackendPlanDetail>(`/plans/${id}/replan`, { method: "POST", body: JSON.stringify({ reason, time_budget_seconds: timeBudget }) }),
  deletePlan: (id: number) => request<void>(`/plans/${id}`, { method: "DELETE" }),

  // Disruptions
  disruptions: () => request<BackendDisruption[]>("/disruptions"),
  createDisruption: (body: { event_type: DisruptionType; affected_container_id?: number | null; affected_jockey_id?: number | null; description: string }) =>
    request<BackendDisruption>("/disruptions", { method: "POST", body: JSON.stringify(body) }),

  // Moves (operator tablet)
  nextMove: (jockeyId: number) => request<BackendMoveDetail | null>(`/moves/next?jockey_id=${jockeyId}`),
  scanMove: (moveId: number, containerNumber: string) =>
    request<{ match: boolean; move: BackendMove }>(`/moves/${moveId}/scan`, { method: "POST", body: JSON.stringify({ scanned_container_number: containerNumber }) }),
  /** Complete a move via the backend engine (numeric id for live engine). */
  completeMove: (moveId: number) => request<BackendMove>(`/moves/${moveId}/complete`, { method: "POST" }),
  /** Update a move's state (PLANNED / ASSIGNED / IN_PROGRESS). DONE must go via completeMoveById. */
  patchMove: (moveId: string | number, body: { state: string }) =>
    request<{ id: string; state: string }>(
      `/moves/${moveId}`, { method: "PATCH", body: JSON.stringify(body) }
    ),
  /** Complete a move by string or numeric id (used for seed-data moves). */
  completeMoveById: (moveId: string | number) =>
    request<{ moveId: string | number; containerId: string; destination: string; state: string }>(
      `/moves/${moveId}/complete`, { method: "POST", body: JSON.stringify({}) }
    ),

  // Visits & lanes (gate operations)
  patchVisit: (id: string | number, body: {
    state?: string; check_in?: string | null; at_position?: string | null;
    served?: string | null; gate_out?: string | null; lane_id?: string | null;
  }) => request<{ id: string; state: string; checkIn: string | null; atPosition: string | null; served: string | null; gateOut: string | null; lane: string | null }>(
    `/visits/${id}`, { method: "PATCH", body: JSON.stringify(body) }
  ),
  patchLane: (id: string | number, body: {
    state?: string; visit_id?: string | null; since?: string | null;
  }) => request<{ id: string; state: string; visit: string | null; since: string | null }>(
    `/lanes/${id}`, { method: "PATCH", body: JSON.stringify(body) }
  ),

  // Events (control tower / night planner)
  postEvent: (body: {
    id: string; title: string; time?: string; type?: string; severity?: string;
    state?: string; auto?: string; detail?: string; diff?: Record<string, unknown>;
  }) => request<{ id: string }>(`/events`, { method: "POST", body: JSON.stringify(body) }),

  // Weights (priority factors)
  weights: () => request<BackendWeight[]>("/weights"),
  updateWeights: (weights: { factor_name: string; weight: number }[], updatedBy = "yard_manager") =>
    request<{ weights: BackendWeight[]; warnings: string[] }>("/weights/batch", { method: "PUT", body: JSON.stringify({ weights, updated_by: updatedBy }) }),

  // Forecast
  forecast: (months = 3, capacity?: number) => {
    const q = new URLSearchParams({ months: String(months) });
    if (capacity) q.set("capacity", String(capacity));
    return request<BackendForecast>(`/forecast?${q}`);
  },

  // Gate
  gateTransactions: (containerId?: number) => {
    const q = containerId ? `?container_id=${containerId}` : "";
    return request<BackendGateTransaction[]>(`/gate/transactions${q}`);
  },
  createGateTransaction: (body: { gate_type: "in" | "out"; container_id?: number; truck_license_plate?: string; driver_ref?: string; carrier_ref?: string }) =>
    request<BackendGateTransaction>("/gate/transactions", { method: "POST", body: JSON.stringify(body) }),

  // Gate containers — enriched with live carrier + trucker DB join
  fetchGateContainers: (type: "inbound" | "outbound") =>
    request<{ rows: LiveGateRow[]; fetchedAt: string }>(`/gate/containers?type=${type}`),

  // Seed reset (demo) — requires --force on seed.ts server-side
  resetSeed: (randomize = false) =>
    request<{ status: string }>(`/seed/reset?randomize=${randomize}`, { method: "POST" }),

  // Solver config
  getActiveSolverConfig: () => request<BackendSolverConfig>("/solver-config/active"),
  updateSolverConfig: (changes: Partial<BackendSolverConfig> & { updated_by?: string }) =>
    request<BackendSolverConfig>("/solver-config", { method: "PUT", body: JSON.stringify(changes) }),

  // Optimizer runs
  startOptimizerRun: (body: { total_trials?: number; batch_size?: number }) =>
    request<BackendOptimizerRun>("/optimizer/runs", { method: "POST", body: JSON.stringify(body) }),
  getOptimizerRun: (id: number) => request<BackendOptimizerRun>(`/optimizer/runs/${id}`),
  listOptimizerRuns: () => request<BackendOptimizerRun[]>("/optimizer/runs"),
  applyOptimizerRun: (id: number) =>
    request<BackendSolverConfig>(`/optimizer/runs/${id}/apply`, { method: "POST" }),
};
