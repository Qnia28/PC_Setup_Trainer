import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { decoder, encoder, Field } from "tetris-fumen";
import { SolverWorkerClient, viteWorkerFactory } from "../solver/workerClient";
import {
  drawEditableField,
  drawSolutionPage,
  SOLVER_FIELD_MAX_HEIGHT,
  SOLVER_FIELD_WIDTH,
} from "./canvas";
import {
  prepareStandaloneSolve,
  type StandaloneSolveDisplayMode,
  type StandaloneSolvePreparation,
} from "./model";
import { parseSolverFumen, type SolverField } from "./fumenInput";

type FumenPage = ReturnType<typeof decoder.decode>[number];
type SolverLineMode = 4 | 5 | 6;
type WarmupState = "loading" | "ready" | "error";

interface SolverResultPayload {
  fumen: string | null;
  solutionCount?: number;
  pageCounts?: Record<string, number>;
}

interface SolutionEntry {
  id: string;
  label: string;
  page: FumenPage;
}

interface SolutionGroup {
  key: string;
  label: string;
  entries: SolutionEntry[];
}

const SAVE_DISPLAY_ORDER = "TILJOSZ";

type SolverView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: SolutionEntry[]; availableSaves: string[] };

function emptyField(): SolverField {
  return Array.from({ length: SOLVER_FIELD_MAX_HEIGHT }, () => Array<boolean>(SOLVER_FIELD_WIDTH).fill(false));
}

function occupiedCellCount(field: SolverField, visibleRows: SolverLineMode): number {
  let count = 0;
  for (let y = 0; y < visibleRows; y += 1) {
    for (let x = 0; x < SOLVER_FIELD_WIDTH; x += 1) if (field[y]?.[x]) count += 1;
  }
  return count;
}

function encodeField(field: SolverField, visibleRows: SolverLineMode): string {
  const fumenField = Field.create();
  for (let y = 0; y < visibleRows; y += 1) {
    for (let x = 0; x < SOLVER_FIELD_WIDTH; x += 1) {
      if (field[y]?.[x]) fumenField.set(x, y, "X");
    }
  }
  return encoder.encode([{ field: fumenField, flags: { colorize: true } }]);
}

function solutionLabel(page: FumenPage, index: number): string {
  const save = page.comment.match(/Save ([TILJOSZ])/i)?.[1]?.toUpperCase();
  return save ? `Save ${save}` : page.comment || `Solution ${index + 1}`;
}

function decodeSolutionEntries(payload: SolverResultPayload): SolutionEntry[] {
  if (!payload.fumen) return [];
  return decoder.decode(payload.fumen).slice(1).map((page, index) => ({
    id: `${index}-${page.comment}`,
    label: solutionLabel(page, index),
    page,
  }));
}

function groupSolutionEntries(entries: SolutionEntry[]): SolutionGroup[] {
  const bySave = new Map<string, SolutionEntry[]>();
  const ordinary: SolutionEntry[] = [];
  for (const entry of entries) {
    const save = entry.label.match(/^Save ([TILJOSZ])$/)?.[1];
    if (!save) {
      ordinary.push(entry);
      continue;
    }
    const group = bySave.get(save) ?? [];
    group.push(entry);
    bySave.set(save, group);
  }
  const groups = [...SAVE_DISPLAY_ORDER].flatMap((save): SolutionGroup[] => {
    const saved = bySave.get(save);
    return saved?.length ? [{ key: `save-${save}`, label: `Save ${save}`, entries: saved }] : [];
  });
  if (ordinary.length) groups.push({ key: "solutions", label: "Solutions", entries: ordinary });
  return groups;
}

function SolutionCard({ entry, heading, visibleRows }: { entry: SolutionEntry; heading: string; visibleRows: SolverLineMode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawSolutionPage(canvas.current, entry.page, visibleRows);
  }, [entry.page, visibleRows]);
  return <article className="standalone-solution-card">
    <h4>{heading}</h4>
    <canvas ref={canvas} aria-label={`${heading} Perfect Clear solution`} />
  </article>;
}

function preparationCopy(preparation: StandaloneSolvePreparation): string {
  if (!preparation.ready) return preparation.reason;
  const { analysis } = preparation;
  return analysis.saveMode
    ? `${analysis.placedPieces}P field + see${analysis.queueWindowLength} · save-by-save`
    : `${analysis.placedPieces}P field + see${analysis.queueWindowLength} · exact queue solve`;
}

export function SolverApp() {
  const [field, setField] = useState<SolverField>(emptyField);
  const [fumenInput, setFumenInput] = useState("");
  const [queue, setQueue] = useState("");
  const [lineMode, setLineMode] = useState<SolverLineMode>(4);
  const [displayMode, setDisplayMode] = useState<StandaloneSolveDisplayMode>("all");
  const [warmupState, setWarmupState] = useState<WarmupState>("loading");
  const [view, setView] = useState<SolverView>({ status: "idle" });
  const fieldCanvas = useRef<HTMLCanvasElement>(null);
  const solver = useRef<SolverWorkerClient | null>(null);
  const calculationAbort = useRef<AbortController | null>(null);
  const importingFumenField = useRef(false);
  const generation = useRef(0);
  const drawing = useRef(false);
  const paintValue = useRef(true);

  const occupiedCells = useMemo(() => occupiedCellCount(field, lineMode), [field, lineMode]);
  const parsedFumen = useMemo(() => parseSolverFumen(fumenInput, lineMode), [fumenInput, lineMode]);
  const calculationField = parsedFumen.status === "ready" ? parsedFumen.field : field;
  const calculationOccupiedCells = useMemo(
    () => occupiedCellCount(calculationField, lineMode),
    [calculationField, lineMode],
  );
  const preparation = useMemo<StandaloneSolvePreparation>(() => {
    if (parsedFumen.status === "error") return { ready: false, reason: parsedFumen.reason };
    return prepareStandaloneSolve({
      occupiedCells: calculationOccupiedCells,
      queue,
      displayMode,
      targetLines: lineMode,
    });
  }, [calculationOccupiedCells, displayMode, lineMode, parsedFumen, queue]);

  useEffect(() => {
    if (fieldCanvas.current) drawEditableField(fieldCanvas.current, field, lineMode);
  }, [field, lineMode]);

  useEffect(() => {
    if (importingFumenField.current) {
      importingFumenField.current = false;
      return;
    }
    generation.current += 1;
    calculationAbort.current?.abort();
    calculationAbort.current = null;
    setView({ status: "idle" });
  }, [displayMode, field, fumenInput, lineMode, queue]);

  useEffect(() => {
    const client = new SolverWorkerClient(viteWorkerFactory);
    solver.current = client;
    return () => {
      calculationAbort.current?.abort();
      if (solver.current === client) solver.current = null;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    const client = solver.current;
    if (!client) return;
    const controller = new AbortController();
    let active = true;
    setWarmupState("loading");
    void client.request<{ ready: boolean }>("warmup", { targetLines: lineMode }, { signal: controller.signal })
      .then(() => { if (active) setWarmupState("ready"); })
      .catch((reason) => {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setWarmupState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [lineMode]);

  const paintCell = useCallback((event: ReactPointerEvent<HTMLCanvasElement>, value: boolean) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / SOLVER_FIELD_WIDTH));
    const screenY = Math.floor((event.clientY - rect.top) / (rect.height / lineMode));
    const y = lineMode - 1 - screenY;
    if (x < 0 || x >= SOLVER_FIELD_WIDTH || y < 0 || y >= lineMode) return;
    setField((current) => {
      if (current[y]?.[x] === value) return current;
      const next = current.map((row) => [...row]);
      next[y]![x] = value;
      return next;
    });
  }, [lineMode]);

  function beginPaint(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / SOLVER_FIELD_WIDTH));
    const screenY = Math.floor((event.clientY - rect.top) / (rect.height / lineMode));
    const y = lineMode - 1 - screenY;
    if (x < 0 || x >= SOLVER_FIELD_WIDTH || y < 0 || y >= lineMode) return;
    if (fumenInput) setFumenInput("");
    drawing.current = true;
    paintValue.current = event.button === 2 ? false : !(field[y]?.[x] ?? false);
    canvas.setPointerCapture(event.pointerId);
    paintCell(event, paintValue.current);
  }

  async function calculate(): Promise<void> {
    const client = solver.current;
    if (!preparation.ready || !client || warmupState !== "ready") return;
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    calculationAbort.current?.abort();
    calculationAbort.current = controller;
    if (parsedFumen.status === "ready") {
      importingFumenField.current = true;
      setField(parsedFumen.field);
    }
    setView({ status: "loading" });
    try {
      const payload = await client.request<SolverResultPayload>(preparation.analysis.kind, {
        sourceFumen: encodeField(calculationField, lineMode),
        pattern: preparation.analysis.queueWindow,
        targetLines: lineMode,
        useHold: true,
        title: "QniaPC Solver",
      }, { signal: controller.signal });
      if (generation.current !== requestGeneration) return;
      const entries = decodeSolutionEntries(payload);
      if (entries.length === 0) {
        setView({ status: "none" });
        return;
      }
      const saves = new Set(entries.flatMap(({ label }) => {
        const match = label.match(/^Save ([TILJOSZ])$/);
        return match ? [match[1]!] : [];
      }));
      const availableSaves = [...SAVE_DISPLAY_ORDER].filter((piece) => saves.has(piece));
      setView({ status: "ready", entries, availableSaves });
    } catch (reason) {
      if (generation.current !== requestGeneration || reason instanceof DOMException && reason.name === "AbortError") return;
      setView({ status: "error", message: reason instanceof Error ? reason.message : "Solver failed." });
    } finally {
      if (calculationAbort.current === controller) calculationAbort.current = null;
    }
  }

  return <main
    className="standalone-solver-shell"
    onKeyDown={(event) => event.stopPropagation()}
    onKeyUp={(event) => event.stopPropagation()}
  >
    <header className="standalone-solver-heading">
      <span>QNIAPC</span>
      <h1>Perfect Clear Solver</h1>
      <p>Draw the current post-clear field, enter the visible queue, and calculate directly in the browser.</p>
    </header>

    <nav className="standalone-line-modes" aria-label="Solver line mode">
      {([4, 5, 6] as const).map((lines) => <button
        key={lines}
        type="button"
        className={lineMode === lines ? "selected" : ""}
        aria-pressed={lineMode === lines}
        onClick={() => {
          setLineMode(lines);
          setField((current) => current.map((row, y) => y < lines ? row : Array<boolean>(SOLVER_FIELD_WIDTH).fill(false)));
        }}
      >{lines}L Mode</button>)}
    </nav>

    <section className="standalone-solver-input" aria-label="Solver input">
      <div className="standalone-field-panel">
        <div className="standalone-panel-heading">
          <div><span>FIELD</span><strong>{occupiedCells} occupied cells</strong></div>
          <button type="button" onClick={() => { setField(emptyField()); setFumenInput(""); }}>Clear</button>
        </div>
        <canvas
          ref={fieldCanvas}
          className="standalone-field-canvas"
          aria-label={`Editable 10-column by ${lineMode}-row solver field`}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={beginPaint}
          onPointerMove={(event) => { if (drawing.current) paintCell(event, paintValue.current); }}
          onPointerUp={(event) => { drawing.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drawing.current = false; }}
        />
        <p>Use the selected line format. Fill intentionally unused bottom rows completely. Right-drag erases.</p>
        <label className="standalone-fumen-input">
          <span>Fumen</span>
          <input
            value={fumenInput}
            placeholder="v115@… or Fumen URL"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setFumenInput(event.target.value)}
          />
        </label>
      </div>

      <div className="standalone-controls-panel">
        <label>
          <span>Queue</span>
          <input
            value={queue}
            placeholder="TILJOSZ…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={/[^TILJOSZ]/.test(queue)}
            onChange={(event) => setQueue(event.target.value.toUpperCase())}
          />
        </label>

        <fieldset className="standalone-mode-selector">
          <legend>Solution mode</legend>
          <label><input type="radio" name="solution-mode" checked={displayMode === "one"} onChange={() => setDisplayMode("one")} />One minimal</label>
          <label><input type="radio" name="solution-mode" checked={displayMode === "all"} onChange={() => setDisplayMode("all")} />All solutions</label>
        </fieldset>

        <div className={`standalone-input-status ${preparation.ready ? "ready" : ""}`}>
          {preparationCopy(preparation)}
          {preparation.ready && preparation.analysis.queueWindow.length < queue.length
            ? <small>Using queue prefix {preparation.analysis.queueWindow}</small>
            : null}
          <small>{warmupState === "ready" ? "Solver ready" : warmupState === "loading" ? "Preparing WASM and legal boards…" : "Solver preparation failed"}</small>
        </div>

        <button
          type="button"
          className="standalone-calculate"
          disabled={!preparation.ready || warmupState !== "ready" || view.status === "loading"}
          onClick={() => void calculate()}
        >{warmupState === "loading" ? "Preparing…" : view.status === "loading" ? "Calculating…" : "Calculate"}</button>
      </div>
    </section>

    <section className="standalone-results" aria-live="polite" aria-busy={view.status === "loading"}>
      {view.status === "idle" && <p className="standalone-placeholder">Solutions will appear here.</p>}
      {view.status === "loading" && <p className="standalone-placeholder">Searching the selected queue…</p>}
      {view.status === "none" && <div className="standalone-message"><h2>No solve</h2><p>No Perfect Clear solution was found.</p></div>}
      {view.status === "error" && <div className="standalone-message error" role="alert"><h2>Solver error</h2><p>{view.message}</p></div>}
      {view.status === "ready" && <>
        <div className="standalone-results-heading">
          <h2>{view.entries.length} {view.entries.length === 1 ? "solution" : "solutions"}</h2>
          {view.availableSaves.length > 0 ? <span>Available saves: {view.availableSaves.join(", ")}</span> : null}
        </div>
        {displayMode === "one" ? <div className="standalone-solution-grid">
          {view.entries.map((entry) => <SolutionCard key={entry.id} entry={entry} heading={entry.label} visibleRows={lineMode} />)}
        </div> : <div className="standalone-solution-groups">
          {groupSolutionEntries(view.entries).map((group) => <section className="standalone-solution-group" key={group.key}>
            <h3><span>{group.label}</span><small>{group.entries.length}</small></h3>
            <div className="standalone-solution-grid">
              {group.entries.map((entry, index) => <SolutionCard
                key={entry.id}
                entry={entry}
                heading={group.label === "Solutions" ? entry.label : `Solution ${index + 1}`}
                visibleRows={lineMode}
              />)}
            </div>
          </section>)}
        </div>}
      </>}
    </section>
  </main>;
}
