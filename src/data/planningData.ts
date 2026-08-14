// planningData.ts
// Single source of truth for all planning engine results in the YMSNOW prototype.
// Import this module instead of reading the JSON directly — every screen
// pulls from the same parsed data, so counts, statuses, and operator
// assignments are guaranteed consistent.

import fixture from "./planningResults.json";

// ─── Types ────────────────────────────────────────────────────────────

export interface Location {
  bay: number | string | null; // number for yard slots, "GATE / OFF-YARD" for gate
  row: number | null;
  tier: number | null;
  lat: number | null;
  lng: number | null;
}

export type OperationType =
  | "Outbound staging and truck loading"
  | "Premarshal ahead of retrieval"
  | "Putaway"
  | "Digout to clear an overstow"
  | "Discharge from vessel";

export type StepStatus = "Planned" | "Completed" | "Blocked";

export type MoveMethod =
  | "Crane lift"
  | "Yard-truck haul"
  | "Inspection"
  | "Move to staging";

export interface PlanningStep {
  source_sheet: string;
  activity_id?: string | null;
  activity_container_instance_id?: string | null;
  leg_container_instance_id?: string | null;
  container_id: string | null;
  operation: OperationType;
  activity_status: StepStatus;
  planning_score: number | null;
  step_number: number | null;
  jockey_activity?: string | null;
  move_method: MoveMethod | null;
  step_status: StepStatus;
  operator: string | null;
  operator_pickup?: string | null;
  operator_dropoff?: string | null;
  origin: Location;
  destination: Location;
  planned_step: number | null;
  estimated_start: string | null; // ISO timestamp
  estimated_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
}

export interface ContainerSummary {
  container_id: string;
  operations: OperationType[];
  current_status: StepStatus;
}

export interface OperatorSummary {
  name: string;
  assigned_steps: number;
  containers_touched: string[];
}

export interface OperationSummary {
  operation: OperationType;
  total_steps: number;
  planned: number;
  completed: number;
  blocked: number;
}

// ─── Parsed data ──────────────────────────────────────────────────────

const data = fixture as {
  steps: PlanningStep[];
  containers: Record<string, ContainerSummary>;
  operators: Record<string, OperatorSummary>;
  operation_summary: Record<string, OperationSummary>;
};

export const allSteps: PlanningStep[] = data.steps;
export const containers: Record<string, ContainerSummary> = data.containers;
export const operators: Record<string, OperatorSummary> = data.operators;
export const operationSummary: Record<string, OperationSummary> =
  data.operation_summary;

// ─── Accessors — use these so every screen computes from the same base ─

/** All steps for a given container, ordered by step_number */
export function stepsForContainer(containerId: string): PlanningStep[] {
  return allSteps
    .filter((s) => s.container_id === containerId)
    .sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));
}

/** All steps assigned to an operator, ordered by estimated_start */
export function stepsForOperator(operatorName: string): PlanningStep[] {
  return allSteps
    .filter((s) => s.operator === operatorName)
    .sort(
      (a, b) =>
        new Date(a.estimated_start ?? 0).getTime() -
        new Date(b.estimated_start ?? 0).getTime()
    );
}

/** Steps filtered by operation type */
export function stepsByOperation(operation: OperationType): PlanningStep[] {
  return allSteps.filter((s) => s.operation === operation);
}

/** Steps filtered by status */
export function stepsByStatus(status: StepStatus): PlanningStep[] {
  return allSteps.filter(
    (s) => s.step_status === status || s.activity_status === status
  );
}

/** Steps that have geo coordinates (for yard map rendering) */
export function geoSteps(): PlanningStep[] {
  return allSteps.filter(
    (s) =>
      (s.origin.lat != null && s.origin.lng != null) ||
      (s.destination.lat != null && s.destination.lng != null)
  );
}

/** Unique container IDs as a sorted array */
export function containerIds(): string[] {
  return Object.keys(containers).sort();
}

/** Unique operator names as a sorted array */
export function operatorNames(): string[] {
  return Object.keys(operators).sort();
}

/** Quick counts for dashboard cards */
export function dashboardCounts() {
  return {
    totalContainers: Object.keys(containers).length,
    totalSteps: allSteps.length,
    totalOperators: Object.keys(operators).length,
    planned: allSteps.filter(
      (s) => s.step_status === "Planned" || s.activity_status === "Planned"
    ).length,
    completed: allSteps.filter(
      (s) =>
        s.step_status === "Completed" || s.activity_status === "Completed"
    ).length,
    blocked: allSteps.filter(
      (s) => s.step_status === "Blocked" || s.activity_status === "Blocked"
    ).length,
  };
}

/** Steps grouped by bay number (for yard grid views) */
export function stepsByBay(): Map<number | string, PlanningStep[]> {
  const byBay = new Map<number | string, PlanningStep[]>();
  for (const s of allSteps) {
    const bay = s.destination.bay ?? s.origin.bay;
    if (bay != null) {
      if (!byBay.has(bay)) byBay.set(bay, []);
      byBay.get(bay)!.push(s);
    }
  }
  return byBay;
}
