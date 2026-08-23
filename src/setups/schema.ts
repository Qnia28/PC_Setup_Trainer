import { BOARD_WIDTH, ORIENTATIONS, PIECES, type Cell, type Cycle, type Orientation, type Piece } from "../engine/types";
import { localCells, sortedCellKey } from "../engine/pieces";

export interface TargetPlacement {
  id: string;
  piece: Piece;
  cells: Cell[];
  orientation?: Orientation;
  origin?: Cell;
}

export interface EquivalentPlacementVariant {
  id: string;
  translations: Array<{
    placementId: string;
    dx: number;
    dy: number;
  }>;
}

/** Recommendation data domain. Cycle 8 is routed while the game phase is Cycle 1. */
export type SetupCycle = Cycle | 8;

export interface SetupVariant {
  id: string;
  cycle: SetupCycle;
  family: string;
  displayName: string;
  /** 같은 setup family 안에서 구축 큐가 달라지는 원본 형태를 구분한다. */
  formLabel?: string;
  /** 조건부 좌우 선택에 사용하는 런타임 방향. 미러 생성 시 함께 반전한다. */
  side?: "left" | "right" | "neutral";
  /** 여러 형상·회전·미러 중 추천 목록에는 가장 좋은 하나만 남길 논리 그룹이다. */
  recommendationGroup?: string;
  pieceSignature: Piece[];
  /** Policy-only colored target after line clears; never an initial BFS setup or placement order. */
  geometryKind?: "solution-shadow";
  placements: TargetPlacement[];
  /** Canonical geometry remains stored once; these physical alternatives are expanded before BFS. */
  equivalentPlacementVariants?: EquivalentPlacementVariant[];
  /** Canonical colored one-page v115 field Fumen for the promoted source geometry. */
  fumen?: string;
  mirrorOf?: string;
  mirroredVariantId?: string;
  /** Runtime-derived geometry가 selection policy를 상속할 원본 setup ID. 승격 JSON에는 저장하지 않는다. */
  policySourceId?: string;
  derivedVariant?: "mirror" | "rotation" | "translation" | "rotation-translation" | "box-minimal";
  solveRate?: number;
  /** source geometry를 좌우 반전했을 때의 퍼클률. I-spin 비대칭 때문에 solveRate와 다를 수 있다. */
  mirroredSolveRate?: number;
  saves?: number;
  /** 5회차 출처에서 조건 없는 세이브 최적화(Bestsave)로 확인된 셋업. */
  bestsave?: boolean;
  /** 승격된 source record 중 현재 런타임 탐색 형식으로 안전하게 실행 가능한지 여부다. */
  runtimeEligible?: boolean;
  /** percentage는 출처의 Saves%, project-priority는 프로젝트 기본 0/1 우선순위다. */
  saveMetricKind?: "percentage" | "project-priority";
  /** 사용자가 검토기에서 지정하는 추천 우선순위. 높을수록 우선하며 미지정 시 0이다. */
  priority?: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  reviewStatus: "draft" | "reviewed";
}

function isPiece(value: unknown): value is Piece {
  return typeof value === "string" && (PIECES as readonly string[]).includes(value);
}

function placementMatchesTetromino(placement: TargetPlacement): boolean {
  const target = sortedCellKey(placement.cells);
  for (const orientation of ORIENTATIONS) {
    const shape = localCells(placement.piece, orientation);
    for (const targetCell of placement.cells) {
      for (const shapeCell of shape) {
        const dx = targetCell.x - shapeCell.x;
        const dy = targetCell.y - shapeCell.y;
        const moved = shape.map(({ x, y }) => ({ x: x + dx, y: y + dy }));
        if (sortedCellKey(moved) === target) return true;
      }
    }
  }
  return false;
}

export function validateSetup(setup: SetupVariant): string[] {
  const errors: string[] = [];
  const solutionShadow = setup.geometryKind === "solution-shadow";
  if (!setup.id) errors.push("id가 없습니다.");
  if (setup.geometryKind !== undefined && setup.geometryKind !== "solution-shadow") {
    errors.push("geometryKind가 올바르지 않습니다.");
  }
  if (setup.placements.length < 1 || setup.placements.length > 8) errors.push("placement는 1~8개여야 합니다.");
  if (setup.pieceSignature.length !== setup.placements.length || setup.pieceSignature.some((piece) => !isPiece(piece))) {
    errors.push(`pieceSignature는 유효한 미노 ${setup.placements.length}개여야 합니다.`);
  }
  const occupied = new Set<string>();
  for (const placement of setup.placements) {
    if (!isPiece(placement.piece)) errors.push(`${placement.id}: 잘못된 piece입니다.`);
    if (placement.cells.length !== 4) errors.push(`${placement.id}: cell이 4개가 아닙니다.`);
    if (!solutionShadow && !placementMatchesTetromino(placement)) errors.push(`${placement.id}: 미노 형태와 cell이 일치하지 않습니다.`);
    if (solutionShadow && (placement.orientation !== undefined || placement.origin !== undefined)) {
      errors.push(`${placement.id}: solution-shadow는 실행 순서 정보를 가질 수 없습니다.`);
    }
    for (const cell of placement.cells) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) errors.push(`${placement.id}: 좌표는 정수여야 합니다.`);
      if (cell.x < 0 || cell.x >= BOARD_WIDTH || cell.y < 0 || cell.y >= 4) errors.push(`${placement.id}: 10×4 영역 밖 좌표입니다.`);
      const key = `${cell.x},${cell.y}`;
      if (occupied.has(key)) errors.push(`${placement.id}: ${key}가 겹칩니다.`);
      occupied.add(key);
    }
  }
  if (occupied.size !== setup.placements.length * 4) errors.push(`총 점유 칸이 ${occupied.size}개입니다(${setup.placements.length * 4}개 필요).`);
  const placementPieces = setup.placements.map(({ piece }) => piece).sort().join("");
  const signature = [...setup.pieceSignature].sort().join("");
  if (placementPieces !== signature) errors.push("pieceSignature와 placements의 미노 구성이 다릅니다.");
  if (setup.fumen !== undefined && (typeof setup.fumen !== "string" || !setup.fumen.startsWith("v115@"))) {
    errors.push("fumen은 v115@ 형식이어야 합니다.");
  }
  if (solutionShadow && setup.fumen === undefined && setup.derivedVariant !== "mirror") {
    errors.push("source solution-shadow에는 canonical fumen이 필요합니다.");
  }
  if (solutionShadow && (setup.equivalentPlacementVariants?.length ?? 0) > 0) {
    errors.push("solution-shadow에는 equivalentPlacementVariants를 사용할 수 없습니다.");
  }
  if (setup.solveRate !== undefined && (setup.solveRate < 0 || setup.solveRate > 100)) errors.push("solveRate는 0~100이어야 합니다.");
  if (setup.mirroredSolveRate !== undefined && (setup.mirroredSolveRate < 0 || setup.mirroredSolveRate > 100)) errors.push("mirroredSolveRate는 0~100이어야 합니다.");
  if (setup.saves !== undefined && (setup.saves < 0 || setup.saves > 100)) errors.push("saves는 0~100이어야 합니다.");
  if (setup.runtimeEligible !== undefined && typeof setup.runtimeEligible !== "boolean") {
    errors.push("runtimeEligible은 boolean이어야 합니다.");
  }
  if (setup.priority !== undefined
    && (!Number.isFinite(setup.priority) || setup.priority < -100 || setup.priority > 100)) {
    errors.push("priority는 -100~100이어야 합니다.");
  }
  const variantIds = new Set<string>();
  const placementIds = new Set(setup.placements.map(({ id }) => id));
  for (const variant of setup.equivalentPlacementVariants ?? []) {
    if (!variant.id || variantIds.has(variant.id)) errors.push("equivalent placement variant id가 없거나 중복입니다.");
    variantIds.add(variant.id);
    if (!Array.isArray(variant.translations) || variant.translations.length === 0) {
      errors.push(`${variant.id}: translation이 없습니다.`);
      continue;
    }
    const movedIds = new Set<string>();
    for (const translation of variant.translations) {
      if (!placementIds.has(translation.placementId)) errors.push(`${variant.id}: 존재하지 않는 placement입니다.`);
      if (movedIds.has(translation.placementId)) errors.push(`${variant.id}: placement translation이 중복입니다.`);
      movedIds.add(translation.placementId);
      if (!Number.isInteger(translation.dx) || !Number.isInteger(translation.dy)
        || (translation.dx === 0 && translation.dy === 0)) {
        errors.push(`${variant.id}: translation offset이 올바르지 않습니다.`);
      }
    }
    const offsets = new Map(variant.translations.map(({ placementId, dx, dy }) => [placementId, { dx, dy }]));
    const variantOccupied = new Set<string>();
    for (const placement of setup.placements) {
      const { dx = 0, dy = 0 } = offsets.get(placement.id) ?? {};
      for (const cell of placement.cells) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        const key = `${x},${y}`;
        if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= 4) errors.push(`${variant.id}: ${key}가 10×4 영역 밖입니다.`);
        if (variantOccupied.has(key)) errors.push(`${variant.id}: ${key}가 겹칩니다.`);
        variantOccupied.add(key);
      }
    }
  }
  return [...new Set(errors)];
}

export function isSolutionShadowSetup(setup: SetupVariant): boolean {
  return setup.geometryKind === "solution-shadow";
}

export function assertValidCatalog(catalog: SetupVariant[]): void {
  const ids = new Set<string>();
  for (const setup of catalog) {
    if (ids.has(setup.id)) throw new Error(`중복 setup id: ${setup.id}`);
    ids.add(setup.id);
    const errors = validateSetup(setup);
    if (errors.length) throw new Error(`${setup.id}\n- ${errors.join("\n- ")}`);
  }
  for (const setup of catalog) {
    if (setup.mirrorOf && !ids.has(setup.mirrorOf)) throw new Error(`${setup.id}: mirrorOf가 존재하지 않습니다.`);
    if (setup.mirroredVariantId && !ids.has(setup.mirroredVariantId)) throw new Error(`${setup.id}: mirroredVariantId가 존재하지 않습니다.`);
  }
}
