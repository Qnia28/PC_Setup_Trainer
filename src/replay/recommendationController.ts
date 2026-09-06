import type { Board, Cycle, Piece } from "../engine/types";
import { deserializeBoard } from "./format";
import type { ReplayPcSegment } from "./navigation";
import type { ReplayTimeline } from "./timeline";

export interface ReplayRecommendationInput {
  cycle: Cycle;
  board: Board;
  active: Piece;
  hold: Piece | null;
  next: Piece[];
  holdAvailable: true;
}

export function recommendationInputForSegment(
  replay: ReplayTimeline,
  segment: ReplayPcSegment,
): ReplayRecommendationInput | null {
  if (!segment.hasTrustworthyStart) return null;
  const frame = replay.frameAt(segment.startFrame);
  const run = frame.snapshot.run;
  if (frame.kind !== "pc-start" || frame.pieceInPc !== 0
    || frame.pcIndex !== segment.pcIndex || frame.cycle !== segment.cycle
    || run.pcCount !== segment.pcIndex || run.cycle !== segment.cycle
    || run.piecesLockedSinceLastPc !== 0 || frame.snapshot.next.length < 5) return null;
  return {
    cycle: segment.cycle,
    board: deserializeBoard(frame.snapshot.board),
    active: frame.snapshot.active,
    hold: frame.snapshot.hold,
    next: frame.snapshot.next.slice(0, 5),
    holdAvailable: true,
  };
}

export async function loadReplayRecommendations<T>(
  enabled: boolean,
  input: ReplayRecommendationInput | null,
  loadModule: () => Promise<{ queryReplaySetupRecommendations: (value: ReplayRecommendationInput) => T }>,
): Promise<T | null> {
  if (!enabled || !input) return null;
  const module = await loadModule();
  return module.queryReplaySetupRecommendations(input);
}

export function nextReplayRecommendationSelection(
  previousId: string | null,
  previousSegmentKey: string | null,
  nextSegmentKey: string,
  candidateIds: readonly string[],
  preferredCandidateId?: string | null,
  automaticCandidateIds: readonly string[] = candidateIds,
): string | null {
  if (previousSegmentKey === nextSegmentKey && previousId && candidateIds.includes(previousId)) return previousId;
  return preferredCandidateId && candidateIds.includes(preferredCandidateId) && automaticCandidateIds.includes(preferredCandidateId)
    ? preferredCandidateId
    : candidateIds.find(id => automaticCandidateIds.includes(id)) ?? null;
}
