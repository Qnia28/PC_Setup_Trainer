import { jstrisReplayUrlFromViewerPath } from "./replayRoute";
import type { ReplayFrame } from "./schema";
import type { ReplayTimeline } from "./timeline";

export const MAX_REPLAY_SHARE_URL_LENGTH = 32_000;

export interface ReplayShareTarget {
  pcNumber: number;
  pieceInPc: number;
}

export interface ReplayShareLaunch {
  target: ReplayShareTarget | null;
  replayCode: string | null;
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseReplayShareLaunch(url: URL): ReplayShareLaunch {
  const pcValue = url.searchParams.get("pc");
  const pieceValue = url.searchParams.get("p");
  let target: ReplayShareTarget | null = null;
  if (pcValue !== null || pieceValue !== null) {
    const pcNumber = positiveInteger(pcValue);
    const pieceInPc = nonNegativeInteger(pieceValue);
    if (pcNumber === null || pieceInPc === null) throw new Error("Shared replay position is invalid.");
    target = { pcNumber, pieceInPc };
  }
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  return { target, replayCode: fragment.get("r") };
}

export function resolveReplaySharePosition(replay: ReplayTimeline, target: ReplayShareTarget): number {
  const segment = replay.segments.find(({ pcIndex }) => pcIndex + 1 === target.pcNumber);
  if (!segment || target.pieceInPc === 0 && !segment.hasTrustworthyStart) {
    throw new Error(`PC ${target.pcNumber} ${target.pieceInPc}P is unavailable in this replay.`);
  }
  for (let position = segment.startFrame; position <= segment.endFrame; position += 1) {
    const frame = replay.frameAt(position);
    if (frame.pcIndex + 1 === target.pcNumber && frame.pieceInPc === target.pieceInPc) return position;
  }
  throw new Error(`PC ${target.pcNumber} ${target.pieceInPc}P is unavailable in this replay.`);
}

export function buildReplayShareUrl(baseUrl: URL, replayCode: string | null, frame: ReplayFrame): string {
  const url = new URL(baseUrl.href);
  url.search = "";
  url.searchParams.set("pc", String(frame.pcIndex + 1));
  url.searchParams.set("p", String(frame.pieceInPc));
  if (jstrisReplayUrlFromViewerPath(url.pathname)) {
    url.hash = "";
  } else {
    if (!replayCode) throw new Error("This replay has no portable code for sharing.");
    url.hash = new URLSearchParams({ r: replayCode }).toString();
  }
  const result = url.toString();
  if (result.length > MAX_REPLAY_SHARE_URL_LENGTH) {
    throw new Error("This replay is too large for a reliable share link. Export its replay file instead.");
  }
  return result;
}

