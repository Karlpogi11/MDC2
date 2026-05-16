import { useEffect, useMemo, useState, type ReactElement } from "react";
import { checklistGates, type ChecklistGate } from "../data/checklist";

type ChecklistState = Record<string, boolean>;

type GateProgress = {
  gate: ChecklistGate;
  done: number;
  total: number;
  percent: number;
};

const CHECKLIST_STATE_KEY = "mdc.delivery_checklist_state.v1";
const CHECKLIST_UPDATED_AT_KEY = "mdc.delivery_checklist_updated_at.v1";

function getDefaultState(): ChecklistState {
  const next: ChecklistState = {};

  for (const gate of checklistGates) {
    for (const item of gate.items) {
      next[item.id] = false;
    }
  }

  return next;
}

function sanitizeState(value: unknown): ChecklistState {
  const defaults = getDefaultState();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Record<string, unknown>;
  const next: ChecklistState = { ...defaults };

  for (const key of Object.keys(defaults)) {
    if (typeof raw[key] === "boolean") {
      next[key] = raw[key] as boolean;
    }
  }

  return next;
}

function loadState(): ChecklistState {
  const raw = window.localStorage.getItem(CHECKLIST_STATE_KEY);
  if (!raw) {
    return getDefaultState();
  }

  try {
    return sanitizeState(JSON.parse(raw));
  } catch {
    return getDefaultState();
  }
}

function loadUpdatedAt(): Date | null {
  const raw = window.localStorage.getItem(CHECKLIST_UPDATED_AT_KEY);
  if (!raw) {
    return null;
  }

  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function ChecklistBoard(): ReactElement {
  const [state, setState] = useState<ChecklistState>(() => loadState());
  const [updatedAt, setUpdatedAt] = useState<Date | null>(() => loadUpdatedAt());

  const persist = (next: ChecklistState) => {
    const now = new Date();
    window.localStorage.setItem(CHECKLIST_STATE_KEY, JSON.stringify(next));
    window.localStorage.setItem(CHECKLIST_UPDATED_AT_KEY, now.toISOString());
    setUpdatedAt(now);
  };

  const toggleItem = (itemId: string) => {
    setState((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      persist(next);
      return next;
    });
  };

  const setGate = (gate: ChecklistGate, checked: boolean) => {
    setState((prev) => {
      const next = { ...prev };
      for (const item of gate.items) {
        next[item.id] = checked;
      }
      persist(next);
      return next;
    });
  };

  const reset = () => {
    const next = getDefaultState();
    setState(next);
    persist(next);
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHECKLIST_STATE_KEY && event.newValue) {
        try {
          setState(sanitizeState(JSON.parse(event.newValue)));
        } catch {
          setState(getDefaultState());
        }
      }

      if (event.key === CHECKLIST_UPDATED_AT_KEY && event.newValue) {
        const value = new Date(event.newValue);
        if (!Number.isNaN(value.getTime())) {
          setUpdatedAt(value);
        }
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const progress = useMemo(() => {
    const byGate: GateProgress[] = checklistGates.map((gate) => {
      const done = gate.items.reduce((sum, item) => sum + (state[item.id] ? 1 : 0), 0);
      const total = gate.items.length;
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      return { gate, done, total, percent };
    });

    let total = 0;
    let done = 0;
    let p0Total = 0;
    let p0Done = 0;

    for (const gateProgress of byGate) {
      total += gateProgress.total;
      done += gateProgress.done;

      for (const item of gateProgress.gate.items) {
        const isP0 = gateProgress.gate.p0 || item.p0;
        if (isP0) {
          p0Total += 1;
          if (state[item.id]) {
            p0Done += 1;
          }
        }
      }
    }

    return {
      byGate,
      done,
      total,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      p0Done,
      p0Total,
      p0Percent: p0Total > 0 ? Math.round((p0Done / p0Total) * 100) : 0,
      p0Blockers: p0Total - p0Done,
    };
  }, [state]);

  return (
    <section className="checklist-shell">
      <section className="checklist-summary-card">
        <div className="checklist-summary-head">
          <h2>Live Development Checklist</h2>
          <button className="control-btn" type="button" onClick={reset}>
            Reset
          </button>
        </div>
        <p className="checklist-updated">
          Auto-saved.
          {updatedAt ? ` Last update: ${updatedAt.toLocaleTimeString()}` : ""}
        </p>

        <div className="checklist-metrics">
          <article>
            <strong>{progress.percent}%</strong>
            <span>Overall</span>
          </article>
          <article>
            <strong>
              {progress.done}/{progress.total}
            </strong>
            <span>Completed</span>
          </article>
          <article>
            <strong>{progress.p0Percent}%</strong>
            <span>P0 Completion</span>
          </article>
          <article>
            <strong>{progress.p0Blockers}</strong>
            <span>P0 Blockers</span>
          </article>
        </div>

        <div className="check-progress-track" aria-label="Overall progress">
          <div className="check-progress-fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="check-progress-track p0" aria-label="P0 progress">
          <div className="check-progress-fill p0" style={{ width: `${progress.p0Percent}%` }} />
        </div>
      </section>

      <section className="checklist-gate-grid">
        {progress.byGate.map((gateProgress) => {
          const complete = gateProgress.done === gateProgress.total;

          return (
            <article key={gateProgress.gate.id} className="checklist-gate-card">
              <header className="checklist-gate-head">
                <div>
                  <h3>{gateProgress.gate.title}</h3>
                  <p>
                    {gateProgress.done}/{gateProgress.total} done ({gateProgress.percent}%)
                  </p>
                </div>
                <div className="checklist-gate-actions">
                  {gateProgress.gate.p0 && <span className="gate-pill">P0 Gate</span>}
                  <button
                    className="control-btn"
                    type="button"
                    onClick={() => setGate(gateProgress.gate, !complete)}
                  >
                    {complete ? "Uncheck all" : "Mark all"}
                  </button>
                </div>
              </header>

              <div className="check-progress-track small">
                <div className="check-progress-fill small" style={{ width: `${gateProgress.percent}%` }} />
              </div>

              <div className="checklist-item-list">
                {gateProgress.gate.items.map((item) => (
                  <label key={item.id} className={state[item.id] ? "checklist-item done" : "checklist-item"}>
                    <input
                      type="checkbox"
                      checked={state[item.id]}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span>{item.label}</span>
                    {item.p0 && <span className="gate-pill">P0</span>}
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
