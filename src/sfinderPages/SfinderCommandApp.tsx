import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { decoder, type Page } from "tetris-fumen";
import { SiteHeader } from "../site/SiteHeader";
import { createBatchWorkerClient } from "../solver/batchWorkerClient";
import { SolverWorkerClient, viteWorkerFactory } from "../solver/workerClient";
import { drawSolutionPage } from "../solverPage/canvas";
import { COMMAND_FIELD_WIDTH, createEmptyCommandField, drawCommandField, type CommandCell, type CommandField } from "./commandCanvas";
import {
  commandDisplayRows,
  commandTargetOptions,
  defaultHumanQualityMode,
  defaultTargetLines,
  fieldFromFumen,
  formatCalculationDuration,
  formatRatioPercentage,
  groupPerSavePages,
  isAdaptiveMinimalsCommand,
  minimumCoverWorkerOptions,
  normalizeSfinderQueuePattern,
  normalizeCommandSource,
  PER_SAVE_RESULT_ORDER,
  type CommandLineGroup,
  type CommandTargetLines,
  type HiGHSMode,
  type HumanQualityMode,
} from "./commandModel";
import { defaultWantedSave, type SfinderCommandDefinition } from "./commands";
import { copyText } from "./copyText";
import "./sfinderCommand.css";

type WarmupState = "loading" | "ready" | "error";
type ResultRecord = Record<string, unknown> & { fumen?: string | null };
type ResultView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: ResultRecord };

const BATCH_COMMANDS = new Set(["cover", "congruent_cover", "congruent"]);
const COLORED_DRAWING_COMMANDS = new Set(["cover", "congruent_cover", "congruent"]);
const COMMAND_PAINT_OPTIONS: readonly { value: CommandCell; label: string }[] = [
  { value: "X", label: "Gray" },
  { value: "T", label: "T" },
  { value: "O", label: "O" },
  { value: "I", label: "I" },
  { value: "L", label: "L" },
  { value: "J", label: "J" },
  { value: "S", label: "S" },
  { value: "Z", label: "Z" },
];
function commandWorkerKind(commandId: string): string {
  if (commandId === "per_save_minimals") return "per-save-minimals";
  if (commandId === "congruent_cover") return "congruentcover";
  return commandId;
}

function resultPages(result: ResultRecord): Page[] {
  if (!result.fumen) return [];
  const pages = decoder.decode(result.fumen);
  const pageCounts = result.pageCounts;
  return pageCounts && typeof pageCounts === "object" ? pages.slice(1) : pages;
}

function metricEntries(result: ResultRecord): [string, string][] {
  const metrics: [string, string][] = [];
  const add = (label: string, key: string, suffix = "") => {
    const value = result[key];
    if (typeof value === "number") metrics.push([label, `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`]);
  };
  const addRatio = (label: string, key: string) => {
    const value = result[key];
    if (typeof value === "number") metrics.push([label, formatRatioPercentage(value)]);
  };
  add("Chance", "percent", "%");
  add("Success", "success");
  add("Covered", "covered");
  add("Total", "total");
  add("Failed", "failed");
  add("Minimals", "minimalCount");
  add("Solutions", "count");
  addRatio("PC rate", "pcRate");
  return metrics;
}

function backendLabel(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function minimalsMetadata(result: ResultRecord): [string, string][] {
  const metadata: [string, string][] = [];
  const cardinalityBackend = backendLabel(result.cardinalityBackend ?? result.minimumCoverBackend);
  const qualityBackend = backendLabel(result.qualityBackend);
  const requested = result.useHiGHSRequested === true ? "On" : result.useHiGHSRequested === false ? "Off" : "Auto";
  const resolved = result.useHiGHSResolved === true ? "Used" : "Not used";
  if (cardinalityBackend) metadata.push(["Minimum set", `Exact · ${cardinalityBackend}`]);
  if (qualityBackend) metadata.push(["Quality", `${result.humanQualityExact === false ? "Fast" : "Exact"} · ${qualityBackend}`]);
  if ("useHiGHSRequested" in result || "useHiGHSResolved" in result) metadata.push(["HiGHS", `${resolved} · ${requested}`]);
  return metadata;
}

function SolutionCanvas({ page, displayRows, label }: { page: Page; displayRows: 4 | 6; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSolutionPage(ref.current, page, displayRows);
  }, [displayRows, page]);
  return <article className="sfinder-result-page">
    <strong>{label}</strong>
    <canvas ref={ref} aria-label={label} />
  </article>;
}

function ResultFumen({ value }: { value: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => { setCopyStatus("idle"); }, [value]);

  async function copyFumen(): Promise<void> {
    try {
      await copyText(value);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return <div className="sfinder-result-fumen-block">
    <label className="sfinder-result-fumen"><span>Result Fumen</span><textarea readOnly value={value} /></label>
    <button type="button" className="sfinder-copy-fumen" onClick={() => { void copyFumen(); }}>
      {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy Fumen"}
    </button>
    <span className="sfinder-copy-status" role="status" aria-live="polite">
      {copyStatus === "copied" ? "Result Fumen copied to clipboard." : copyStatus === "error" ? "Could not copy Result Fumen." : ""}
    </span>
  </div>;
}

function ResultPanel({
  view,
  displayRows,
  commandId,
}: {
  view: ResultView;
  displayRows: 4 | 6;
  commandId: SfinderCommandDefinition["id"];
}) {
  if (view.status === "idle") return <section className="sfinder-command-results"><p>Results will appear here.</p></section>;
  if (view.status === "loading") return <section className="sfinder-command-results"><p>Calculating…</p></section>;
  if (view.status === "error") return <section className="sfinder-command-results error" role="alert"><h2>Calculation failed</h2><p>{view.message}</p></section>;

  const result = view.value;
  const pages = resultPages(result);
  const metrics = metricEntries(result);
  const failedQueues = Array.isArray(result.failedQueues)
    ? result.failedQueues.filter((value): value is string => typeof value === "string")
    : [];
  const saveResults = result.results && typeof result.results === "object"
    ? result.results as Record<string, Record<string, unknown>>
    : null;
  const shownPages = pages.slice(0, 200);
  const perSaveGroups = commandId === "per_save_minimals" ? groupPerSavePages(shownPages) : [];
  const metadata = commandId === "minimals" ? minimalsMetadata(result) : [];
  return <section className="sfinder-command-results">
    <div className="sfinder-result-metrics">
      {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    {metadata.length ? <dl className="sfinder-result-metadata">
      {metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl> : null}
    {saveResults ? <div className="sfinder-save-table">
      {[...PER_SAVE_RESULT_ORDER].flatMap((piece) => {
        const row = saveResults[piece];
        if (!row) return [];
        const saveRate = typeof row.saveRate === "number" ? formatRatioPercentage(row.saveRate) : "N/A";
        const cardinalityBackend = backendLabel(row.cardinalityBackend ?? row.minimumCoverBackend);
        const qualityBackend = backendLabel(row.qualityBackend);
        return <div key={piece}>
          <strong>Save {piece}</strong>
          <span>{Number(row.minimalCount ?? 0)} minimals · {saveRate}</span>
          {cardinalityBackend ? <small>Minimum set: Exact · {cardinalityBackend}</small> : null}
          {qualityBackend ? <small>Quality: {row.humanQualityExact === false ? "Fast" : "Exact"} · {qualityBackend}</small> : null}
        </div>;
      })}
    </div> : null}
    {failedQueues.length ? <details className="sfinder-failed-queues"><summary>{failedQueues.length} failed queues</summary><code>{failedQueues.join(" ")}</code></details> : null}
    {perSaveGroups.length ? <>
      <div className="sfinder-result-groups">
        {perSaveGroups.map((group) => <section className="sfinder-result-group" key={group.piece}>
          <h3><span>{group.label}</span><small>{group.pages.length}</small></h3>
          <div className="sfinder-result-grid">
            {group.pages.map((page, index) => <SolutionCanvas key={`${group.piece}-${index}-${page.comment}`} page={page} displayRows={displayRows} label={`Solution ${index + 1}`} />)}
          </div>
        </section>)}
      </div>
      {pages.length > 200 ? <p className="sfinder-result-limit">Showing the first 200 of {pages.length} pages.</p> : null}
    </> : pages.length ? <>
      <div className="sfinder-result-grid">
        {shownPages.map((page, index) => <SolutionCanvas key={`${index}-${page.comment}`} page={page} displayRows={displayRows} label={page.comment || `Solution ${index + 1}`} />)}
      </div>
      {pages.length > 200 ? <p className="sfinder-result-limit">Showing the first 200 of {pages.length} pages.</p> : null}
    </> : null}
    {result.fumen ? <ResultFumen value={result.fumen} /> : null}
  </section>;
}

export function SfinderCommandApp({ command }: { command: SfinderCommandDefinition }) {
  const [lineGroup, setLineGroup] = useState<CommandLineGroup>("2-4");
  const [targetLines, setTargetLines] = useState<CommandTargetLines>(4);
  const [field, setField] = useState<CommandField>(createEmptyCommandField);
  const [paintColor, setPaintColor] = useState<CommandCell>("X");
  const [fumen, setFumen] = useState("");
  const [pattern, setPattern] = useState("");
  const [wantedSave, setWantedSave] = useState(() => defaultWantedSave(command.id));
  const [title, setTitle] = useState("");
  const [useHold, setUseHold] = useState(true);
  const [useHiGHSMode, setUseHiGHSMode] = useState<HiGHSMode>("auto");
  const [humanQualityMode, setHumanQualityMode] = useState<HumanQualityMode>(() => defaultHumanQualityMode(command.id));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [blueGarbage, setBlueGarbage] = useState(false);
  const [warmup, setWarmup] = useState<WarmupState>("loading");
  const [view, setView] = useState<ResultView>({ status: "idle" });
  const [finishedDurationMs, setFinishedDurationMs] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<SolverWorkerClient | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  const drawing = useRef(false);
  const paintValue = useRef<CommandCell | null>("X");
  const displayRows = commandDisplayRows(lineGroup);
  const isBatch = BATCH_COMMANDS.has(command.id);
  const isAdaptiveMinimals = isAdaptiveMinimalsCommand(command.id);
  const supportsColoredDrawing = COLORED_DRAWING_COMMANDS.has(command.id);

  useEffect(() => {
    setUseHiGHSMode("auto");
    setHumanQualityMode(defaultHumanQualityMode(command.id));
    setAdvancedOpen(false);
    setPaintColor("X");
  }, [command.id]);

  useEffect(() => {
    if (canvasRef.current) drawCommandField(canvasRef.current, field, displayRows);
  }, [displayRows, field]);

  useEffect(() => {
    const client = isBatch ? createBatchWorkerClient() : new SolverWorkerClient(viteWorkerFactory);
    workerRef.current = client;
    return () => {
      requestAbort.current?.abort();
      if (workerRef.current === client) workerRef.current = null;
      client.dispose();
    };
  }, [isBatch]);

  useEffect(() => {
    const client = workerRef.current;
    if (!client) return;
    const controller = new AbortController();
    let active = true;
    setWarmup("loading");
    void client.request("warmup", { targetLines, clear: targetLines }, { signal: controller.signal })
      .then(() => { if (active) setWarmup("ready"); })
      .catch((reason) => {
        if (active && !(reason instanceof Error && reason.name === "AbortError")) setWarmup("error");
      });
    return () => { active = false; controller.abort(); };
  }, [isBatch, targetLines]);

  useEffect(() => {
    requestAbort.current?.abort();
    setView({ status: "idle" });
    setFinishedDurationMs(null);
  }, [command.id, field, fumen, pattern, targetLines, wantedSave, title, useHold, useHiGHSMode, humanQualityMode, mirror, blueGarbage]);

  const paintCell = useCallback((event: ReactPointerEvent<HTMLCanvasElement>, value: CommandCell | null) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / COMMAND_FIELD_WIDTH));
    const screenY = Math.floor((event.clientY - rect.top) / (rect.height / displayRows));
    const y = displayRows - 1 - screenY;
    if (x < 0 || x >= COMMAND_FIELD_WIDTH || y < 0 || y >= displayRows) return;
    if (fumen) setFumen("");
    setField((current) => {
      if (current[y]?.[x] === value) return current;
      const next = current.map((row) => [...row]);
      next[y]![x] = value;
      return next;
    });
  }, [displayRows, fumen, paintColor]);

  function beginPaint(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / COMMAND_FIELD_WIDTH));
    const screenY = Math.floor((event.clientY - rect.top) / (rect.height / displayRows));
    const y = displayRows - 1 - screenY;
    if (x < 0 || x >= COMMAND_FIELD_WIDTH || y < 0 || y >= displayRows) return;
    drawing.current = true;
    paintValue.current = event.button === 2 || field[y]?.[x] === paintColor ? null : paintColor;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintCell(event, paintValue.current);
  }

  function applyFumen(): void {
    try {
      setField(fieldFromFumen(fumen, displayRows));
      setView({ status: "idle" });
    } catch (reason) {
      setView({ status: "error", message: reason instanceof Error ? reason.message : "Invalid Fumen." });
    }
  }

  function changeGroup(group: CommandLineGroup): void {
    requestAbort.current?.abort();
    setLineGroup(group);
    setTargetLines(defaultTargetLines(group));
    setField(createEmptyCommandField());
    setFumen("");
  }

  async function runCommand(): Promise<void> {
    const client = workerRef.current;
    if (!client || warmup !== "ready" || !pattern.trim()) return;
    const controller = new AbortController();
    requestAbort.current?.abort();
    requestAbort.current = controller;
    setView({ status: "loading" });
    setFinishedDurationMs(null);
    const startedAt = performance.now();
    try {
      const sourceFumen = normalizeCommandSource({ fumen, field, targetLines, displayRows });
      const value = await client.request<ResultRecord>(commandWorkerKind(command.id), {
        sourceFumen,
        pattern: normalizeSfinderQueuePattern(pattern),
        clear: targetLines,
        targetLines,
        wantedSave,
        title,
        useHold,
        ...minimumCoverWorkerOptions(command.id, useHiGHSMode, humanQualityMode),
        mode: "normal",
        mirror,
        blueGarbage,
      }, { signal: controller.signal });
      setView({ status: "ready", value });
      setFinishedDurationMs(performance.now() - startedAt);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setView({ status: "error", message: reason instanceof Error ? reason.message : "Calculation failed." });
    } finally {
      if (requestAbort.current === controller) requestAbort.current = null;
    }
  }

  return <>
    <SiteHeader active="sfinder" sfinderCommand={command.id} />
    <main className="sfinder-command-shell" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
      <header className="sfinder-command-heading"><h1>{command.label}</h1><p>{command.summary}</p></header>
      <nav className="sfinder-line-modes" aria-label="Line-mode group">
        {(["2-4", "5-6"] as const).map((group) => <button key={group} type="button" className={lineGroup === group ? "selected" : undefined} aria-pressed={lineGroup === group} onClick={() => changeGroup(group)}>{group}L Mode</button>)}
      </nav>
      <section className="sfinder-command-workspace">
        <div className="sfinder-field-panel">
          <div className="sfinder-panel-heading"><button type="button" onClick={() => { setField(createEmptyCommandField()); setFumen(""); }}>Clear</button></div>
          {supportsColoredDrawing ? <div className="sfinder-color-palette" role="toolbar" aria-label="Drawing color">
            {COMMAND_PAINT_OPTIONS.map(({ value, label }) => <button
              key={value}
              type="button"
              className={paintColor === value ? "selected" : undefined}
              aria-pressed={paintColor === value}
              onClick={() => setPaintColor(value)}
            ><span className={`sfinder-color-swatch sfinder-color-${value.toLowerCase()}`} aria-hidden="true" />{label}</button>)}
          </div> : null}
          <canvas ref={canvasRef} aria-label={`Editable 10-column by ${displayRows}-row field`} onContextMenu={(event) => event.preventDefault()} onPointerDown={beginPaint} onPointerMove={(event) => { if (drawing.current) paintCell(event, paintValue.current); }} onPointerUp={(event) => { drawing.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drawing.current = false; }} />
          <label className="sfinder-fumen-input"><span>Fumen</span><textarea value={fumen} placeholder="v115@… or Fumen URL" spellCheck={false} onChange={(event) => setFumen(event.target.value)} /></label>
          <button type="button" className="sfinder-apply-fumen" onClick={applyFumen}>Apply Fumen</button>
        </div>
        <form className="sfinder-command-form" onSubmit={(event) => { event.preventDefault(); void runCommand(); }}>
          <div className="sfinder-form-grid">
            <label className="sfinder-queue-input"><span>{command.patternLabel ?? "Queue"}</span><input value={pattern} placeholder={command.patternPlaceholder ?? "[TILJS]!"} spellCheck={false} onChange={(event) => setPattern(event.target.value)} /><small>Bag order: <code>*!{"{O>T}"}</code> means O before T.</small></label>
            <label className="sfinder-target-input"><span>Lines</span><input
              type="number"
              inputMode="numeric"
              min={commandTargetOptions(lineGroup)[0]}
              max={commandTargetOptions(lineGroup).at(-1)}
              step={1}
              value={targetLines}
              onChange={(event) => {
                const lines = Number(event.target.value) as CommandTargetLines;
                if (commandTargetOptions(lineGroup).includes(lines)) setTargetLines(lines);
              }}
            /></label>
            {(command.id === "saves" || command.id === "minimals") ? <label className="sfinder-save-input"><span>Saves</span><input value={wantedSave} placeholder="T || I" spellCheck={false} onChange={(event) => setWantedSave(event.target.value)} /></label> : null}
            {(command.id === "minimals" || command.id === "per_save_minimals") ? <label className="sfinder-wide-input"><span>Result title</span><input value={title} placeholder="Optional title" onChange={(event) => setTitle(event.target.value)} /></label> : null}
            <div className="sfinder-runtime-options">
              <label className="sfinder-checkbox-input"><input type="checkbox" checked={useHold} onChange={(event) => setUseHold(event.target.checked)} /><span>Use hold</span></label>
              {isAdaptiveMinimals ? <button
                type="button"
                className="sfinder-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="sfinder-advanced-settings"
                onClick={() => setAdvancedOpen((open) => !open)}
              >Advanced <span aria-hidden="true">▾</span></button> : null}
            </div>
            {isAdaptiveMinimals && advancedOpen ? <div className="sfinder-advanced-panel" id="sfinder-advanced-settings" aria-label="Advanced minimum-cover settings">
                <label className="sfinder-option-input"><span>HiGHS</span><select value={useHiGHSMode} onChange={(event) => setUseHiGHSMode(event.target.value as HiGHSMode)}>
                  <option value="auto">Auto</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select></label>
                <label className="sfinder-option-input"><span>Quality</span><select value={humanQualityMode} onChange={(event) => setHumanQualityMode(event.target.value as HumanQualityMode)}>
                  <option value="Fast">Fast</option>
                  <option value="True">Exact</option>
                </select></label>
              </div> : null}
            {(command.id === "cover" || command.id === "congruent_cover") ? <label className="sfinder-checkbox-input"><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} /><span>Mirror</span></label> : null}
            {(command.id === "congruent" || command.id === "congruent_cover") ? <label className="sfinder-checkbox-input"><input type="checkbox" checked={blueGarbage} onChange={(event) => setBlueGarbage(event.target.checked)} /><span>Blue garbage</span></label> : null}
          </div>
          <div className="sfinder-command-action">
            <button type="submit" className="sfinder-run-command" disabled={warmup !== "ready" || view.status === "loading" || !pattern.trim()}>{view.status === "loading" ? "Calculating…" : `Run ${command.label}`}</button>
            {finishedDurationMs !== null
              ? <small className="sfinder-finished-time" role="status">finished. {formatCalculationDuration(finishedDurationMs)}.</small>
              : null}
          </div>
        </form>
      </section>
      <ResultPanel view={view} displayRows={displayRows} commandId={command.id} />
    </main>
  </>;
}
