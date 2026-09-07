import { applyPlacementEvent, copyGameState, type PlacementEvent } from "../engine/placement";
import { occupiedCells } from "../engine/pieces";
import { MAX_SEED_UTF8_BYTES } from "../engine/seed";
import {
  BOARD_HEIGHT,
  MOBILE_BOARD_HEIGHT,
  BOARD_WIDTH,
  ORIENTATIONS,
  PIECES,
  type Board,
  type BoardCell,
  type GameState,
  type Orientation,
  type Piece,
} from "../engine/types";
import {
  QPCR3_VERSION,
  REPLAY_FORMAT,
  type PackedReplayEvents,
  type ReplayCheckpoint,
  type ReplayDataV3,
  type ReplayInitialState,
} from "./schema";

export const QPCR3_CONTAINER_VERSION = 1;
// Version 2 adds the post-clear 4-row PCMODE stack-height failure rule.
export const QPCR3_REPLAY_SEMANTICS_VERSION = 2;
export const QPCR3_CHECKPOINT_SCHEMA_VERSION = 1;
export const QPCR3_MAX_BINARY_SIZE = 2 * 1024 * 1024;
export const QPCR3_MAX_EVENTS = 100_000;
export const QPCR3_MAX_QUEUE = 100;
export const REPLAY_CHECKPOINT_PC_INTERVAL = 10;

const MAGIC = Uint8Array.of(0x51, 0x50, 0x43, 0x33); // QPC3
const HEADER_SIZE = 16;
const CRC_SIZE = 4;
const PIECE_INDEX = new Map<Piece, number>(PIECES.map((piece, index) => [piece, index]));
const ORIENTATION_INDEX = new Map<Orientation, number>(ORIENTATIONS.map((orientation, index) => [orientation, index]));
const CHECKPOINT_REASON_CODE = { start: 0, interval: 1, failure: 2, end: 3 } as const;
const CHECKPOINT_REASON = ["start", "interval", "failure", "end"] as const;

function assertUint(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} is out of range.`);
}

function encodeCell(cell: BoardCell): number {
  if (cell === null) return 0;
  if (cell === "X") return 8;
  const index = PIECE_INDEX.get(cell);
  if (index === undefined) throw new Error(`Unknown board cell ${String(cell)}.`);
  return index + 1;
}

function decodeCell(code: number): BoardCell {
  if (code === 0) return null;
  if (code === 8) return "X";
  const piece = PIECES[code - 1];
  if (!piece) throw new Error(`Invalid QPCR3 board cell code ${code}.`);
  return piece;
}

function boardToRows(board: Board): string[] {
  return board.map((row) => row.map((cell) => cell ?? ".").join(""));
}

function rowsToBoard(rows: string[]): Board {
  return rows.map((row) => [...row].map((cell): BoardCell => cell === "." ? null : cell as BoardCell));
}

export function replayInitialState(state: GameState): ReplayInitialState {
  return {
    board: boardToRows(state.board),
    active: { ...state.active },
    hold: state.hold,
    bag: { rngState: state.bag.rngState >>> 0, queue: [...state.bag.queue] },
    run: {
      cycle: state.run.cycle,
      pcCount: state.run.pcCount,
      piecesLockedSinceLastPc: state.run.piecesLockedSinceLastPc,
      linesSinceLastPc: state.run.linesSinceLastPc,
      status: state.run.status,
    },
  };
}

export function gameStateFromInitial(seed: string, initial: ReplayInitialState): GameState {
  return {
    board: rowsToBoard(initial.board),
    active: { ...initial.active },
    hold: initial.hold,
    holdUsedThisTurn: false,
    bag: { rngState: initial.bag.rngState >>> 0, queue: [...initial.bag.queue] },
    run: { ...initial.run, message: "Replay start." },
    seed,
  };
}

export function packReplayEvent(event: PlacementEvent): number {
  if (event.kind !== "lock") throw new Error("QPCR3 supports lock events only.");
  if (![0, 1, 2].includes(event.holds)) throw new Error("QPCR3 HOLD count must be 0, 1, or 2.");
  const piece = PIECE_INDEX.get(event.piece);
  if (piece === undefined) throw new Error("QPCR3 piece is invalid.");
  const orientation = ORIENTATION_INDEX.get(event.orientation);
  if (orientation === undefined) throw new Error("QPCR3 orientation is invalid.");
  if (!Number.isInteger(event.x) || event.x < -1 || event.x > 9) throw new Error("QPCR3 x must be between -1 and 9.");
  if (!Number.isInteger(event.y) || event.y < 0 || event.y > 7) throw new Error("QPCR3 y must be between 0 and 7.");
  const xCode = event.x + 1;
  return ((event.holds & 0b11) << 12)
    | ((piece & 0b111) << 9)
    | ((orientation & 0b11) << 7)
    | ((xCode & 0b1111) << 3)
    | (event.y & 0b111);
}

export function unpackReplayEvent(record: number, eventIndex?: number): PlacementEvent {
  const label = eventIndex === undefined ? "QPCR3 event" : `QPCR3 event ${eventIndex}`;
  const reserved = (record >>> 14) & 0b11;
  if (reserved !== 0) throw new Error(`${label} uses an unsupported event extension.`);
  const holds = (record >>> 12) & 0b11;
  if (holds === 3) throw new Error(`${label} has an invalid HOLD count.`);
  const pieceCode = (record >>> 9) & 0b111;
  const piece = PIECES[pieceCode];
  if (!piece) throw new Error(`${label} has an invalid piece code.`);
  const orientation = ORIENTATIONS[(record >>> 7) & 0b11]!;
  const xCode = (record >>> 3) & 0b1111;
  if (xCode > 10) throw new Error(`${label} has an invalid x code.`);
  const y = record & 0b111;
  return { kind: "lock", holds: holds as 0 | 1 | 2, piece, orientation, x: xCode - 1, y };
}

export function packReplayEvents(events: readonly PlacementEvent[]): PackedReplayEvents {
  if (events.length > QPCR3_MAX_EVENTS) throw new Error(`QPCR3 exceeds the ${QPCR3_MAX_EVENTS} event limit.`);
  const bytes = new Uint8Array(events.length * 2);
  const view = new DataView(bytes.buffer);
  events.forEach((event, index) => view.setUint16(index * 2, packReplayEvent(event), true));
  return packedReplayEvents(bytes, events.length);
}

export function packedReplayEvents(bytes: Uint8Array, eventCount: number): PackedReplayEvents {
  assertUint(eventCount, QPCR3_MAX_EVENTS, "QPCR3 event count");
  if (bytes.byteLength !== eventCount * 2) throw new Error("QPCR3 event section length is invalid.");
  const owned = bytes.slice();
  const view = new DataView(owned.buffer, owned.byteOffset, owned.byteLength);
  // Structural validation is eager; event objects remain lazy.
  for (let index = 0; index < eventCount; index += 1) unpackReplayEvent(view.getUint16(index * 2, true), index);
  return {
    bytes: owned,
    eventCount,
    eventAt(index: number): PlacementEvent {
      if (!Number.isInteger(index) || index < 0 || index >= eventCount) throw new RangeError("QPCR3 event index is out of range.");
      return unpackReplayEvent(view.getUint16(index * 2, true), index);
    },
  };
}

class ByteWriter {
  private bytes: number[] = [];
  u8(value: number) { this.bytes.push(value & 0xff); }
  i16(value: number) { this.u16(value & 0xffff); }
  u16(value: number) { this.bytes.push(value & 0xff, (value >>> 8) & 0xff); }
  u32(value: number) { this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
  raw(value: Uint8Array) { for (const byte of value) this.bytes.push(byte); }
  string(value: string, maxBytes: number, label: string) {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > maxBytes) throw new Error(`${label} is too long.`);
    this.u16(encoded.length); this.raw(encoded);
  }
  finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}

class ByteReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error("Truncated QPCR3 container.");
    const result = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return result;
  }
  u8(): number { return this.take(1)[0]!; }
  u16(): number { const b = this.take(2); return b[0]! | (b[1]! << 8); }
  i16(): number { const value = this.u16(); return value & 0x8000 ? value - 0x1_0000 : value; }
  u32(): number { const b = this.take(4); return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0; }
  raw(length: number): Uint8Array { return this.take(length); }
  string(maxBytes: number, label: string): string {
    const length = this.u16(); if (length > maxBytes) throw new Error(`${label} is too long.`);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(this.take(length)); } catch { throw new Error(`${label} is not valid UTF-8.`); }
  }
  get remaining(): number { return this.bytes.length - this.offset; }
}

function writeStateCanonical(writer: ByteWriter, state: GameState): void {
  // Preserve desktop checksum bytes; domain-separate the compact-board rules.
  if (state.board.length === MOBILE_BOARD_HEIGHT) writer.u8(MOBILE_BOARD_HEIGHT);
  for (let y = 0; y < BOARD_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) writer.u8(encodeCell(state.board[y]?.[x] ?? null));
  writer.u8(PIECE_INDEX.get(state.active.piece)!);
  writer.u8(ORIENTATION_INDEX.get(state.active.orientation)!);
  writer.i16(state.active.x); writer.i16(state.active.y);
  writer.u8(state.hold === null ? 0xff : PIECE_INDEX.get(state.hold)!);
  writer.u32(state.bag.rngState >>> 0);
  writer.u16(state.bag.queue.length);
  for (const piece of state.bag.queue) writer.u8(PIECE_INDEX.get(piece)!);
  writer.u8(state.run.cycle);
  writer.u32(state.run.pcCount >>> 0);
  writer.u16(state.run.piecesLockedSinceLastPc);
  writer.u16(state.run.linesSinceLastPc);
  writer.u8(state.run.status === "playing" ? 0 : 1);
}

export function canonicalReplayStateBytes(state: GameState): Uint8Array {
  const writer = new ByteWriter(); writeStateCanonical(writer, state); return writer.finish();
}

export function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

export function replayStateChecksum(state: GameState): number {
  return fnv1a32(canonicalReplayStateBytes(state));
}

function checkpoint(state: GameState, eventIndex: number, reason: ReplayCheckpoint["reason"]): ReplayCheckpoint {
  return { eventIndex, pcCount: state.run.pcCount, reason, checksum: replayStateChecksum(state) };
}

function sameCheckpoint(left: ReplayCheckpoint, right: ReplayCheckpoint): boolean {
  return left.eventIndex === right.eventIndex && left.pcCount === right.pcCount && left.reason === right.reason && left.checksum === right.checksum;
}

export interface ReplayVerification {
  state: GameState;
  checkpoints: ReplayCheckpoint[];
}

export function verifyReplaySemantics(replay: ReplayDataV3): GameState {
  const state = verifyReplaySemanticsDetailed(replay).state;
  return state;
}

export function verifyReplaySemanticsDetailed(replay: ReplayDataV3): ReplayVerification {
  let state = gameStateFromInitial(replay.seed, replay.initial);
  const expected: ReplayCheckpoint[] = [checkpoint(state, 0, "start")];
  for (let index = 0; index < replay.events.eventCount; index += 1) {
    if (state.run.status !== "playing") throw new Error(`QPCR3 contains event ${index} after the run already failed.`);
    const event = replay.events.eventAt(index);
    const applied = applyPlacementEvent(state, event, index);
    const cells = occupiedCells(applied.before.active);
    if (cells.some(({ y }) => y < 0 || y > 7)) throw new Error(`QPCR3 event ${index} occupies cells outside the supported 8-row lock field.`);
    const pcBefore = state.run.pcCount;
    state = copyGameState(applied.after);
    if (state.run.pcCount > pcBefore && state.run.pcCount % REPLAY_CHECKPOINT_PC_INTERVAL === 0) {
      expected.push(checkpoint(state, index + 1, "interval"));
    }
  }
  if (replay.events.eventCount > 0) {
    const reason: ReplayCheckpoint["reason"] = state.run.status === "failed" ? "failure" : "end";
    const final = checkpoint(state, replay.events.eventCount, reason);
    if (expected.at(-1)?.eventIndex === final.eventIndex) expected[expected.length - 1] = final;
    else expected.push(final);
  }
  if (replay.checkpoints.length !== expected.length
    || replay.checkpoints.some((actual, index) => !sameCheckpoint(actual, expected[index]!))) {
    throw new Error("QPCR3 integrity check failed: checkpoint list does not match the deterministic replay state.");
  }
  return { state, checkpoints: expected };
}

export function createReplayV3Data(initialState: GameState, events: readonly PlacementEvent[], createdAt = new Date().toISOString()): ReplayDataV3 {
  const packed = packReplayEvents(events);
  const base: ReplayDataV3 = {
    format: REPLAY_FORMAT,
    version: QPCR3_VERSION,
    createdAt,
    seed: initialState.seed,
    initial: replayInitialState(initialState),
    events: packed,
    checkpoints: [],
    containerVersion: QPCR3_CONTAINER_VERSION,
    replaySemanticsVersion: QPCR3_REPLAY_SEMANTICS_VERSION,
    checkpointSchemaVersion: QPCR3_CHECKPOINT_SCHEMA_VERSION,
  };
  // Build mandatory checkpoints from the same interpreter used by verification.
  let state = gameStateFromInitial(base.seed, base.initial);
  const checkpoints: ReplayCheckpoint[] = [checkpoint(state, 0, "start")];
  for (let index = 0; index < packed.eventCount; index += 1) {
    if (state.run.status !== "playing") throw new Error(`Cannot record event ${index} after PCMODE failure.`);
    const applied = applyPlacementEvent(state, packed.eventAt(index), index);
    if (occupiedCells(applied.before.active).some(({ y }) => y < 0 || y > 7)) {
      throw new Error(`QPCR3 event ${index} occupies cells outside the supported 8-row lock field.`);
    }
    const pcBefore = state.run.pcCount;
    state = copyGameState(applied.after);
    if (state.run.pcCount > pcBefore && state.run.pcCount % REPLAY_CHECKPOINT_PC_INTERVAL === 0) {
      checkpoints.push(checkpoint(state, index + 1, "interval"));
    }
  }
  if (packed.eventCount > 0) {
    const final = checkpoint(state, packed.eventCount, state.run.status === "failed" ? "failure" : "end");
    if (checkpoints.at(-1)?.eventIndex === final.eventIndex) checkpoints[checkpoints.length - 1] = final;
    else checkpoints.push(final);
  }
  base.checkpoints = checkpoints;
  verifyReplaySemanticsDetailed(base);
  return base;
}

let crc32cTable: Uint32Array | undefined;
function crcTable(): Uint32Array {
  if (crc32cTable) return crc32cTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    table[i] = crc >>> 0;
  }
  crc32cTable = table; return table;
}

export function crc32c(bytes: Uint8Array): number {
  const table = crcTable(); let crc = 0xffff_ffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffff_ffff) >>> 0;
}

function writeInitial(writer: ByteWriter, initial: ReplayInitialState): void {
  if (![BOARD_HEIGHT, MOBILE_BOARD_HEIGHT].includes(initial.board.length) || initial.board.some((row) => row.length !== BOARD_WIDTH)) throw new Error("QPCR3 initial board dimensions are invalid.");
  for (let y = 0; y < BOARD_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const cell = initial.board[y]?.[x] ?? ".";
    writer.u8(encodeCell(cell === "." ? null : cell as BoardCell));
  }
  const piece = PIECE_INDEX.get(initial.active.piece); const orientation = ORIENTATION_INDEX.get(initial.active.orientation);
  if (piece === undefined || orientation === undefined) throw new Error("QPCR3 initial active piece is invalid.");
  writer.u8(piece); writer.u8(orientation); writer.i16(initial.active.x); writer.i16(initial.active.y);
  writer.u8(initial.hold === null ? 0xff : PIECE_INDEX.get(initial.hold)!);
  writer.u32(initial.bag.rngState >>> 0);
  if (initial.bag.queue.length > QPCR3_MAX_QUEUE) throw new Error(`QPCR3 initial queue exceeds ${QPCR3_MAX_QUEUE} pieces.`);
  writer.u8(initial.bag.queue.length);
  for (const queued of initial.bag.queue) writer.u8(PIECE_INDEX.get(queued)!);
  writer.u8(initial.run.cycle); writer.u32(initial.run.pcCount >>> 0);
  writer.u16(initial.run.piecesLockedSinceLastPc); writer.u16(initial.run.linesSinceLastPc);
  writer.u8(initial.run.status === "playing" ? 0 : 1);
}

function readInitial(reader: ByteReader, boardHeight: number): ReplayInitialState {
  const board: string[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    let row = "";
    for (let x = 0; x < BOARD_WIDTH; x += 1) row += decodeCell(reader.u8()) ?? ".";
    if (y < boardHeight) board.push(row);
    else if (row !== ".".repeat(BOARD_WIDTH)) throw new Error("QPCR3 compact board padding must be empty.");
  }
  const piece = PIECES[reader.u8()]; if (!piece) throw new Error("QPCR3 initial active piece code is invalid.");
  const orientation = ORIENTATIONS[reader.u8()]; if (!orientation) throw new Error("QPCR3 initial orientation code is invalid.");
  const active = { piece, orientation, x: reader.i16(), y: reader.i16() };
  const holdCode = reader.u8(); const hold = holdCode === 0xff ? null : PIECES[holdCode];
  if (holdCode !== 0xff && !hold) throw new Error("QPCR3 initial HOLD code is invalid.");
  const rngState = reader.u32();
  const queueLength = reader.u8(); if (queueLength > QPCR3_MAX_QUEUE) throw new Error("QPCR3 initial queue is too long.");
  const queue: Piece[] = [];
  for (let index = 0; index < queueLength; index += 1) { const queued = PIECES[reader.u8()]; if (!queued) throw new Error("QPCR3 queue piece code is invalid."); queue.push(queued); }
  const cycle = reader.u8(); if (cycle < 1 || cycle > 7) throw new Error("QPCR3 initial cycle is invalid.");
  const pcCount = reader.u32(); const piecesLockedSinceLastPc = reader.u16(); const linesSinceLastPc = reader.u16();
  const statusCode = reader.u8(); if (statusCode > 1) throw new Error("QPCR3 initial status code is invalid.");
  return {
    board, active, hold, bag: { rngState, queue },
    run: { cycle: cycle as 1 | 2 | 3 | 4 | 5 | 6 | 7, pcCount, piecesLockedSinceLastPc, linesSinceLastPc, status: statusCode === 0 ? "playing" : "failed" },
  };
}

export function encodeQpcr3Container(replay: ReplayDataV3): Uint8Array {
  if (replay.containerVersion !== QPCR3_CONTAINER_VERSION
    || replay.replaySemanticsVersion !== QPCR3_REPLAY_SEMANTICS_VERSION
    || replay.checkpointSchemaVersion !== QPCR3_CHECKPOINT_SCHEMA_VERSION) throw new Error("Unsupported QPCR3 version tuple.");
  verifyReplaySemanticsDetailed(replay);
  const body = new ByteWriter();
  body.string(replay.createdAt, 128, "QPCR3 createdAt"); body.string(replay.seed, MAX_SEED_UTF8_BYTES, "QPCR3 seed");
  writeInitial(body, replay.initial);
  body.raw(replay.events.bytes);
  if (replay.checkpoints.length > Math.floor(replay.events.eventCount / 10) + 3) throw new Error("QPCR3 has too many checkpoints.");
  body.u16(replay.checkpoints.length);
  for (const item of replay.checkpoints) {
    body.u32(item.eventIndex); body.u32(item.pcCount); body.u8(CHECKPOINT_REASON_CODE[item.reason]); body.u32(item.checksum);
  }
  const bodyBytes = body.finish();
  const totalLength = HEADER_SIZE + bodyBytes.length + CRC_SIZE;
  if (totalLength > QPCR3_MAX_BINARY_SIZE) throw new Error("QPCR3 binary container is too large.");
  const bytes = new Uint8Array(totalLength); const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0); bytes[4] = QPCR3_CONTAINER_VERSION; bytes[5] = QPCR3_REPLAY_SEMANTICS_VERSION; bytes[6] = QPCR3_CHECKPOINT_SCHEMA_VERSION; bytes[7] = replay.initial.board.length === MOBILE_BOARD_HEIGHT ? 1 : 0;
  view.setUint32(8, replay.events.eventCount, true); view.setUint32(12, bodyBytes.length, true); bytes.set(bodyBytes, HEADER_SIZE);
  view.setUint32(totalLength - CRC_SIZE, crc32c(bytes.subarray(0, totalLength - CRC_SIZE)), true);
  return bytes;
}

export function decodeQpcr3Container(bytes: Uint8Array): ReplayDataV3 {
  if (bytes.length > QPCR3_MAX_BINARY_SIZE || bytes.length < HEADER_SIZE + CRC_SIZE) throw new Error("QPCR3 binary container size is invalid.");
  for (let index = 0; index < MAGIC.length; index += 1) if (bytes[index] !== MAGIC[index]) throw new Error("QPCR3 magic is invalid.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containerVersion = bytes[4]!; const semantics = bytes[5]!; const checkpointSchema = bytes[6]!; const flags = bytes[7]!;
  if (containerVersion !== QPCR3_CONTAINER_VERSION) throw new Error(`Unsupported QPCR3 container version ${containerVersion}.`);
  if (semantics !== QPCR3_REPLAY_SEMANTICS_VERSION) throw new Error(`Unsupported QPCR3 replay semantics version ${semantics}.`);
  if (checkpointSchema !== QPCR3_CHECKPOINT_SCHEMA_VERSION) throw new Error(`Unsupported QPCR3 checkpoint schema version ${checkpointSchema}.`);
  if (flags & ~1) throw new Error("Unsupported QPCR3 container flags.");
  const eventCount = view.getUint32(8, true); if (eventCount > QPCR3_MAX_EVENTS) throw new Error("QPCR3 event count is too large.");
  const bodyLength = view.getUint32(12, true); if (bodyLength !== bytes.length - HEADER_SIZE - CRC_SIZE) throw new Error("QPCR3 payload length is invalid.");
  const expectedCrc = view.getUint32(bytes.length - CRC_SIZE, true); const actualCrc = crc32c(bytes.subarray(0, bytes.length - CRC_SIZE));
  if (expectedCrc !== actualCrc) throw new Error("QPCR3 CRC32C check failed.");
  const reader = new ByteReader(bytes.subarray(HEADER_SIZE, bytes.length - CRC_SIZE));
  const createdAt = reader.string(128, "QPCR3 createdAt"); if (Number.isNaN(Date.parse(createdAt))) throw new Error("QPCR3 createdAt is invalid.");
  const seed = reader.string(MAX_SEED_UTF8_BYTES, "QPCR3 seed");
  const initial = readInitial(reader, flags & 1 ? MOBILE_BOARD_HEIGHT : BOARD_HEIGHT);
  const eventBytes = reader.raw(eventCount * 2).slice(); const events = packedReplayEvents(eventBytes, eventCount);
  const checkpointCount = reader.u16(); if (checkpointCount > Math.floor(eventCount / 10) + 3) throw new Error("QPCR3 checkpoint count is invalid.");
  const checkpoints: ReplayCheckpoint[] = [];
  let previousIndex = -1;
  for (let index = 0; index < checkpointCount; index += 1) {
    const eventIndex = reader.u32(); const pcCount = reader.u32(); const reasonCode = reader.u8(); const checksum = reader.u32();
    const reason = CHECKPOINT_REASON[reasonCode]; if (!reason) throw new Error("QPCR3 checkpoint reason is invalid.");
    if (eventIndex > eventCount || eventIndex <= previousIndex) throw new Error("QPCR3 checkpoint event index is invalid.");
    checkpoints.push({ eventIndex, pcCount, reason, checksum }); previousIndex = eventIndex;
  }
  if (reader.remaining !== 0) throw new Error("QPCR3 container has trailing payload bytes.");
  const replay: ReplayDataV3 = {
    format: REPLAY_FORMAT, version: QPCR3_VERSION, createdAt, seed, initial, events, checkpoints,
    containerVersion, replaySemanticsVersion: semantics, checkpointSchemaVersion: checkpointSchema,
  };
  verifyReplaySemanticsDetailed(replay);
  return replay;
}
