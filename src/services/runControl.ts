export type RunStatus = "idle" | "running" | "stopping" | "stopped" | "done" | "error";
export type RunKind = "kronos_scan";

export interface RunState {
  id: string;
  kind: RunKind;
  label: string;
  status: RunStatus;
  startedAt: string;
  stopRequested: boolean;
  stoppedAt?: string;
  finishedAt?: string;
  message?: string;
}

let activeRun: RunState | null = null;

export function beginRun(kind: RunKind, label: string): RunState | null {
  if (activeRun && (activeRun.status === "running" || activeRun.status === "stopping")) {
    return null;
  }

  activeRun = {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label,
    status: "running",
    startedAt: new Date().toISOString(),
    stopRequested: false,
  };

  return activeRun;
}

export function requestRunStop(kind?: RunKind): RunState | null {
  if (!activeRun || (kind && activeRun.kind !== kind)) return null;
  if (activeRun.status !== "running" && activeRun.status !== "stopping") return activeRun;

  activeRun = {
    ...activeRun,
    status: "stopping",
    stopRequested: true,
    stoppedAt: activeRun.stoppedAt ?? new Date().toISOString(),
    message: "Stop requested",
  };

  return activeRun;
}

export function finishRun(id: string, status: Exclude<RunStatus, "idle" | "running" | "stopping">, message?: string): RunState | null {
  if (!activeRun || activeRun.id !== id) return activeRun;

  activeRun = {
    ...activeRun,
    status,
    finishedAt: new Date().toISOString(),
    message,
  };

  return activeRun;
}

export function isRunStopRequested(id: string): boolean {
  return Boolean(activeRun && activeRun.id === id && activeRun.stopRequested);
}

export function getRunState(): RunState | { status: "idle"; stopRequested: false } {
  return activeRun ?? { status: "idle", stopRequested: false };
}
