import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { cloneBoard } from "./engine/board";
import { GameSession } from "./engine/game";
import { normalizePieceNotationForDisplay } from "./engine/pieceDisplay";
import { seedValidationError } from "./engine/seed";
import { PIECES, type GameAction, type GameState, type Piece } from "./engine/types";
import { InputController } from "./input/controller";
import { releaseGameplayButtonFocus } from "./input/buttonFocus";
import { createBinding, loadInputSettings, saveInputSettings } from "./input/settings";
import { SettingsPanel } from "./input/SettingsPanel";
import { drawBoard, drawPiecePreview, drawSetupPreview, drawSolutionPreview } from "./render/canvas";
import { ReplayExportDialog } from "./replay/ReplayExportDialog";
import { ReplayRecorder } from "./replay/recorder";
import type { ReplayData } from "./replay/format";
import { SiteHeader } from "./site/SiteHeader";
import { setupCoverageForCycle, type SetupCatalogCoverage } from "./setups/catalog";
import { displayCycleForQuery } from "./setups/cycle1Context";
import { cycle4ClassLabel } from "./setups/cycle4Catalog";
import { GuideUndoHistory, guideSegmentIdentity, type GuideSnapshot } from "./setups/guideHistory";
import { countSetupShadowWrongCells, shouldAutoHideSetupShadow } from "./setups/shadow";
import { splitsSetupCandidatesByPieceCount, type SetupCandidate } from "./setups/query";
import { oqbContinuationCandidates, resolveOqbProgress, type OqbProgressResult } from "./setups/oqbProgress";
import { recommendationSetupLabel } from "./setups/recommendationLabel";
import { recommendationSegmentKey } from "./setups/recommendationLifecycle";
import {
  RecommendationRequestCancelled,
  RecommendationWorkerSlot,
  type RecommendationWorkerTask,
} from "./setups/recommendationWorkerClient";
import type { SetupVariant } from "./setups/schema";
import {
  LiveSolverClient,
  formatAvailableSaves,
  perSaveOptions,
  prepareLiveSolveRequest,
  solveOneOptions,
  type LiveSolveOption,
  type PerSaveMinimalsResult,
  type SolveOneResult,
} from "./solver/liveSolver";
import {
  analyzeSolveQueue,
  formatNextBagRemainder,
  formatSolveQueueGroups,
  liveSolveSessionKey,
  predictSavedPiece,
  shouldShowLiveSolveShadow,
  solveQueueBagHistory,
  type SolveQueueAnalysis,
} from "./solver/solveQueue";
import "./styles.css";

const SETUP_SHADOW_STORAGE_KEY = "guided-pc-setup-shadow-v1";
const SOLVE_SHADOW_STORAGE_KEY = "guided-pc-solve-shadow-v1";
const SHOW_SOLVE_STORAGE_KEY = "guided-pc-show-solve-v1";

type LiveSolveView =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      options: LiveSolveOption[];
      queueAnalysis: SolveQueueAnalysis;
      calculatedLinesSinceLastPc: number;
      calculatedBoard: GameState["board"];
    }
  | { status: "none"; queueAnalysis: SolveQueueAnalysis }
  | { status: "error"; message: string };

type GuideTab = "setup" | "solve";

function useLazyRef<T>(factory: () => T): MutableRefObject<T> {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = factory();
  return ref as MutableRefObject<T>;
}

function loadSetupShadowPreference(): boolean {
  try {
    return localStorage.getItem(SETUP_SHADOW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSetupShadowPreference(showSetupShadow: boolean): void {
  try {
    localStorage.setItem(SETUP_SHADOW_STORAGE_KEY, showSetupShadow ? "on" : "off");
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
}

function PiecePreview({ piece, label }: { piece: Piece | null; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawPiecePreview(ref.current, piece); }, [piece]);
  return <div className="piece-preview">{label && <span>{label}</span>}<canvas ref={ref} aria-label={piece ?? "empty"} /></div>;
}

function SetupPreview({ setup }: { setup: SetupVariant }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSetupPreview(ref.current, setup); }, [setup]);
  return <canvas ref={ref} className="setup-preview" aria-label={`${normalizePieceNotationForDisplay(setup.displayName)}${setup.formLabel ? ` ${normalizePieceNotationForDisplay(setup.formLabel)} form` : ""} setup shape`} />;
}

function SolutionPreview({ setup, board }: { setup: SetupVariant; board: GameState["board"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSolutionPreview(ref.current, setup, board); }, [board, setup]);
  return <canvas ref={ref} className="solve-preview" aria-label={`${setup.displayName} solution field`} />;
}

function setupOptionLabel(candidate: SetupCandidate): string {
  return candidate.recommendationLabel
    ?? recommendationSetupLabel(candidate.setup.displayName, candidate.qbSaveTargets);
}

function targetCompleted(state: GameState, setup: SetupVariant): boolean {
  return setup.placements.every((placement) => placement.cells.every(({ x, y }) => state.board[y]?.[x] === placement.piece));
}

export default function App() {
  const session = useLazyRef(() => new GameSession());
  const replayRecorder = useLazyRef(() => new ReplayRecorder(session.current.placementHistory));
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revision, setRevision] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [seedInput, setSeedInput] = useState(session.current.state.seed);
  const seedInputError = seedValidationError(seedInput.trim());
  const [queueJumpInput, setQueueJumpInput] = useState("");
  const [queueJumpStatus, setQueueJumpStatus] = useState({ text: "", error: false });
  const [settings, setSettings] = useState(loadInputSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replayExport, setReplayExport] = useState<ReplayData | null>(null);
  const [showSetupShadow, setShowSetupShadow] = useState(loadSetupShadowPreference);
  const [showSolveShadow, setShowSolveShadow] = useState(() => {
    try { return localStorage.getItem(SOLVE_SHADOW_STORAGE_KEY) !== "off"; }
    catch { return true; }
  });
  const [showSolveDetails, setShowSolveDetails] = useState(() => {
    try { return localStorage.getItem(SHOW_SOLVE_STORAGE_KEY) !== "off"; }
    catch { return true; }
  });
  const [candidates, setCandidates] = useState<SetupCandidate[]>([]);
  const [recommendationLoading, setRecommendationLoading] = useState(true);
  const [recommendationError, setRecommendationError] = useState(false);
  const [recommendationRetryNonce, setRecommendationRetryNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideDone, setGuideDone] = useState(false);
  const [stagedInstruction, setStagedInstruction] = useState<string | undefined>();
  const guideState = useRef<GuideSnapshot>({ candidates: [], selectedId: null, guideDone: false, stagedInstruction: undefined });
  const guideHistory = useLazyRef(() => new GuideUndoHistory());
  const recommendationWorker = useLazyRef(() => new RecommendationWorkerSlot());
  const recommendationTask = useRef<RecommendationWorkerTask | null>(null);
  const recommendationGeneration = useRef(0);
  const restoredGuideSegment = useRef<string | null>(null);
  const liveSolver = useLazyRef(() => new LiveSolverClient());
  const liveSolveGeneration = useRef(0);
  const [liveSolveView, setLiveSolveView] = useState<LiveSolveView>({ status: "idle" });
  const [liveSolveIndex, setLiveSolveIndex] = useState(0);
  const [guideTab, setGuideTab] = useState<GuideTab>("setup");
  const [coverage, setCoverage] = useState<SetupCatalogCoverage | null>(null);
  const state = session.current.state;
  const displayCycle = displayCycleForQuery({
    cycle: state.run.cycle,
    board: state.board,
    active: state.active.piece,
    hold: state.hold,
    next: state.bag.queue,
    holdAvailable: !state.holdUsedThisTurn,
  });

  useEffect(() => {
    guideState.current = { candidates, selectedId, guideDone, stagedInstruction };
  }, [candidates, selectedId, guideDone, stagedInstruction]);

  const dispatch = useCallback((action: GameAction) => {
    const guideBeforeAction = action === "hardDrop" ? guideState.current : null;
    const changed = session.current.dispatch(action);
    if (changed) {
      if (action === "hardDrop" && guideBeforeAction) guideHistory.current.push(guideBeforeAction);
      if (action === "undo") {
        const restored = guideHistory.current.pop();
        if (restored) {
          setCandidates(restored.candidates);
          setSelectedId(restored.selectedId);
          setGuideDone(restored.guideDone);
          setStagedInstruction(restored.stagedInstruction);
          restoredGuideSegment.current = guideSegmentIdentity(session.current.state);
        }
      }
      if (action === "restart" || action === "randomSeed") {
        guideHistory.current.clear();
        restoredGuideSegment.current = null;
        setResetNonce((value) => value + 1);
      }
      if (action === "restart") setSeedInput(session.current.state.seed);
      setRevision((value) => value + 1);
    }
    return changed;
  }, []);

  useEffect(() => {
    if (settingsOpen || replayExport) return;
    const controller = new InputController(dispatch, settings);
    return () => controller.destroy();
  }, [dispatch, replayExport, settings, settingsOpen]);

  useEffect(() => { saveInputSettings(settings); }, [settings]);
  useEffect(() => { saveSetupShadowPreference(showSetupShadow); }, [showSetupShadow]);
  useEffect(() => {
    try { localStorage.setItem(SOLVE_SHADOW_STORAGE_KEY, showSolveShadow ? "on" : "off"); }
    catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }, [showSolveShadow]);
  useEffect(() => {
    try { localStorage.setItem(SHOW_SOLVE_STORAGE_KEY, showSolveDetails ? "on" : "off"); }
    catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }, [showSolveDetails]);

  const segmentKey = recommendationSegmentKey({
    seed: state.seed,
    pcCount: state.run.pcCount,
    cycle: state.run.cycle,
    resetNonce,
  });
  useEffect(() => { setGuideTab("setup"); }, [segmentKey]);
  useEffect(() => {
    const current = session.current.state;
    setCoverage(setupCoverageForCycle(current.run.cycle));
    const currentIdentity = guideSegmentIdentity(current);
    const generation = ++recommendationGeneration.current;
    const previousTask = recommendationTask.current;
    if (previousTask) previousTask.cancel();
    if (restoredGuideSegment.current === currentIdentity) {
      restoredGuideSegment.current = null;
      setRecommendationLoading(false);
      setRecommendationError(false);
      return;
    }
    restoredGuideSegment.current = null;
    const snapshot = {
      cycle: current.run.cycle,
      board: current.board.map((row) => [...row]),
      active: current.active.piece,
      hold: current.hold,
      next: [...current.bag.queue.slice(0, 5)],
      holdAvailable: true,
    };
    setCandidates([]);
    setSelectedId(null);
    setRecommendationLoading(true);
    setRecommendationError(false);
    setGuideDone(false);
    setStagedInstruction(undefined);
    const launch = () => {
      if (recommendationGeneration.current !== generation) return;
      const task = recommendationWorker.current.start(snapshot, (result) => {
        if (recommendationGeneration.current !== generation) return;
        setRecommendationError(false);
        setCandidates(result.candidates);
        if (result.stage === "primary") {
          setRecommendationLoading(false);
          setSelectedId(result.preferredCandidateId);
        }
        else setSelectedId((selected) => selected && result.candidates.some(({ setup }) => setup.id === selected)
          ? selected
          : result.preferredCandidateId);
      });
      recommendationTask.current = task;
      void task.done.catch((reason) => {
        if (!(reason instanceof RecommendationRequestCancelled)
          && recommendationGeneration.current === generation) {
          setRecommendationLoading(false);
          setRecommendationError(true);
          console.error(reason);
        }
      }).finally(() => {
        if (recommendationTask.current?.requestId === task.requestId) recommendationTask.current = null;
      });
    };
    if (previousTask) void previousTask.done.catch(() => undefined).finally(launch);
    else launch();
  }, [segmentKey, recommendationRetryNonce]);

  useEffect(() => () => {
    recommendationGeneration.current += 1;
    recommendationTask.current?.cancel();
    recommendationTask.current = null;
    recommendationWorker.current.dispose();
  }, []);

  const selectedCandidate = useMemo(() => candidates.find(({ setup }) => setup.id === selectedId) ?? null, [candidates, selectedId]);
  const selected = selectedCandidate?.setup ?? null;
  const liveSolvePreparation = useMemo(() => prepareLiveSolveRequest({
    board: state.board,
    active: state.active.piece,
    hold: state.hold,
    next: state.bag.queue,
    piecesLockedSinceLastPc: state.run.piecesLockedSinceLastPc,
    linesSinceLastPc: state.run.linesSinceLastPc,
  }), [
    state.active.piece,
    state.bag.queue,
    state.board,
    state.hold,
    state.run.linesSinceLastPc,
    state.run.piecesLockedSinceLastPc,
  ]);
  const liveSolveResetKey = liveSolveSessionKey(state, selectedId, resetNonce);
  useEffect(() => {
    liveSolveGeneration.current += 1;
    liveSolver.current.cancel();
    setLiveSolveView({ status: "idle" });
    setLiveSolveIndex(0);
  }, [liveSolveResetKey]);
  useEffect(() => () => liveSolver.current.dispose(), []);

  const calculateLiveSolve = useCallback(() => {
    if (!liveSolvePreparation.ready) return;
    const generation = ++liveSolveGeneration.current;
    liveSolver.current.cancel();
    setLiveSolveView({ status: "loading" });
    setLiveSolveIndex(0);
    const { request } = liveSolvePreparation;
    const solveState = session.current.state;
    const calculatedLinesSinceLastPc = solveState.run.linesSinceLastPc;
    const calculatedBoard = cloneBoard(solveState.board);
    const queueAnalysis = analyzeSolveQueue(
      request.input.pattern,
      solveState.run.cycle,
      solveQueueBagHistory(session.current.placementHistory, solveState),
    );
    const pending = request.kind === "per-save-minimals"
      ? liveSolver.current.request<PerSaveMinimalsResult>(request)
          .then((result) => perSaveOptions(result, solveState.run.cycle))
      : liveSolver.current.request<SolveOneResult>(request)
          .then((result) => solveOneOptions(result, solveState.run.cycle));
    void pending.then((options) => {
      if (liveSolveGeneration.current !== generation) return;
      setLiveSolveView(options.length > 0
        ? { status: "ready", options, queueAnalysis, calculatedLinesSinceLastPc, calculatedBoard }
        : { status: "none", queueAnalysis });
    }).catch((reason) => {
      if (liveSolveGeneration.current !== generation || reason instanceof DOMException && reason.name === "AbortError") return;
      setLiveSolveView({ status: "error", message: reason instanceof Error ? reason.message : "Solve failed." });
    });
  }, [liveSolvePreparation]);

  useEffect(() => {
    if (settingsOpen || replayExport) return;
    const onSeeSolve = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || target?.closest("input, button, select, textarea")) return;
      const configured = settings.bindings.seeSolve;
      const pressed = createBinding(event.code, event);
      if (configured !== pressed && configured !== event.code) return;
      event.preventDefault();
      setGuideTab("solve");
      calculateLiveSolve();
    };
    window.addEventListener("keydown", onSeeSolve);
    return () => window.removeEventListener("keydown", onSeeSolve);
  }, [calculateLiveSolve, replayExport, settings.bindings.seeSolve, settingsOpen]);

  const liveSolveOption = liveSolveView.status === "ready"
    ? liveSolveView.options[liveSolveIndex] ?? null
    : null;
  const liveSolveAvailableSaves = liveSolveView.status === "ready"
    ? formatAvailableSaves(liveSolveView.options)
    : null;
  const liveSolvePrediction = liveSolveView.status === "ready" && liveSolveOption?.save
    ? predictSavedPiece(liveSolveView.queueAnalysis, liveSolveOption.save)
    : null;
  const splitCandidateSections = splitsSetupCandidatesByPieceCount(state.run.cycle);
  const qbCandidates = useMemo(() => candidates.filter(({ qbCondition }) => qbCondition !== undefined), [candidates]);
  const showQbCandidateSection = state.run.cycle === 7 || qbCandidates.length > 0;
  const showCategorizedCandidates = splitCandidateSections || showQbCandidateSection;
  const candidateSections = useMemo(() => {
    if (!showCategorizedCandidates) return [];
    const standardCandidates = candidates.filter(({ qbCondition }) => qbCondition === undefined);
    const sections = [
      { label: "4P+ Setups", candidates: standardCandidates.filter(({ setup }) => setup.placements.length >= 4) },
      { label: "3P Setups", candidates: standardCandidates.filter(({ setup }) => setup.placements.length === 3) },
    ];
    const otherCandidates = standardCandidates.filter(({ setup }) => setup.placements.length < 3);
    if (otherCandidates.length > 0) sections.push({ label: "Other Setups", candidates: otherCandidates });
    return sections;
  }, [candidates, showCategorizedCandidates]);
  useEffect(() => {
    if (!selectedCandidate || guideDone || !targetCompleted(session.current.state, selectedCandidate.setup)) return;
    const current = session.current.state;
    const query = {
      cycle: current.run.cycle,
      board: current.board,
      active: current.active.piece,
      hold: current.hold,
      next: current.bag.queue.slice(0, 5),
      holdAvailable: true,
    } as const;
    let active = true;
    const applyProgress = (progress: OqbProgressResult) => {
      if (!active) return;
      if (progress.status !== "continuation") {
        if (progress.status !== "no-follow-up") setStagedInstruction(progress.instruction);
        setGuideDone(true);
        return;
      }
      const followups = oqbContinuationCandidates(progress).map((candidate) =>
        selectedCandidate.recommendationLabel
          ? { ...candidate, recommendationLabel: selectedCandidate.recommendationLabel }
          : candidate);
      if (followups.length === 0) {
        setStagedInstruction(progress.instruction);
        setGuideDone(true);
        return;
      }
      setStagedInstruction(progress.instruction);
      const followupIds = new Set(followups.map(({ setup }) => setup.id));
      setCandidates((currentCandidates) => [
        ...followups,
        ...currentCandidates.filter(({ setup }) => setup.id !== selectedCandidate.setup.id && !followupIds.has(setup.id)),
      ]);
      setSelectedId(followups[0]!.setup.id);
    };

    if (current.run.cycle === 5) {
      void import("./setups/promotedOqbProgressProvider")
        .then(({ promotedOqbProgressProvider }) => applyProgress(resolveOqbProgress({
          selectedCandidate,
          query,
          policyProvider: promotedOqbProgressProvider,
        })))
        .catch((reason) => {
          if (!active) return;
          console.error(reason);
          setStagedInstruction("The promoted OQB continuation could not be loaded.");
          setGuideDone(true);
        });
    } else {
      applyProgress(resolveOqbProgress({ selectedCandidate, query }));
    }
    return () => { active = false; };
  }, [revision, selectedCandidate, guideDone]);

  const setupShadowAutoHidden = selected
    ? shouldAutoHideSetupShadow(state.board, selected, state.run.piecesLockedSinceLastPc)
    : false;
  const liveSolveShadowVisible = showSolveShadow
    && liveSolveView.status === "ready"
    && liveSolveOption !== null
    && shouldShowLiveSolveShadow(liveSolveView.calculatedLinesSinceLastPc, state.run.linesSinceLastPc);
  const effectiveSetupShadowAutoHidden = setupShadowAutoHidden && !liveSolveShadowVisible;
  const boardShadow = liveSolveShadowVisible ? liveSolveOption!.shadow : selected;
  const setupShadowVisible = liveSolveShadowVisible
    || showSetupShadow && !guideDone && !effectiveSetupShadowAutoHidden;

  useEffect(() => {
    if (canvas.current) drawBoard(canvas.current, state, boardShadow, setupShadowVisible);
  }, [boardShadow, revision, setupShadowVisible, state]);

  function restartWithSeed() {
    if (seedInputError) return;
    session.current.setSeed(seedInput);
    guideHistory.current.clear();
    restoredGuideSegment.current = null;
    setSeedInput(session.current.state.seed);
    setResetNonce((value) => value + 1);
    setRevision((value) => value + 1);
  }

  function jumpToQueue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const target = session.current.jumpToQueue(queueJumpInput);
      guideHistory.current.clear();
      restoredGuideSegment.current = null;
      setQueueJumpInput(target.normalized);
      setResetNonce((value) => value + 1);
      setRevision((value) => value + 1);

      let classLabel = target.normalized;
      const distinct = new Set(target.pieces);
      if (target.cycle === 4 && distinct.size === 5) {
        const missing = PIECES.filter((piece) => !distinct.has(piece));
        classLabel = `No ${cycle4ClassLabel(missing) ?? missing.join("")}`;
      } else if (target.cycle === 6 && distinct.size === 6) {
        classLabel = `No ${PIECES.find((piece) => !distinct.has(piece)) ?? "?"}`;
      }
      setQueueJumpStatus({ text: `Moved to ${classLabel} · Cycle ${target.cycle}.`, error: false });
    } catch (reason) {
      setQueueJumpStatus({ text: reason instanceof Error ? reason.message : "Could not read that queue.", error: true });
    }
  }

  const wrongCells = selected && !guideDone ? countSetupShadowWrongCells(state.board, selected) : 0;

  return <><SiteHeader active="game" /><main className="app-shell" onPointerUpCapture={releaseGameplayButtonFocus}>
    <header className="topbar">
      <div><h1>GUIDED PC MODE</h1></div>
    </header>

    <section className="game-layout">
      <aside className="hold-column">
        <PiecePreview piece={state.hold} label="HOLD" />
      </aside>

      <div className="field-column">
        <canvas ref={canvas} className="board-canvas" aria-label="10-column 20-row Tetris field" />
        <div className="main-actions field-actions">
          <button type="button" onClick={() => dispatch("undo")}>Undo</button>
          <button type="button" onClick={() => dispatch("restart")}>Restart</button>
          <button type="button" onClick={() => setReplayExport(replayRecorder.current.export(session.current.state))}>Replay</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>Controls</button>
        </div>
      </div>

      <aside className="next-column">
        <div className="next-list"><span>NEXT</span>{state.bag.queue.slice(0, 5).map((piece, index) => <PiecePreview key={`${index}-${piece}`} piece={piece} />)}</div>
        <div className="side-stats" aria-label="Run progress">
          <span><small>CYCLE</small><b>{displayCycle}</b></span>
          <span><small>PC</small><b>{state.run.pcCount}</b></span>
          <span><small>PIECES</small><b>{state.run.piecesLockedSinceLastPc}/10</b></span>
        </div>
      </aside>

      <aside className="guide-column">
        <div className="guide-tabs" role="tablist" aria-label="Guide panel">
          <button type="button" role="tab" aria-selected={guideTab === "setup"} className={guideTab === "setup" ? "selected" : ""} onClick={() => setGuideTab("setup")}>Setup</button>
          <button type="button" role="tab" aria-selected={guideTab === "solve"} className={guideTab === "solve" ? "selected" : ""} onClick={() => setGuideTab("solve")}>Solve</button>
        </div>
        {guideTab === "setup" ? <div className="guide-tab-content" role="tabpanel" aria-label="Setup guide">
        <div className="guide-heading">
          <div><span>{selected ? `${selected.placements.length}P` : "SETUP"}</span><h2>{guideDone ? "Solve Phase" : selectedCandidate ? setupOptionLabel(selectedCandidate) : recommendationLoading ? "Loading…" : recommendationError ? "Recommendation Error" : "No Suggestion"}</h2></div>
          <div className="guide-heading-actions">
            <button
              type="button"
              className={`setup-shadow-toggle ${showSetupShadow ? "enabled" : ""} ${effectiveSetupShadowAutoHidden && showSetupShadow ? "auto-hidden" : ""}`}
              aria-pressed={showSetupShadow}
              aria-label={`${showSetupShadow ? "Hide" : "Show"} setup shadow on board`}
              title={effectiveSetupShadowAutoHidden && showSetupShadow ? "Setup differs by at least 8 cells after 4P. Undo below 4P or correct the field to restore the shadow." : undefined}
              onClick={() => setShowSetupShadow((visible) => !visible)}
            >
              <span className="setup-shadow-toggle-label">SETUP SHADOW</span>
              <strong className="setup-shadow-toggle-state">{effectiveSetupShadowAutoHidden && showSetupShadow ? "AUTO OFF" : showSetupShadow ? "ON" : "OFF"}</strong>
            </button>
          </div>
        </div>
        {recommendationError && <div className="recommendation-error" role="alert"><span>{candidates.length > 0 ? "Some additional recommendations could not be loaded." : "Setup recommendations could not be loaded."}</span><button type="button" onClick={() => setRecommendationRetryNonce((value) => value + 1)}>Retry</button></div>}
        {selected ? <>
          <SetupPreview setup={selected} />
          <p className="setup-meta">{selected.solveRate !== undefined ? `PC Rate ${selected.solveRate}% · ` : ""}Priority {selected.priority ?? 0} · Difficulty {selected.difficulty}/5 · {selected.saves !== undefined ? `${selected.saveMetricKind === "project-priority" ? "Save Priority" : "Saves"} ${selected.saves}${selected.saveMetricKind === "project-priority" ? "" : "%"} · ` : ""}{selected.reviewStatus === "draft" ? "Unreviewed" : "Reviewed"}</p>
          {stagedInstruction && <p className="policy-note">{stagedInstruction}</p>}
          {!guideDone && wrongCells > 0 && <p className="warning">{wrongCells} cell(s) differ from the target. Undo recommended.</p>}
        </> : <p className="empty-copy">{recommendationLoading
          ? "Reading the PC-start queue and finding buildable setups…"
          : recommendationError
          ? "Recommendation loading failed. Free practice continues."
          : coverage?.setupCount && coverage.setupCount > 0
          ? `No buildable candidates found in the current ${coverage.setupCount} placements and their mirrors for this queue. Unexplored setups may exist. Free practice continues.`
          : coverage?.logicalSetupCount && coverage.logicalSetupCount > 0
            ? `Cycle ${state.run.cycle} setup data has been promoted but is not yet linked to the recommendation engine. Free practice continues.`
            : `Cycle ${state.run.cycle} setup data is not yet registered. Free practice continues.`}</p>}

        {showCategorizedCandidates && candidates.length > 0
          ? <div className="candidate-list candidate-sections">{candidateSections.map((section) => <section className="candidate-group" key={section.label}>
              <h3><span>{section.label}</span><small>{section.candidates.length}</small></h3>
              {section.candidates.length > 0
                ? section.candidates.map((candidate) => <button key={candidate.setup.id} type="button" className={selectedId === candidate.setup.id ? "selected" : ""} onClick={() => { setSelectedId(candidate.setup.id); setGuideDone(false); setStagedInstruction(undefined); }}>{setupOptionLabel(candidate)}</button>)
                : <p className="candidate-empty">No buildable setups</p>}
              {section.label === "3P Setups" && showQbCandidateSection && <div className="qb-candidate-group">
                <h3><span>QB Setups</span><small>{qbCandidates.length}</small></h3>
                {qbCandidates.length > 0
                  ? qbCandidates.map((candidate) => <button key={candidate.setup.id} type="button" className={selectedId === candidate.setup.id ? "selected" : ""} onClick={() => { setSelectedId(candidate.setup.id); setGuideDone(false); setStagedInstruction(undefined); }}>{setupOptionLabel(candidate)}</button>)
                  : <p className="candidate-empty">No QB setup for this queue</p>}
              </div>}
            </section>)}</div>
          : candidates.length > 1 && <div className="candidate-list"><h3>{candidates.length} Candidates</h3>{candidates.map((candidate) =>
              <button key={candidate.setup.id} type="button" className={selectedId === candidate.setup.id ? "selected" : ""} onClick={() => { setSelectedId(candidate.setup.id); setGuideDone(false); setStagedInstruction(undefined); }}>{setupOptionLabel(candidate)}</button>)}</div>}
        <form className="queue-jump-panel" onSubmit={jumpToQueue}>
          <label>QUEUE JUMP<input value={queueJumpInput} maxLength={20} placeholder="TS or TOSIZ" onChange={(event) => setQueueJumpInput(event.target.value.toUpperCase())} /></label>
          <button type="submit">Go</button>
          {queueJumpStatus.text && <p className={queueJumpStatus.error ? "error" : ""} aria-live="polite">{queueJumpStatus.text}</p>}
        </form>
        <div className="seed-panel"><label>SEED <input value={seedInput} aria-invalid={seedInputError !== null} aria-describedby={seedInputError ? "seed-input-error" : undefined} onChange={(e) => setSeedInput(e.target.value)} /></label><button type="button" disabled={seedInputError !== null} onClick={restartWithSeed}>Apply</button><button type="button" onClick={() => dispatch("restart")}>Random</button>{seedInputError && <p id="seed-input-error" role="alert">{seedInputError}</p>}</div>
        </div> : <div className="guide-tab-content solve-tab-content" role="tabpanel" aria-label="Live solve">
          <div className="solve-heading">
            <h2>Minimal PC Solutions</h2>
            <div className="solve-heading-actions">
              <button
                type="button"
                className={`setup-shadow-toggle ${showSolveDetails ? "enabled" : ""}`}
                aria-pressed={showSolveDetails}
                aria-label={`${showSolveDetails ? "Hide" : "Show"} solve details`}
                onClick={() => setShowSolveDetails((visible) => !visible)}
              >
                <span className="setup-shadow-toggle-label">SHOW SOLVE</span>
                <strong className="setup-shadow-toggle-state">{showSolveDetails ? "ON" : "OFF"}</strong>
              </button>
              <button
                type="button"
                className={`setup-shadow-toggle ${showSolveShadow ? "enabled" : ""}`}
                aria-pressed={showSolveShadow}
                aria-label={`${showSolveShadow ? "Hide" : "Show"} solve shadow on board`}
                onClick={() => setShowSolveShadow((visible) => !visible)}
              >
                <span className="setup-shadow-toggle-label">SOLVE SHADOW</span>
                <strong className="setup-shadow-toggle-state">{showSolveShadow ? "ON" : "OFF"}</strong>
              </button>
            </div>
          </div>
          <div className="live-solve-controls" aria-label="Live minimal solutions">
            <button type="button" aria-label="Previous save" disabled={liveSolveView.status !== "ready" || liveSolveIndex === 0} onClick={() => setLiveSolveIndex((index) => Math.max(0, index - 1))}>&lt;</button>
            <button
              type="button"
              className="live-solve-action"
              disabled={liveSolveView.status === "loading" || !liveSolvePreparation.ready}
              title={liveSolvePreparation.ready ? "Calculate minimal PC solutions from the current post-clear field." : liveSolvePreparation.reason}
              onClick={calculateLiveSolve}
            >{liveSolveView.status === "loading"
                ? "Calculating…"
                : liveSolveView.status === "idle"
                  ? "Calculate"
                  : "Recalculate"}</button>
            <button type="button" aria-label="Next save" disabled={liveSolveView.status !== "ready" || liveSolveIndex >= liveSolveView.options.length - 1} onClick={() => setLiveSolveIndex((index) => liveSolveView.status === "ready" ? Math.min(liveSolveView.options.length - 1, index + 1) : index)}>&gt;</button>
          </div>
          {liveSolveAvailableSaves ? <p className="live-solve-available" aria-live="polite">{liveSolveAvailableSaves}</p> : null}
          {liveSolveView.status === "idle" && !liveSolvePreparation.ready && <p className="solve-unavailable">{liveSolvePreparation.reason}</p>}
          {liveSolveView.status === "loading" && <p className="solve-loading" aria-live="polite">Searching minimal solutions…</p>}
          {liveSolveView.status === "none" && <div className="solve-empty" aria-live="polite">
            <h3>No solve</h3>
            <p>No minimal solution was found for this field and queue.</p>
            <dl className="solve-details">
              <div><dt>Bag structure</dt><dd><code>{formatSolveQueueGroups(liveSolveView.queueAnalysis.groups)}</code></dd></div>
              <div><dt>Following bag</dt><dd><code>{formatNextBagRemainder(liveSolveView.queueAnalysis)}</code></dd></div>
            </dl>
          </div>}
          {liveSolveView.status === "error" && <div className="solve-empty error" role="alert"><h3>Solve error</h3><p>{liveSolveView.message}</p></div>}
          {showSolveDetails && liveSolveView.status === "ready" && liveSolveOption && <div className="solve-result" aria-live="polite">
            <div className="solve-preview-heading"><h3>{liveSolveOption.label}</h3></div>
            <SolutionPreview setup={liveSolveOption.shadow} board={liveSolveView.calculatedBoard} />
            <dl className="solve-details">
              <div><dt>Save</dt><dd>{liveSolveOption.save ? `Save ${liveSolveOption.save}` : "3P minimals (no save)"}</dd></div>
              <div><dt>Bag structure</dt><dd><code>{formatSolveQueueGroups(liveSolveView.queueAnalysis.groups)}</code></dd></div>
              <div><dt>Following bag</dt><dd><code>{formatNextBagRemainder(liveSolveView.queueAnalysis)}</code></dd></div>
              {liveSolvePrediction && <div><dt>Next cycle</dt><dd>{liveSolvePrediction.label}</dd></div>}
            </dl>
          </div>}
        </div>}
      </aside>
    </section>
    {settingsOpen && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
    {replayExport && <ReplayExportDialog replay={replayExport} onClose={() => setReplayExport(null)} />}
  </main></>;
}
