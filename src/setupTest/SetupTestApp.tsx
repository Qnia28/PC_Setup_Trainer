import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GameSession } from "../engine/game";
import { normalizePieceNotationForDisplay } from "../engine/pieceDisplay";
import type { Board, Cycle, GameAction, Piece } from "../engine/types";
import { releaseGameplayButtonFocus } from "../input/buttonFocus";
import { InputController } from "../input/controller";
import { SettingsPanel } from "../input/SettingsPanel";
import { loadInputSettings, saveInputSettings } from "../input/settings";
import { drawBoardViewport, drawPiecePreview, drawSetupPreview } from "../render/canvas";
import { oqbContinuationCandidates, resolveOqbProgress, type Cycle5AdvancedOqbPolicySource, type OqbProgressResult } from "../setups/oqbProgress";
import { promotedOqbProgressProvider } from "../setups/promotedOqbProgressProvider";
import type { SetupCandidate, SetupQuery } from "../setups/query";
import type { SelectedRecommendationScope } from "../setups/recommendationScope";
import {
  RecommendationRequestCancelled,
  RecommendationWorkerSlot,
  type RecommendationWorkerTask,
} from "../setups/recommendationWorkerClient";
import type { SetupVariant } from "../setups/schema";
import {
  buildReplaySetupRecommendationResult,
  type ReplaySetupRecommendationResult,
} from "../replay/setupRecommendations";
import { matchesSnapshotExitBinding } from "../replay/snapshotShortcut";
import {
  DEFAULT_SETUP_TEST_QUEUES,
  parseSetupTestQueue,
  setupTestBagSegments,
} from "./queueInput";
import {
  fetchDraftSetupTestCatalogs,
  loadSetupTestCatalog,
  promotedSetupTestCatalogs,
  setupTestRecommendationBundle,
  type SetupTestCatalogDescriptor,
} from "./catalogSources";
import {
  catalogsForCycle,
  defaultCatalogIdsForCycle,
  toggleCatalogSelection,
} from "./catalogSelection";
import {
  oqbProgressObservationText,
  type OqbPracticeFollowup,
  selectedCatalogOqbPlanId,
  selectedCatalogOqbSource,
  setupGuideForOqbProgress,
  updateOqbPracticeFollowup,
} from "./oqbPractice";
import { createSetupTestPracticeState, setupQueryFromPracticeState } from "./practice";

type RecommendationState =
  | { status: "idle" | "loading"; result?: ReplaySetupRecommendationResult }
  | { status: "error"; message: string }
  | { status: "ready"; result: ReplaySetupRecommendationResult };

interface LoadedCatalogBundle {
  descriptor: SetupTestCatalogDescriptor;
  catalog: SetupVariant[];
  policy: unknown;
}

type CatalogState =
  | { status: "idle" }
  | { status: "loading"; ids: string[] }
  | { status: "error"; message: string }
  | { status: "ready"; ids: string[]; bundles: LoadedCatalogBundle[] };

interface PracticeRecommendationContext {
  initialCandidate: SetupCandidate;
  initialQuery: SetupQuery;
  planId?: string;
  policyOverride?: Cycle5AdvancedOqbPolicySource;
}

const INITIAL_CATALOG_ID = promotedSetupTestCatalogs.find(({ setupPath }) =>
  setupPath === "cycle-4-no-ilij-setups.json")?.id
  ?? promotedSetupTestCatalogs.find(({ cycle }) => cycle === 4)?.id
  ?? promotedSetupTestCatalogs[0]?.id
  ?? "";

function SetupPreview({ setup }: { setup: SetupVariant }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSetupPreview(ref.current, setup);
  }, [setup]);
  return <canvas
    ref={ref}
    className="replay-setup-preview"
    aria-label={`${normalizePieceNotationForDisplay(setup.displayName)} setup shape`}
  />;
}

function PiecePreview({ piece, label }: { piece: Piece | null; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawPiecePreview(ref.current, piece); }, [piece]);
  return <div className="setup-test-piece-preview">
    {label && <span>{label}</span>}
    <canvas ref={ref} aria-label={piece ?? "empty"} />
  </div>;
}

function canonicalSetupId(setup: SetupVariant): string {
  return (setup.policySourceId ?? setup.id).split("--box-")[0]!.replace(/--mirror$/, "");
}

function setupTargetCompleted(board: Board, setup: SetupVariant): boolean {
  return setup.placements.every((placement) => placement.cells.every(({ x, y }) =>
    board[y]?.[x] === placement.piece));
}

export function SetupTestApp() {
  const [cycle, setCycle] = useState<Cycle>(4);
  const [groups, setGroups] = useState<string[]>(DEFAULT_SETUP_TEST_QUEUES[4]);
  const [holdOccupied, setHoldOccupied] = useState(true);
  const [draftCatalogs, setDraftCatalogs] = useState<SetupTestCatalogDescriptor[]>([]);
  const [catalogIds, setCatalogIds] = useState<string[]>(INITIAL_CATALOG_ID ? [INITIAL_CATALOG_ID] : []);
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: "idle" });
  const [state, setState] = useState<RecommendationState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [practiceSession, setPracticeSession] = useState<GameSession | null>(null);
  const [practiceContext, setPracticeContext] = useState<PracticeRecommendationContext | null>(null);
  const [practiceContinuationId, setPracticeContinuationId] = useState<string | null>(null);
  const [practiceFollowup, setPracticeFollowup] = useState<OqbPracticeFollowup | null>(null);
  const [practiceRevision, setPracticeRevision] = useState(0);
  const [practiceError, setPracticeError] = useState("");
  const [settings, setSettings] = useState(loadInputSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const practiceBoard = useRef<HTMLCanvasElement>(null);
  const worker = useRef<RecommendationWorkerSlot | null>(null);
  const activeTask = useRef<RecommendationWorkerTask | null>(null);
  const generation = useRef(0);
  const catalogGeneration = useRef(0);
  if (!worker.current) worker.current = new RecommendationWorkerSlot();

  const catalogs = useMemo(() => [...promotedSetupTestCatalogs, ...draftCatalogs], [draftCatalogs]);
  const cycleCatalogs = useMemo(() => catalogsForCycle(catalogs, cycle), [catalogs, cycle]);
  const selectedCatalogs = useMemo(() => {
    const ids = new Set(catalogIds);
    return cycleCatalogs.filter(({ id }) => ids.has(id));
  }, [catalogIds, cycleCatalogs]);
  const catalogSelectionKey = selectedCatalogs.map(({ id }) => id).join("\u0000");
  const practiceState = practiceSession?.state ?? null;
  const segments = setupTestBagSegments(cycle);
  const result = state.status === "ready" || state.status === "loading" ? state.result : undefined;
  const selected: SetupCandidate | null = useMemo(() =>
    result?.candidates.find(({ setup }) => setup.id === selectedId) ?? null,
  [result, selectedId]);
  const practiceProgress: OqbProgressResult | undefined = useMemo(() => {
    if (!practiceState || !practiceContext) return undefined;
    if (practiceContext.initialCandidate.qbCondition === undefined
      && practiceContext.initialQuery.cycle !== 3) return undefined;
    try {
      return resolveOqbProgress({
        selectedCandidate: practiceContext.initialCandidate,
        query: setupQueryFromPracticeState(practiceState),
        planId: practiceContext.planId,
        policyOverride: practiceContext.policyOverride,
        policyProvider: promotedOqbProgressProvider,
      });
    } catch (reason) {
      return {
        status: "unresolved",
        cycle: practiceState.run.cycle,
        reason: "invalid-selected-policy",
        instruction: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [practiceContext, practiceRevision, practiceState]);
  const lockedPracticePieces = practiceState?.run.piecesLockedSinceLastPc ?? 0;
  const retainedFollowup = practiceFollowup
    && lockedPracticePieces >= practiceFollowup.progress.progress.checkpointPlacements
    ? practiceFollowup
    : null;
  const displayedPracticeProgress = retainedFollowup?.progress ?? practiceProgress;
  const practiceContinuations = retainedFollowup?.candidates
    ?? (practiceProgress ? oqbContinuationCandidates(practiceProgress) : []);
  const selectedContinuation = practiceContinuations.find(({ setup }) =>
    setup.id === practiceContinuationId) ?? practiceContinuations[0] ?? null;
  const practiceGuide = practiceContext && displayedPracticeProgress
    ? setupGuideForOqbProgress(
      practiceContext.initialCandidate,
      displayedPracticeProgress,
      selectedContinuation?.setup,
    )
    : selected?.setup ?? null;
  const displayedResult = practiceState && practiceContinuations.length > 0
    ? {
      ...buildReplaySetupRecommendationResult(
        setupQueryFromPracticeState(practiceState),
        practiceContinuations,
      ),
      contextLabel: "OQB Follow-up",
    }
    : result;
  const displayedSelected = selectedContinuation ?? selected;
  const displayedSelectedId = selectedContinuation?.setup.id ?? selectedId;

  useEffect(() => {
    setPracticeFollowup((current) =>
      updateOqbPracticeFollowup(current, practiceProgress, lockedPracticePieces));
  }, [lockedPracticePieces, practiceProgress]);

  useEffect(() => {
    if (!practiceState || !practiceContext || !selectedContinuation
      || !setupTargetCompleted(practiceState.board, selectedContinuation.setup)) return;
    try {
      const nested = resolveOqbProgress({
        selectedCandidate: selectedContinuation,
        query: setupQueryFromPracticeState(practiceState),
        planId: practiceContext.planId,
        policyOverride: practiceContext.policyOverride,
        policyProvider: promotedOqbProgressProvider,
      });
      if (nested.status !== "continuation"
        || nested.branchId === practiceFollowup?.progress.branchId) return;
      setPracticeFollowup({ progress: nested, candidates: oqbContinuationCandidates(nested) });
      setPracticeContinuationId(null);
    } catch (reason) {
      setPracticeError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [practiceContext, practiceFollowup?.progress.branchId, practiceRevision, practiceState, selectedContinuation]);

  useEffect(() => {
    let active = true;
    void fetchDraftSetupTestCatalogs()
      .then((descriptors) => { if (active) setDraftCatalogs(descriptors); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const descriptors = selectedCatalogs;
    if (descriptors.length === 0) {
      catalogGeneration.current += 1;
      setCatalogState({ status: "idle" });
      return;
    }
    const loadGeneration = ++catalogGeneration.current;
    generation.current += 1;
    activeTask.current?.cancel();
    setSelectedId(null);
    setState({ status: "idle" });
    setCatalogState({ status: "loading", ids: descriptors.map(({ id }) => id) });
    void Promise.all(descriptors.map(async (descriptor): Promise<LoadedCatalogBundle> => ({
      descriptor,
      ...await loadSetupTestCatalog(descriptor),
    }))).then((bundles) => {
      if (catalogGeneration.current !== loadGeneration) return;
      setCatalogState({ status: "ready", ids: descriptors.map(({ id }) => id), bundles });
    }).catch((reason) => {
      if (catalogGeneration.current !== loadGeneration) return;
      setCatalogState({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
    });
  }, [catalogSelectionKey]);

  useEffect(() => () => {
    generation.current += 1;
    activeTask.current?.cancel();
    activeTask.current = null;
    worker.current?.dispose();
  }, []);

  const exitPractice = useCallback(() => {
    setPracticeSession(null);
    setPracticeContext(null);
    setPracticeContinuationId(null);
    setPracticeFollowup(null);
    setPracticeError("");
  }, []);

  const dispatchPractice = useCallback((action: GameAction): boolean => {
    if (!practiceSession) return false;
    const pcCount = practiceSession.state.run.pcCount;
    const changed = practiceSession.dispatch(action);
    if (practiceSession.state.run.status === "failed" || practiceSession.state.run.pcCount > pcCount) {
      practiceSession.restart();
    }
    if (changed) setPracticeRevision((revision) => revision + 1);
    return changed;
  }, [practiceSession]);

  useEffect(() => {
    if (!practiceBoard.current || !practiceSession) return;
    drawBoardViewport(practiceBoard.current, practiceSession.state, practiceGuide, true, 8, 36);
  }, [practiceGuide, practiceRevision, practiceSession]);

  useEffect(() => {
    if (!practiceSession || settingsOpen) return;
    const controller = new InputController(dispatchPractice, settings);
    return () => controller.destroy();
  }, [dispatchPractice, practiceSession, settings, settingsOpen]);

  useEffect(() => {
    if (!practiceSession || settingsOpen) return;
    function handlePracticeExit(event: KeyboardEvent) {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, button, select, textarea")) return;
      if (!matchesSnapshotExitBinding(settings.bindings.exitSnapshot, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exitPractice();
    }
    window.addEventListener("keydown", handlePracticeExit);
    return () => window.removeEventListener("keydown", handlePracticeExit);
  }, [exitPractice, practiceSession, settings.bindings.exitSnapshot, settingsOpen]);

  useEffect(() => { saveInputSettings(settings); }, [settings]);

  function resetCycleInput(nextCycle: Cycle) {
    generation.current += 1;
    activeTask.current?.cancel();
    setCycle(nextCycle);
    const nextGroups = DEFAULT_SETUP_TEST_QUEUES[nextCycle];
    const nextHoldOccupied = nextCycle !== 1;
    setGroups(nextGroups);
    setHoldOccupied(nextHoldOccupied);
    setSelectedId(null);
    setState({ status: "idle" });
  }

  function changeCycle(value: string) {
    const nextCycle = Number(value) as Cycle;
    resetCycleInput(nextCycle);
    setCatalogIds(defaultCatalogIdsForCycle(catalogs, nextCycle));
  }

  function changeCatalog(catalogId: string, checked: boolean) {
    generation.current += 1;
    activeTask.current?.cancel();
    setCatalogIds((current) => toggleCatalogSelection(current, catalogId, checked));
    setSelectedId(null);
    setState({ status: "idle" });
  }

  function updateGroup(index: number, value: string) {
    setGroups((current) => current.map((group, groupIndex) =>
      groupIndex === index ? value.toUpperCase() : group));
  }

  function parseCurrentInput() {
    return parseSetupTestQueue(cycle, groups, holdOccupied);
  }

  function togglePractice() {
    if (practiceSession) {
      exitPractice();
      return;
    }
    try {
      const parsed = parseCurrentInput();
      const initial = createSetupTestPracticeState(parsed);
      const selectedSourceId = selected ? canonicalSetupId(selected.setup) : null;
      const sourceBundle = catalogState.status === "ready"
        ? catalogState.bundles.find(({ descriptor }) =>
          descriptor.id === selected?.recommendationSource?.bundleId)
          ?? (selectedSourceId
            ? catalogState.bundles.find(({ catalog }) => catalog.some((setup) =>
              canonicalSetupId(setup) === selectedSourceId))
            : undefined)
        : undefined;
      const policyOverride = sourceBundle
        ? selectedCatalogOqbSource(
          sourceBundle.policy,
          sourceBundle.catalog,
          sourceBundle.descriptor.id,
        )
        : undefined;
      const planId = selected && policyOverride
        ? selectedCatalogOqbPlanId(policyOverride, selected, parsed.input)
        : selected?.policy?.ruleId;
      setPracticeError("");
      setPracticeContext(selected ? {
        initialCandidate: selected,
        initialQuery: parsed.input,
        planId,
        policyOverride,
      } : null);
      setPracticeContinuationId(null);
      setPracticeFollowup(null);
      setPracticeSession(new GameSession(initial));
      setPracticeRevision((revision) => revision + 1);
    } catch (reason) {
      setPracticeError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let parsed: ReturnType<typeof parseSetupTestQueue>;
    let scope: SelectedRecommendationScope;
    try {
      parsed = parseCurrentInput();
      if (catalogIds.length === 0) throw new Error("Select at least one setup data bundle.");
      if (catalogState.status !== "ready"
        || catalogState.ids.join("\u0000") !== catalogSelectionKey) {
        throw new Error(catalogState.status === "error" ? catalogState.message : "The selected catalogs are still loading.");
      }
      scope = {
        mode: "selected-bundles",
        bundles: catalogState.bundles.map(({ descriptor, catalog, policy }) =>
          setupTestRecommendationBundle(descriptor, { catalog, policy })),
      };
    } catch (reason) {
      setSelectedId(null);
      setState({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }

    const requestGeneration = ++generation.current;
    const previous = activeTask.current;
    previous?.cancel();
    setSelectedId(null);
    setState({ status: "loading" });
    if (previous) await previous.done.catch(() => undefined);
    if (generation.current !== requestGeneration) return;

    const task = worker.current!.start(parsed.input, (stage) => {
      if (generation.current !== requestGeneration) return;
      const displayedCandidates = stage.candidates;
      const nextResult = buildReplaySetupRecommendationResult(parsed.input, displayedCandidates);
      setSelectedId((current) => current && displayedCandidates.some(({ setup }) => setup.id === current)
        ? current
        : stage.preferredCandidateId ?? displayedCandidates.find(candidate => candidate.autoSelect !== false)?.setup.id ?? null);
      setState(stage.complete
        ? { status: "ready", result: nextResult }
        : { status: "loading", result: nextResult });
    }, scope);
    activeTask.current = task;
    try {
      await task.done;
    } catch (reason) {
      if (!(reason instanceof RecommendationRequestCancelled)
        && generation.current === requestGeneration) {
        setState({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
      }
    } finally {
      if (activeTask.current === task) activeTask.current = null;
    }
  }

  let queueSummary = "";
  try {
    const parsed = parseCurrentInput();
    queueSummary = `${parsed.input.hold ? `HOLD ${parsed.input.hold} · ` : "HOLD empty · "}ACTIVE ${parsed.input.active} · NEXT ${parsed.input.next.join("")}`;
  } catch {
    // Validation details are shown after submitting the form.
  }

  return <main className="setup-test-shell" onPointerUpCapture={releaseGameplayButtonFocus}>
    <header className="setup-test-header">
      <span>INTERNAL TOOL</span>
      <h1>Setup Recommendation Test</h1>
      <p>Inspect the same setup recommendations used by the game and Replay Viewer.</p>
    </header>

    <form className="setup-test-form" onSubmit={submit}>
      <fieldset className="setup-test-database" disabled={practiceSession !== null}>
        <legend>Recommendation data bundles</legend>
        <div className="setup-test-database-summary">
          <span>The main-game recommendation policy runs only against checked sources.</span>
          <strong>{catalogIds.length} selected</strong>
        </div>
        <div className="setup-test-catalog-groups">
          {(["promoted", "draft"] as const).map((group) => {
            const options = cycleCatalogs.filter((catalog) => catalog.group === group);
            return <section className="setup-test-catalog-group" key={group}>
              <h2>{group === "promoted" ? "Promoted data · setups" : "Draft data · querieddata"} ({options.length})</h2>
              {options.length > 0 ? <div className="setup-test-catalog-options">
                {options.map((catalog) => <label className="setup-test-catalog-option" key={catalog.id}>
                  <input
                    type="checkbox"
                    checked={catalogIds.includes(catalog.id)}
                    onChange={(event) => changeCatalog(catalog.id, event.target.checked)}
                  />
                  <span title={catalog.label}>{catalog.label}</span>
                  <small>{catalog.variant}</small>
                </label>)}
              </div> : <p className="setup-test-catalog-empty">No Cycle {cycle} sources</p>}
            </section>;
          })}
        </div>
        <div className="setup-test-database-summary">
          <span>{catalogState.status === "loading"
            ? "Loading selected files…"
            : catalogState.status === "ready"
              ? `${catalogState.bundles.reduce((total, bundle) => total + bundle.catalog.length, 0)} searchable runtime geometries loaded`
              : catalogState.status === "error" ? catalogState.message : "Select one or more sources."}</span>
        </div>
      </fieldset>
      <label className="setup-test-cycle">Cycle
        <select value={cycle} disabled={practiceSession !== null} onChange={(event) => changeCycle(event.target.value)}>
          {[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>Cycle {value}</option>)}
        </select>
      </label>
      <div className="setup-test-bags">
        {segments.map((segment, index) => <label key={`${cycle}-${segment.label}`}>
          {segment.label}<small>{segment.length} pieces</small>
          <input
            value={groups[index] ?? ""}
            disabled={practiceSession !== null}
            onChange={(event) => updateGroup(index, event.target.value)}
            aria-label={`${segment.label}, ${segment.length} pieces`}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>)}
      </div>
      <label className="setup-test-hold">
        <input
          type="checkbox"
          checked={holdOccupied}
          disabled={practiceSession !== null}
          onChange={(event) => setHoldOccupied(event.target.checked)}
        />
        First piece is HOLD
      </label>
      <div className="setup-test-actions">
        <button className="primary-button" type="submit" disabled={catalogState.status !== "ready"}>Run Recommendation</button>
        <button className={practiceSession ? "setup-test-practice-exit" : ""} type="button" onClick={togglePractice}>
          {practiceSession ? "Exit Practice" : "Play 0P"}
        </button>
      </div>
      <p className="setup-test-convention">With HOLD enabled, the second piece is ACTIVE. With HOLD empty, the first piece is ACTIVE.</p>
      {queueSummary && <p className="setup-test-queue-summary">{queueSummary}</p>}
    </form>

    {state.status === "error" && <div className="setup-test-error" role="alert">{state.message}</div>}
    {practiceError && <div className="setup-test-error" role="alert">{practiceError}</div>}

    {practiceState && <section className="setup-test-practice" aria-label="Playable 0P practice">
      <header>
        <div><span>0P PRACTICE</span><h2>Cycle {practiceState.run.cycle}</h2></div>
        <small>Entered queue + bag-aware random continuation</small>
      </header>
      <div className="setup-test-practice-stage">
        <aside><PiecePreview piece={practiceState.hold} label="HOLD" /></aside>
        <div className="setup-test-practice-field">
          <canvas ref={practiceBoard} aria-label="Playable 0P Tetris field, 10 columns by 8 rows" />
          <p><b>{practiceState.run.piecesLockedSinceLastPc}p</b> · {practiceState.run.message}</p>
          {displayedPracticeProgress && displayedPracticeProgress.status !== "no-follow-up" && <p
            className={`setup-test-oqb-progress status-${displayedPracticeProgress.status}`}
            role={displayedPracticeProgress.status === "unresolved" ? "alert" : undefined}
          >
            <b>{displayedPracticeProgress.status === "precondition"
              ? `OQB ${displayedPracticeProgress.progress.completedPlacements}/${displayedPracticeProgress.progress.checkpointPlacements}`
              : displayedPracticeProgress.status === "continuation" ? "OQB follow-up"
                : displayedPracticeProgress.status === "terminal" ? "OQB complete"
                  : "OQB unavailable"}</b>
            <span>{displayedPracticeProgress.instruction}</span>
            {oqbProgressObservationText(displayedPracticeProgress) && <small>{oqbProgressObservationText(displayedPracticeProgress)}</small>}
          </p>}
          <div className="setup-test-practice-controls">
            <button type="button" onClick={() => dispatchPractice("undo")}>Undo</button>
            <button type="button" onClick={() => dispatchPractice("restart")}>Restart</button>
            <button type="button" onClick={() => setSettingsOpen(true)}>Controls</button>
            <button type="button" className="setup-test-practice-exit" onClick={exitPractice}>Exit</button>
          </div>
        </div>
        <aside className="setup-test-practice-next"><span>NEXT</span>{practiceState.bag.queue.slice(0, 5).map((piece, index) =>
          <PiecePreview key={`${index}-${piece}`} piece={piece} />)}</aside>
      </div>
    </section>}

    <section className="replay-recommendations setup-test-results" aria-label="Setup recommendations">
      <article className="replay-recommendation-preview">
        {displayedSelected && displayedResult
          ? <>
            <h2>{displayedResult.labels[displayedSelected.setup.id]}</h2>
            <SetupPreview setup={displayedSelected.setup} />
            <p>{displayedResult.pcRateLabels[displayedSelected.setup.id]}</p>
          </>
          : <div className="replay-recommendation-empty">
            <h2>No Setup Selected</h2>
            <p>{state.status === "loading"
              ? "Finding buildable setups…"
              : state.status === "error"
                ? "Correct the input or retry the recommendation Worker."
                : state.status === "ready"
                  ? "No buildable setup is available for this queue."
                  : "Enter a cycle and queue, then run the recommendation."}</p>
          </div>}
      </article>
      <article className="replay-recommendation-list">
        <h2 className="replay-recommendation-context">{displayedResult?.contextLabel ?? `Cycle ${cycle}`}</h2>
        {displayedResult && <div className="replay-recommendation-sections">
          {displayedResult.sections.map((section) => <section
            key={section.kind}
            className={`replay-recommendation-group kind-${section.kind} ${section.kind === "qb" ? "qb" : ""}`}
          >
            <h2>{section.label}<small>{section.candidates.length}</small></h2>
            {section.candidates.length > 0
              ? section.candidates.map((candidate) => <button
                type="button"
                key={candidate.setup.id}
                className={displayedSelectedId === candidate.setup.id ? "selected" : ""}
                disabled={practiceSession !== null && practiceContinuations.length === 0}
                onClick={() => practiceContinuations.length > 0
                  ? setPracticeContinuationId(candidate.setup.id)
                  : setSelectedId(candidate.setup.id)}
              >{displayedResult.labels[candidate.setup.id]}</button>)
              : <p>No buildable setups</p>}
          </section>)}
        </div>}
        {!displayedResult && <p>{state.status === "loading" ? "Loading recommendations…" : "Recommendations not run"}</p>}
        {state.status === "loading" && displayedResult && <p className="setup-test-secondary-loading">Loading additional recommendation tiers…</p>}
      </article>
    </section>
    {settingsOpen && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
