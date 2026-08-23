import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloneBoard, createBoard } from "../engine/board";
import { GameSession } from "../engine/game";
import type { GameAction, Piece } from "../engine/types";
import { normalizePieceNotationForDisplay } from "../engine/pieceDisplay";
import { InputController } from "../input/controller";
import { releaseGameplayButtonFocus } from "../input/buttonFocus";
import { SiteHeader } from "../site/SiteHeader";
import { SettingsPanel } from "../input/SettingsPanel";
import { loadInputSettings, saveInputSettings } from "../input/settings";
import { drawPiecePreview, drawSetupPreview, drawSolutionPreview } from "../render/canvas";
import type { SetupCandidate } from "../setups/query";
import type { SetupVariant } from "../setups/schema";
import { pcSolverUrl } from "../solver/pcSolver";
import {
  LiveSolverClient,
  formatAvailableSaves,
  perSaveOptions,
  prepareLiveSolveRequest,
  solveOneOptions,
  type LiveSolveOption,
  type PerSaveMinimalsResult,
  type SolveOneResult,
} from "../solver/liveSolver";
import {
  analyzeSolveQueue,
  formatNextBagRemainder,
  formatSolveQueueGroups,
  predictSavedPiece,
  solveQueueBagHistory,
  type SolveQueueAnalysis,
} from "../solver/solveQueue";
import { drawReplayFrame, drawReplaySnapshotGame } from "./canvas";
import { deserializeBoard, encodeReplayCode, MAX_REPLAY_INPUT_SIZE, parseReplayInput, QPCR3_CODE_PREFIX, REPLAY_TRANSFER_STORAGE_KEY, type ReplayData } from "./format";
import { decodeQpcr3Container, QPCR3_MAX_BINARY_SIZE } from "./qpcr3";
import { segmentForFrame } from "./navigation";
import { splitReplayQueueByBag } from "./queueBag";
import {
  nextReplayRecommendationSelection,
  recommendationInputForSegment,
} from "./recommendationController";
import { ReplayRecommendationPool } from "./recommendationPool";
import { jstrisReplayUrlFromViewerPath } from "./replayRoute";
import { replayShortcutForCode } from "./shortcuts";
import { buildReplaySetupRecommendationResult, type ReplaySetupRecommendationResult } from "./setupRecommendations";
import { createReplayTimeline, type ReplayTimeline } from "./timeline";
import { importJstrisReplay } from "./jstris";
import { snapshotGameStateAt } from "./snapshot";
import { matchesSnapshotExitBinding } from "./snapshotShortcut";
import { ReplayGifDialog } from "./ReplayGifDialog";
import { buildReplayShareUrl, MAX_REPLAY_SHARE_URL_LENGTH, parseReplayShareLaunch, resolveReplaySharePosition, type ReplayShareTarget } from "./shareRoute";
import {
  formatReplaySolvePrediction,
  matchesReplaySeeSolveBinding,
  replayFeaturePanelVisibility,
  replaySolveContext,
  replaySolveSessionKey,
  replaySolveUnavailableReason,
} from "./solveController";

const REPLAY_SHARE_UI_ENABLED = false;

function PiecePreview({ piece, label }: { piece: Piece | null; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawPiecePreview(ref.current, piece); }, [piece]);
  return <div className="replay-piece-preview">{label && <span>{label}</span>}<canvas ref={ref} aria-label={piece ?? "empty"} /></div>;
}

function SetupPreview({ setup }: { setup: SetupVariant }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSetupPreview(ref.current, setup); }, [setup]);
  return <canvas ref={ref} className="replay-setup-preview" aria-label={`${normalizePieceNotationForDisplay(setup.displayName)} setup shape`} />;
}

const EMPTY_SOLUTION_SETUP: SetupVariant = {
  id: "replay-empty-solution",
  cycle: 1,
  family: "replay-empty-solution",
  displayName: "Empty solution",
  pieceSignature: [],
  placements: [],
  difficulty: 1,
  reviewStatus: "reviewed",
};
const EMPTY_SOLUTION_BOARD = createBoard();

function SolutionPreview({ setup, board }: { setup: SetupVariant | null; board: ReturnType<typeof cloneBoard> | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSolutionPreview(ref.current, setup ?? EMPTY_SOLUTION_SETUP, board ?? EMPTY_SOLUTION_BOARD);
  }, [board, setup]);
  return <canvas ref={ref} className="replay-solve-preview" aria-label={setup ? `${setup.displayName} solution field` : "Empty solution field"} />;
}

function cycleOrdinal(cycle: number): string {
  if (cycle === 1) return "1st";
  if (cycle === 2) return "2nd";
  if (cycle === 3) return "3rd";
  return `${cycle}th`;
}

function PcQueue({ cycle, queue, trustworthy }: { cycle: 1 | 2 | 3 | 4 | 5 | 6 | 7; queue: Piece[]; trustworthy: boolean }) {
  const groups = splitReplayQueueByBag(cycle, queue, trustworthy);
  return <span className="pc-queue-groups" aria-label={`Queue ${queue.join(" ")}`}>
    {(groups ?? [queue]).map((group, index) => <span className="pc-queue-group" aria-hidden="true" key={`${index}-${group.join("")}`}>{group.join("")}</span>)}
  </span>;
}

type RecommendationViewState =
  | { status: "disabled" | "loading" | "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ReplaySetupRecommendationResult };

type ReplaySolveView =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      options: LiveSolveOption[];
      queueAnalysis: SolveQueueAnalysis;
      calculatedBoard: ReturnType<typeof cloneBoard>;
    }
  | { status: "none"; queueAnalysis: SolveQueueAnalysis }
  | { status: "error"; message: string };

export function ReplayApp() {
  const boardRef = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState<ReplayTimeline | null>(null);
  const [position, setPosition] = useState(0);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSetupRecommendations, setShowSetupRecommendations] = useState(true);
  const [showSolves, setShowSolves] = useState(true);
  const [snapshotSession, setSnapshotSession] = useState<GameSession | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [settings, setSettings] = useState(loadInputSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gifDialogOpen, setGifDialogOpen] = useState(false);
  const [portableReplayCode, setPortableReplayCode] = useState<string | null>(null);
  const [shareButtonLabel, setShareButtonLabel] = useState("Copy Link");
  const [recommendationView, setRecommendationView] = useState<RecommendationViewState>({ status: "unavailable" });
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [replaySolveView, setReplaySolveView] = useState<ReplaySolveView>({ status: "idle" });
  const recommendationCache = useRef(new WeakMap<ReplayTimeline, Map<number, ReplaySetupRecommendationResult>>());
  const recommendationPool = useRef<ReplayRecommendationPool | null>(null);
  if (!recommendationPool.current) recommendationPool.current = new ReplayRecommendationPool();
  useEffect(() => {
    recommendationPool.current?.warm();
    return () => recommendationPool.current?.dispose();
  }, []);
  const replayGeneration = useRef(0);
  const selectedRecommendationSegment = useRef<string | null>(null);
  const snapshotEntryPosition = useRef<number | null>(null);
  const initialLoadStarted = useRef(false);
  const replaySolver = useRef<LiveSolverClient | null>(null);
  const replaySolveGeneration = useRef(0);
  const replaySolveShortcutPending = useRef(false);
  if (!replaySolver.current) replaySolver.current = new LiveSolverClient();

  function installReplay(loaded: ReplayTimeline, data: ReplayData, target: ReplayShareTarget | null = null) {
    recommendationPool.current?.cancelAll();
    replayGeneration.current += 1;
    selectedRecommendationSegment.current = null;
    setSelectedRecommendationId(null);
    setReplay(loaded);
    try {
      const code = encodeReplayCode(data);
      setPortableReplayCode(code.length <= MAX_REPLAY_SHARE_URL_LENGTH ? code : null);
    } catch {
      setPortableReplayCode(null);
    }
    if (target) {
      try {
        setPosition(resolveReplaySharePosition(loaded, target));
        setError("");
      } catch (reason) {
        setPosition(0);
        setError(reason instanceof Error ? reason.message : "Shared replay position is unavailable.");
      }
    } else {
      setPosition(0);
      setError("");
    }
  }

  function clearReplay() {
    recommendationPool.current?.cancelAll();
    selectedRecommendationSegment.current = null;
    setSelectedRecommendationId(null);
    setReplay(null);
    setPortableReplayCode(null);
    setShareButtonLabel("Copy Link");
  }

  async function loadReplay(raw: string, target: ReplayShareTarget | null = null) {
    setLoading(true);
    try {
      const trimmed = raw.trim();
      const data = trimmed.startsWith("QPCR") || trimmed.startsWith("{")
        ? parseReplayInput(trimmed)
        : await importJstrisReplay(trimmed);
      installReplay(createReplayTimeline(data), data, target);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load replay.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    let shareLaunch;
    try {
      shareLaunch = parseReplayShareLaunch(new URL(window.location.href));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shared replay link is invalid.");
      return;
    }
    if (shareLaunch.replayCode) {
      setInput(shareLaunch.replayCode);
      void loadReplay(shareLaunch.replayCode, shareLaunch.target);
      return;
    }
    const routeReplayUrl = jstrisReplayUrlFromViewerPath(window.location.pathname);
    if (routeReplayUrl) {
      setInput(routeReplayUrl);
      void loadReplay(routeReplayUrl, shareLaunch.target);
      return;
    }
    try {
      const transferred = localStorage.getItem(REPLAY_TRANSFER_STORAGE_KEY);
      if (transferred) {
        localStorage.removeItem(REPLAY_TRANSFER_STORAGE_KEY);
        void loadReplay(transferred, shareLaunch.target);
      }
    } catch {
      // Manual code and file loading remain available.
    }
  }, []);

  const segments = useMemo(() => replay?.segments ?? [], [replay]);
  const frame = replay?.frameAt(position);
  const snapshotState = snapshotSession?.state ?? null;
  const availableSnapshotState = useMemo(() => replay && frame && !snapshotSession
    ? snapshotGameStateAt(replay, position)
    : null, [frame, position, replay, snapshotSession]);
  const currentPcSolverUrl = useMemo(() => snapshotState ? pcSolverUrl({
    board: snapshotState.board, active: snapshotState.active.piece, hold: snapshotState.hold, next: snapshotState.bag.queue,
  }) : frame ? pcSolverUrl({
    board: deserializeBoard(frame.snapshot.board), active: frame.snapshot.active, hold: frame.snapshot.hold, next: frame.snapshot.next,
  }) : null, [frame, snapshotState, snapshotRevision]);
  const currentSegment = frame ? segmentForFrame(segments, position) : undefined;
  const segmentPosition = currentSegment ? segments.indexOf(currentSegment) : -1;
  const currentShareUrl = useMemo(() => {
    if (!frame || typeof window === "undefined") return null;
    try { return buildReplayShareUrl(new URL(window.location.href), portableReplayCode, frame); }
    catch { return null; }
  }, [frame, portableReplayCode]);
  const cycles = useMemo(() => {
    const grouped = new Map<number, typeof segments>();
    for (const segment of segments) {
      const list = grouped.get(segment.cycle) ?? [];
      list.push(segment);
      grouped.set(segment.cycle, list);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [segments]);

  const recommendationSegmentKey = currentSegment
    ? `${replayGeneration.current}:${currentSegment.pcIndex}:${currentSegment.startFrame}`
    : null;
  useEffect(() => {
    let cancelled = false;
    if (!showSetupRecommendations) {
      recommendationPool.current?.cancelAll();
      setRecommendationView({ status: "disabled" });
      return;
    }
    if (!replay || !currentSegment || !recommendationSegmentKey) {
      setRecommendationView({ status: "unavailable" });
      setSelectedRecommendationId(null);
      return;
    }
    const recommendationInput = recommendationInputForSegment(replay, currentSegment);
    if (!recommendationInput) {
      selectedRecommendationSegment.current = recommendationSegmentKey;
      setRecommendationView({ status: "unavailable" });
      setSelectedRecommendationId(null);
      return;
    }
    let replayCache = recommendationCache.current.get(replay);
    if (!replayCache) {
      replayCache = new Map();
      recommendationCache.current.set(replay, replayCache);
    }
    const cached = replayCache.get(currentSegment.startFrame);
    if (cached) {
      const ids = cached.candidates.map(({ setup }) => setup.id);
      setSelectedRecommendationId((previous) => nextReplayRecommendationSelection(
        previous,
        selectedRecommendationSegment.current,
        recommendationSegmentKey,
        ids,
      ));
      selectedRecommendationSegment.current = recommendationSegmentKey;
      setRecommendationView({ status: "ready", result: cached });
      return;
    }
    setRecommendationView({ status: "loading" });
    const unsubscribe = recommendationPool.current!.request(
      recommendationSegmentKey,
      recommendationInput,
      (stage) => {
        if (cancelled) return;
        const result = buildReplaySetupRecommendationResult(recommendationInput, stage.candidates);
        const ids = result.candidates.map(({ setup }) => setup.id);
        setSelectedRecommendationId((previous) => nextReplayRecommendationSelection(
          previous,
          selectedRecommendationSegment.current,
          recommendationSegmentKey,
          ids,
          stage.preferredCandidateId,
        ));
        selectedRecommendationSegment.current = recommendationSegmentKey;
        setRecommendationView({ status: "ready", result });
      },
      (stage) => {
        replayCache!.set(
          currentSegment.startFrame,
          buildReplaySetupRecommendationResult(recommendationInput, stage.candidates),
        );
      },
      (reason) => {
        if (!cancelled) setRecommendationView({ status: "error", message: reason.message });
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentSegment, recommendationSegmentKey, replay, showSetupRecommendations]);

  const selectedRecommendation: SetupCandidate | null = recommendationView.status === "ready"
    ? recommendationView.result.candidates.find(({ setup }) => setup.id === selectedRecommendationId) ?? null
    : null;

  const replaySolveContextValue = useMemo(
    () => replaySolveContext(
      replay,
      position,
      frame ?? null,
      snapshotState,
      snapshotSession && snapshotState
        ? solveQueueBagHistory(snapshotSession.placementHistory, snapshotState, { refillBag: false })
        : null,
    ),
    [frame, position, replay, snapshotRevision, snapshotState],
  );
  const replaySolvePreparation = useMemo(
    () => replaySolveContextValue
      ? prepareLiveSolveRequest(replaySolveContextValue)
      : { ready: false as const, reason: replaySolveUnavailableReason(snapshotSession !== null) },
    [replaySolveContextValue, snapshotSession],
  );
  const replaySolveCycle = snapshotState?.run.cycle ?? frame?.snapshot.run.cycle ?? 1;
  const replayPanelVisibility = replayFeaturePanelVisibility(showSetupRecommendations, showSolves);
  const replaySolveResetKey = replaySolveSessionKey({
    replayIdentity: `${replayGeneration.current}:${replay?.seed ?? "-"}`,
    position,
    snapshotRevision,
    snapshotActive: snapshotSession !== null,
    showSolves,
  });

  useEffect(() => {
    replaySolveGeneration.current += 1;
    replaySolver.current?.cancel();
    setReplaySolveView({ status: "idle" });
  }, [replaySolveResetKey]);
  useEffect(() => () => replaySolver.current?.dispose(), []);

  const calculateReplaySolve = useCallback(() => {
    if (!replaySolvePreparation.ready || !replaySolveContextValue || !replaySolver.current) return;
    const generation = ++replaySolveGeneration.current;
    replaySolver.current.cancel();
    setReplaySolveView({ status: "loading" });
    const { request } = replaySolvePreparation;
    const calculatedBoard = cloneBoard(replaySolveContextValue.board);
    const queueAnalysis = analyzeSolveQueue(
      request.input.pattern,
      replaySolveCycle,
      replaySolveContextValue.bagHistory,
    );
    const pending = request.kind === "per-save-minimals"
      ? replaySolver.current.request<PerSaveMinimalsResult>(request)
          .then((result) => perSaveOptions(result, replaySolveCycle))
      : replaySolver.current.request<SolveOneResult>(request)
          .then((result) => solveOneOptions(result, replaySolveCycle));
    void pending.then((options) => {
      if (replaySolveGeneration.current !== generation) return;
      setReplaySolveView(options.length > 0
        ? { status: "ready", options, queueAnalysis, calculatedBoard }
        : { status: "none", queueAnalysis });
    }).catch((reason) => {
      if (replaySolveGeneration.current !== generation || reason instanceof DOMException && reason.name === "AbortError") return;
      setReplaySolveView({ status: "error", message: reason instanceof Error ? reason.message : "Solve failed." });
    });
  }, [replaySolveContextValue, replaySolveCycle, replaySolvePreparation]);

  useEffect(() => {
    if (!replaySolveShortcutPending.current || !showSolves) return;
    replaySolveShortcutPending.current = false;
    calculateReplaySolve();
  }, [calculateReplaySolve, showSolves]);

  useEffect(() => {
    if (!replay || settingsOpen) return;
    const onSeeSolve = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.isComposing || target?.closest("input, button, select, textarea")) return;
      if (!matchesReplaySeeSolveBinding(settings.bindings.seeSolve, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!showSolves) {
        replaySolveShortcutPending.current = true;
        setShowSolves(true);
        return;
      }
      calculateReplaySolve();
    };
    window.addEventListener("keydown", onSeeSolve);
    return () => window.removeEventListener("keydown", onSeeSolve);
  }, [calculateReplaySolve, replay, settings.bindings.seeSolve, settingsOpen, showSolves]);

  const replaySolveOptions = replaySolveView.status === "ready" ? replaySolveView.options : [];
  const replaySolveAvailableSaves = replaySolveView.status === "ready"
    ? formatAvailableSaves(replaySolveView.options)
    : null;
  const replaySolvePredictions = replaySolveView.status === "ready"
    ? replaySolveView.options.flatMap((option) => option.save
      ? [predictSavedPiece(replaySolveView.queueAnalysis, option.save)]
      : [])
    : [];

  useEffect(() => {
    if (!boardRef.current || !frame) return;
    if (snapshotSession) drawReplaySnapshotGame(boardRef.current, snapshotSession.state);
    else drawReplayFrame(boardRef.current, frame);
  }, [frame, snapshotRevision, snapshotSession]);

  const exitSnapshot = useCallback(() => {
    const entry = snapshotEntryPosition.current;
    setSnapshotSession(null);
    snapshotEntryPosition.current = null;
    if (entry !== null) setPosition(entry);
  }, []);

  const dispatchSnapshot = useCallback((action: GameAction): boolean => {
    if (!snapshotSession) return false;
    const pcCount = snapshotSession.state.run.pcCount;
    const changed = snapshotSession.dispatch(action);
    if (snapshotSession.state.run.status === "failed" || snapshotSession.state.run.pcCount > pcCount) snapshotSession.restart();
    if (changed) setSnapshotRevision((revision) => revision + 1);
    return changed;
  }, [snapshotSession]);

  useEffect(() => {
    if (!snapshotSession || settingsOpen) return;
    function handleSnapshotExit(event: KeyboardEvent) {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, button, select, textarea")) return;
      if (!matchesSnapshotExitBinding(settings.bindings.exitSnapshot, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exitSnapshot();
    }
    window.addEventListener("keydown", handleSnapshotExit);
    return () => window.removeEventListener("keydown", handleSnapshotExit);
  }, [exitSnapshot, settings.bindings.exitSnapshot, settingsOpen, snapshotSession]);

  useEffect(() => {
    if (!snapshotSession) return;
    const controller = new InputController(dispatchSnapshot, settings);
    return () => controller.destroy();
  }, [dispatchSnapshot, settings, snapshotSession]);

  useEffect(() => { saveInputSettings(settings); }, [settings]);

  function enterSnapshot() {
    if (!availableSnapshotState) return;
    snapshotEntryPosition.current = position;
    setSnapshotSession(new GameSession(availableSnapshotState));
    setSnapshotRevision((revision) => revision + 1);
  }

  function movePiece(direction: -1 | 1) {
    if (!replay || snapshotSession) return;
    setPosition((current) => Math.max(0, Math.min(replay.length - 1, current + direction)));
  }

  function movePc(offset: number) {
    if (segmentPosition < 0) return;
    const target = segments[Math.max(0, Math.min(segments.length - 1, segmentPosition + offset))];
    if (target) setPosition(target.startFrame);
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".bin")) {
        if (file.size > QPCR3_MAX_BINARY_SIZE) { setError("QPCR3 binary file is too large."); return; }
        const data = decodeQpcr3Container(new Uint8Array(await file.arrayBuffer()));
        installReplay(createReplayTimeline(data), data);
        return;
      }
      if (file.size > MAX_REPLAY_INPUT_SIZE) { setError("Replay file is too large."); return; }
      await loadReplay(await file.text());
    } catch {
      setError("Could not read the selected file.");
    } finally {
      event.target.value = "";
    }
  }

  useEffect(() => { setShareButtonLabel("Copy Link"); }, [position, replay]);

  async function copyShareLink() {
    if (!currentShareUrl) return;
    try {
      await navigator.clipboard.writeText(currentShareUrl);
      setShareButtonLabel("Copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = currentShareUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setShareButtonLabel(copied ? "Copied" : "Copy failed");
    }
  }

  useEffect(() => {
    if (!replay || snapshotSession) return;
    function handleShortcut(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const action = replayShortcutForCode(event.code);
      if (!action) return;
      event.preventDefault();
      if (action === "reset") setPosition(0);
      if (action === "previousPc") movePc(-1);
      if (action === "previousPiece") movePiece(-1);
      if (action === "nextPiece") movePiece(1);
      if (action === "nextPc") movePc(1);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [replay, segmentPosition, segments, snapshotSession]);

  return <><SiteHeader active="replay" /><main className="replay-shell" onPointerUpCapture={releaseGameplayButtonFocus}>
    <header className="replay-header">
      <div><span>GUIDED PC MODE</span><h1>Replay Viewer</h1><p>Review every placement or jump directly to a Perfect Clear.</p></div>
    </header>

    {!replay && <section className="replay-loader" aria-labelledby="load-replay-title">
      <h2 id="load-replay-title">Load a Replay</h2>
      <p>Paste a QPCR code, a raw Jstris replay code, or a Jstris replay link.</p>
      <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={`${QPCR3_CODE_PREFIX}… or Jstris N4Ig…`} aria-label="Replay code" />
      <div><button type="button" className="primary-button" disabled={loading} onClick={() => void loadReplay(input)}>{loading ? "Loading…" : "Load Replay"}</button><label className="file-button">Choose File<input type="file" accept=".txt,.bin,text/plain,application/json,application/octet-stream" onChange={chooseFile} disabled={loading} /></label></div>
      {error && <p className="replay-error" role="alert">{error}</p>}
    </section>}

    {replay && frame && <>
      <section className="replay-toolbar">
        <div><b>{replay.seed}</b><span>{new Date(replay.createdAt).toLocaleString()}</span></div>
        <div><button type="button" disabled={snapshotSession !== null} onClick={clearReplay}>Load Another Replay</button><label className={`file-button compact ${snapshotSession ? "disabled" : ""}`}>Choose File<input type="file" disabled={snapshotSession !== null} accept=".txt,.bin,text/plain,application/json,application/octet-stream" onChange={chooseFile} /></label></div>
      </section>
      {error && <p className="replay-error" role="alert">{error}</p>}
      <section className="replay-layout">
        <div className="replay-playback">
          <section className="replay-stage" aria-label="Replay playback">
            <aside className="replay-feature-toggles" aria-label="Replay features">
              <span>REPLAY FEATURES</span>
              <label><input
                type="checkbox"
                checked={showSetupRecommendations}
                disabled={snapshotSession !== null}
                onChange={(event) => setShowSetupRecommendations(event.target.checked)}
              /><span>Setup Recommendations</span></label>
              <label><input
                type="checkbox"
                checked={showSolves}
                onChange={(event) => setShowSolves(event.target.checked)}
              /><span>Solves</span></label>
              <button
                type="button"
                className={`replay-snapshot-button ${snapshotSession ? "active" : ""}`}
                disabled={!snapshotSession && !availableSnapshotState}
                title={snapshotSession ? "Exit Snapshot and return to the saved replay position." : availableSnapshotState ? "Play from this replay state." : "This replay does not contain enough exact queue data for Snapshot."}
                onClick={snapshotSession ? exitSnapshot : enterSnapshot}
              >{snapshotSession ? "Exit Snapshot" : "Snapshot"}</button>
              {currentPcSolverUrl
                ? <a
                  className="replay-pc-solver-link"
                  href={currentPcSolverUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open current field and queue in PC Solver"
                >PC Solver <span aria-hidden="true">↗</span></a>
                : <span
                  className="replay-pc-solver-link disabled"
                  role="link"
                  aria-disabled="true"
                 title="A complete seven-piece queue and encodable field are required."
                 >PC Solver <span aria-hidden="true">↗</span></span>}
              {REPLAY_SHARE_UI_ENABLED && <button
                type="button"
                className="replay-copy-link-button"
                disabled={snapshotSession !== null || currentShareUrl === null}
                title={snapshotSession ? "Exit Snapshot before sharing the replay position." : currentShareUrl ? "Copy a link that opens this exact PC and placement." : "This replay is too large for a reliable share link."}
                onClick={() => void copyShareLink()}
              >{shareButtonLabel}</button>}
              <button
                type="button"
                className="replay-make-gif-button"
                disabled={snapshotSession !== null}
                title={snapshotSession ? "Exit Snapshot before exporting the replay." : "Export a range of replay stops as an animated GIF."}
                onClick={() => setGifDialogOpen(true)}
              >Make GIF</button>
            </aside>
            <aside className="replay-hold"><PiecePreview piece={snapshotState ? snapshotState.hold : frame.snapshot.hold} label="HOLD" /></aside>
            <div className="replay-field">
              <canvas ref={boardRef} className="replay-board" aria-label={snapshotSession ? "Playable Snapshot Tetris field, 10 columns by 8 rows" : "Replay Tetris field, 10 columns by 8 rows"} />
              <p className="replay-status"><b>{snapshotState ? snapshotState.run.piecesLockedSinceLastPc : frame.pieceInPc}p</b> @ PC {(currentSegment?.pcIndex ?? frame.pcIndex) + 1} / {segments.length}{!snapshotState && frame.placement?.perfectClear ? " · PERFECT CLEAR" : snapshotState ? " · SNAPSHOT" : ""}</p>
              <div className={`replay-controls ${snapshotSession ? "snapshot-controls" : ""}`}>
                {snapshotSession ? <>
                  <button type="button" onClick={() => dispatchSnapshot("undo")}>Undo</button>
                  <button type="button" onClick={() => dispatchSnapshot("restart")}>Restart</button>
                  <button type="button" onClick={() => setSettingsOpen(true)}>Controls</button>
                </> : <>
                <button type="button" aria-label="Reset replay" title="Reset replay · Shortcut: R" onClick={() => setPosition(0)}>↶</button>
                <button type="button" aria-label="Previous PC" title="Previous PC · Shortcut: Arrow Up" onClick={() => movePc(-1)} disabled={segmentPosition <= 0}>{"<<"}</button>
                <button type="button" aria-label="Previous piece" title="Previous piece · Shortcut: Arrow Left" onClick={() => movePiece(-1)} disabled={position <= 0}>{"<"}</button>
                <button type="button" aria-label="Next piece" title="Next piece · Shortcut: Arrow Right" onClick={() => movePiece(1)} disabled={position >= replay.length - 1}>{">"}</button>
                <button type="button" aria-label="Next PC" title="Next PC · Shortcut: Arrow Down" onClick={() => movePc(1)} disabled={segmentPosition >= segments.length - 1}>{">>"}</button>
                </>}
              </div>
            </div>
            <aside className="replay-next"><span>NEXT</span>{(snapshotState?.bag.queue ?? frame.snapshot.next).slice(0, 5).map((piece, index) => <PiecePreview key={`${index}-${piece}`} piece={piece} />)}</aside>
          </section>
          {replayPanelVisibility.setups && <section className="replay-recommendations" aria-label="Setup recommendations">
            <div className="replay-recommendation-preview">
              {selectedRecommendation
                ? <><h2>{recommendationView.status === "ready" ? recommendationView.result.labels[selectedRecommendation.setup.id] : normalizePieceNotationForDisplay(selectedRecommendation.setup.displayName)}</h2><SetupPreview setup={selectedRecommendation.setup} /><p>{recommendationView.status === "ready"
                  ? recommendationView.result.pcRateLabels[selectedRecommendation.setup.id]
                  : `${selectedRecommendation.setup.placements.length}P —`}</p></>
                : <div className="replay-recommendation-empty"><h2>No Setup Selected</h2><p>{recommendationView.status === "loading"
                  ? "Finding buildable setups…"
                  : recommendationView.status === "error"
                    ? recommendationView.message
                    : recommendationView.status === "ready"
                      ? "No buildable setup is available for this PC start."
                      : "This replay segment has no trustworthy complete 0P start state."}</p></div>}
            </div>
            <div className="replay-recommendation-list">
              <h2 className="replay-recommendation-context">{recommendationView.status === "ready"
                ? recommendationView.result.contextLabel
                : currentSegment ? cycleOrdinal(currentSegment.cycle) : "Setup Recommendations"}</h2>
              {recommendationView.status === "ready" && <div className="replay-recommendation-sections">
                {recommendationView.result.sections.map((section) => <section
                  key={section.kind}
                  className={`replay-recommendation-group kind-${section.kind} ${section.kind === "qb" ? "qb" : ""}`}
                >
                  <h2>{section.label}<small>{section.candidates.length}</small></h2>
                  {section.candidates.length > 0
                    ? section.candidates.map((candidate) => <button
                      type="button"
                      key={candidate.setup.id}
                      className={selectedRecommendationId === candidate.setup.id ? "selected" : ""}
                      onClick={() => setSelectedRecommendationId(candidate.setup.id)}
                    >{recommendationView.result.labels[candidate.setup.id]}</button>)
                    : <p>No buildable setups</p>}
                </section>)}
              </div>}
              {recommendationView.status !== "ready" && <p>{recommendationView.status === "loading" ? "Loading recommendations…" : "Recommendations unavailable"}</p>}
            </div>
          </section>}
          {replayPanelVisibility.solves && <section className="replay-solves-panel" aria-label="Replay solves">
            <div className="replay-solve-preview-pane">
              {replaySolveView.status === "ready"
                ? replaySolveOptions.map((option) => {
                  const prediction = option.save
                    ? replaySolvePredictions.find(({ save }) => save === option.save) ?? null
                    : null;
                  return <article className="replay-solve-option" key={option.shadow.id}>
                    <h2><span>{option.label}</span>{prediction && <small>→ {formatReplaySolvePrediction(prediction.label)}</small>}</h2>
                    <SolutionPreview setup={option.shadow} board={replaySolveView.calculatedBoard} />
                  </article>;
                })
                : <article className="replay-solve-option">
                  <h2>Solution Preview</h2>
                  <SolutionPreview setup={null} board={null} />
                </article>}
            </div>
            <div className="replay-solve-info">
              <h2>Minimal PC Solutions</h2>
              <button
                type="button"
                className="replay-solve-action"
                disabled={replaySolveView.status === "loading" || !replaySolvePreparation.ready}
                title={replaySolvePreparation.ready ? "Calculate minimal PC solutions from the displayed replay state." : replaySolvePreparation.reason}
                onClick={calculateReplaySolve}
              >{replaySolveView.status === "loading"
                  ? "Calculating…"
                  : replaySolveView.status === "idle"
                    ? "Calculate"
                    : "Recalculate"}</button>
              {replaySolveAvailableSaves ? <p className="replay-solve-available" aria-live="polite">{replaySolveAvailableSaves}</p> : null}
              {replaySolveView.status === "idle" && !replaySolvePreparation.ready && <p className="replay-solve-unavailable">{replaySolvePreparation.reason}</p>}
              {replaySolveView.status === "loading" && <p className="replay-solve-loading" aria-live="polite">Searching minimal solutions…</p>}
              {replaySolveView.status === "none" && <div className="replay-solve-empty" aria-live="polite">
                <h3>No solve</h3>
                <p>No minimal solution was found for this field and queue.</p>
                <dl className="replay-solve-details">
                  <div><dt>Bag structure</dt><dd><code>{formatSolveQueueGroups(replaySolveView.queueAnalysis.groups)}</code></dd></div>
                  <div><dt>Following bag</dt><dd><code>{formatNextBagRemainder(replaySolveView.queueAnalysis)}</code></dd></div>
                </dl>
              </div>}
              {replaySolveView.status === "error" && <div className="replay-solve-empty error" role="alert"><h3>Solve error</h3><p>{replaySolveView.message}</p></div>}
              {replaySolveView.status === "ready" && <div className="replay-solve-result" aria-live="polite">
                <dl className="replay-solve-details">
                  {replaySolveOptions.length === 1 && replaySolveOptions[0]?.save === null
                    ? <div><dt>Save</dt><dd>3P minimals (no save)</dd></div>
                    : null}
                  <div><dt>Bag structure</dt><dd><code>{formatSolveQueueGroups(replaySolveView.queueAnalysis.groups)}</code></dd></div>
                  <div><dt>Following bag</dt><dd><code>{formatNextBagRemainder(replaySolveView.queueAnalysis)}</code></dd></div>
                  {replaySolvePredictions.length > 0 && <div className="replay-next-cycle-details"><dt>Next cycle</dt><dd>{replaySolvePredictions.map((prediction) => <div key={prediction.save} className="replay-next-cycle-row"><b>Save {prediction.save}</b><span>{formatReplaySolvePrediction(prediction.label)}</span></div>)}</dd></div>}
                </dl>
              </div>}
            </div>
          </section>}
        </div>
        <aside className="pc-sidebar" aria-label="Perfect Clear list">
          <h2>Perfect Clears</h2>
          {cycles.map(([cycle, cycleSegments]) => <details key={cycle} open={cycle === currentSegment?.cycle}>
            <summary>Cycle {cycle}<small>{cycleSegments.length}</small></summary>
            <div>{cycleSegments.map((segment) => <button
              key={segment.pcIndex}
              type="button"
              className={segment.pcIndex === currentSegment?.pcIndex ? "selected" : ""}
              onClick={() => setPosition(segment.startFrame)}
              disabled={snapshotSession !== null}
              aria-label={`Go to PC ${segment.pcIndex + 1}`}
            ><b>{segment.pcIndex + 1}</b><PcQueue cycle={segment.cycle} queue={segment.queue} trustworthy={segment.hasTrustworthyStart} /></button>)}</div>
          </details>)}
        </aside>
      </section>
      {settingsOpen && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      {gifDialogOpen && <ReplayGifDialog replay={replay} currentPosition={position} onClose={() => setGifDialogOpen(false)} />}
    </>}
  </main></>;
}
