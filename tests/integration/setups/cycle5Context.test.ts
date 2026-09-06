import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import { PIECES, type Piece } from "../../../src/engine/types";
import { setupCatalog, setupsForCycle5Class, sourceSetupCatalog } from "../../../src/setups/catalog";
import { queryCycle5ClassCatalog, querySetups, type SetupQuery } from "../../../src/setups/query";
import type { SetupVariant, TargetPlacement } from "../../../src/setups/schema";
import { cycle5PiecePairKey, cycle5QueueContext, fitsCycle5BuildPool } from "../../../src/setups/cycle5Context";

function setupId(slug: string, item: number, frame = 0): string {
  return `cycle5-${slug}-${String(item).padStart(3, "0")}-f${String(frame).padStart(3, "0")}`;
}

function expandItems(slug: string, specifications: Array<[number, number?]>): string[] {
  return specifications.flatMap(([item, frameCount = 1]) =>
    Array.from({ length: frameCount }, (_, frame) => setupId(slug, item, frame)));
}

const implicit100SetupIds = [
  ...expandItems("to", [[1], [3], [4]]),
  ...expandItems("tstz", [[1], [3], [4], [5], [6]]),
  ...expandItems("ilij", [[1], [2], [8], [9], [10], [11], [12], [13], [14], [15], [16], [26], [27]]),
  ...expandItems("oi", [[1], [2], [3], [4], [6], [7], [8], [9], [10], [11]]),
  ...expandItems("lj", [
    [1], [2], [3], [4], [6, 2], [7], [8], [9], [10, 2], [11],
    [18], [19], [20], [22], [23], [24, 8], [25, 8], [26, 2], [27, 2], [28, 2], [29, 2],
  ]),
  ...expandItems("oloj", [[1], [2], [3], [7], [8], [9], [10], [11], [12], [13]]),
  ...expandItems("isiz", [[1], [8], [9], [10], [11], [12], [13], [14]]),
  ...expandItems("osoz", [[8], [9], [10]]),
  ...expandItems("lsjz", [[8]]),
  ...expandItems("lzjs", [[8], [9], [10], [11]]),
];

function query(overrides: Partial<SetupQuery> = {}): SetupQuery {
  return {
    cycle: 5,
    board: createBoard(),
    hold: "T",
    active: "O",
    next: ["I", "L", "J", "S", "Z"],
    holdAvailable: true,
    ...overrides,
  };
}

function placement(id: string, piece: Piece, cells: TargetPlacement["cells"]): TargetPlacement {
  return { id, piece, cells };
}

function setup(
  id: string,
  { bestsave = false, side = "left" }: { bestsave?: boolean; side?: "left" | "right" } = {},
): SetupVariant {
  const onLeft = side === "left";
  const placements = [
    placement(`${id}-o`, "O", onLeft
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      : [{ x: 8, y: 0 }, { x: 9, y: 0 }, { x: 8, y: 1 }, { x: 9, y: 1 }]),
    placement(`${id}-i`, "I", onLeft
      ? [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }]
      : [{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }]),
  ];
  return {
    id,
    cycle: 5,
    family: id,
    displayName: id,
    pieceSignature: ["O", "I"],
    placements,
    solveRate: 100,
    bestsave,
    difficulty: 1,
    reviewStatus: "draft",
  };
}

describe("5회차 2+7+2 일반 셋업 추천 context", () => {
  it("정규화된 source 413개 중 정적 7P 41개를 런타임에서 제외한다", () => {
    const source = sourceSetupCatalog.filter(({ cycle }) => cycle === 5);
    const runtime = setupCatalog.filter(({ cycle }) => cycle === 5);
    expect(source).toHaveLength(413);
    expect(source.filter(({ placements }) => placements.length === 7)).toHaveLength(41);
    expect(source.filter(({ placements }) => placements.length === 7)
      .every(({ runtimeEligible }) => runtimeEligible === false)).toBe(true);
    expect(runtime.length).toBeGreaterThan(0);
    expect(runtime.every(({ placements, runtimeEligible }) => placements.length <= 6 && runtimeEligible !== false)).toBe(true);
  });

  it("승격 시 확정된 bestsave 플래그와 Qnia geometry 41개를 런타임에 보존한다", () => {
    const source = sourceSetupCatalog.filter(({ cycle }) => cycle === 5);
    const bestsave = source.filter((setup) => setup.bestsave === true);
    const added = source.filter(({ id }) => id.includes("-qnia-"));

    expect(bestsave).toHaveLength(72);
    expect(added).toHaveLength(41);
    expect(added.every(({ bestsave: value }) => value === true)).toBe(true);
    expect(added.every(({ difficulty, runtimeEligible }) =>
      difficulty === 4 && runtimeEligible !== false)).toBe(true);
  });

  it("QSC TX 상단 6P에서 파생한 5P 20개를 class별 실시간 BFS가 실제로 구축한다", () => {
    const promoted = sourceSetupCatalog.filter(({ id }) => id.includes("-qnia-tx-") && id.includes("-5p-"));
    expect(promoted).toHaveLength(20);
    expect(promoted.every(({ placements, bestsave, runtimeEligible }) =>
      placements.length === 5 && bestsave === true && runtimeEligible !== false)).toBe(true);

    const classPiecesBySlug: Record<string, [Piece, Piece]> = {
      tltj: ["T", "L"],
      ti: ["T", "I"],
      to: ["T", "O"],
      tstz: ["T", "S"],
    };
    const permutations = <T,>(values: T[]): T[][] => values.length <= 1
      ? [values]
      : values.flatMap((value, index) => permutations(values.filter((_, item) => item !== index))
        .map((suffix) => [value, ...suffix]));

    for (const candidate of promoted) {
      const slug = Object.keys(classPiecesBySlug).find((key) => candidate.id.startsWith(`cycle5-${key}-`));
      expect(slug, candidate.id).toBeDefined();
      const [left, right] = classPiecesBySlug[slug!];
      const required = [...candidate.pieceSignature];
      for (const piece of [left, right]) {
        const index = required.indexOf(piece);
        if (index >= 0) required.splice(index, 1);
      }
      expect(new Set(required).size, `${candidate.id}: next-bag requirement must be unique`).toBe(required.length);
      const nextPool = [...required, ...PIECES.filter((piece) => !required.includes(piece))].slice(0, 5);
      expect(new Set(nextPool)).toHaveLength(5);

      let buildable = false;
      for (const [hold, active] of [[left, right], [right, left]] as Array<[Piece, Piece]>) {
        for (const next of permutations(nextPool)) {
          if (queryCycle5ClassCatalog([candidate], query({ hold, active, next })).length > 0) {
            buildable = true;
            break;
          }
        }
        if (buildable) break;
      }
      expect(buildable, `${candidate.id}: no legal Cycle 5 observation can build this 5P partial`).toBe(true);
    }
  }, 30_000);

  it("QSC TX 계층을 10개 staged 논리 그룹으로 연결하고 TS row 4 예외를 제외한다", () => {
    const staged = sourceSetupCatalog.filter(({ recommendationGroup }) =>
      recommendationGroup?.startsWith("stage:qnia-cycle-5-tx-"));
    const groups = staged.reduce((result, setup) => {
      const group = setup.recommendationGroup!;
      result.set(group, [...(result.get(group) ?? []), setup]);
      return result;
    }, new Map<string, SetupVariant[]>());

    expect(staged).toHaveLength(32);
    expect(groups.size).toBe(10);
    expect(staged.filter(({ id }) => id.includes("-qnia-tx-") && id.includes("-5p-"))).toHaveLength(20);
    expect([...groups.values()].filter((members) =>
      members.map(({ placements }) => placements.length).sort().join(",") === "4,5,5,6")).toHaveLength(2);
    expect([...groups.values()].filter((members) =>
      members.map(({ placements }) => placements.length).sort().join(",") === "4,5,5")).toHaveLength(8);
    expect(staged.some(({ recommendationGroup }) => recommendationGroup?.includes("tx-ts-r004"))).toBe(false);
  });

  it("원문 bold-only 100%와 IL-Z 방향별 확률을 런타임 catalog에 보존한다", () => {
    const runtime = setupCatalog.filter(({ cycle }) => cycle === 5);
    const byId = new Map(runtime.map((setup) => [setup.id, setup]));
    const verifiedIds = implicit100SetupIds;
    expect(new Set(verifiedIds)).toHaveLength(98);
    const sourceById = new Map(sourceSetupCatalog.filter(({ cycle }) => cycle === 5)
      .map((setup) => [setup.id, setup]));
    const runtimeEligibleIds = verifiedIds.filter((id) => sourceById.get(id)?.runtimeEligible !== false);
    expect(runtimeEligibleIds.length).toBeGreaterThan(0);
    for (const id of runtimeEligibleIds) expect(byId.get(id)?.solveRate).toBe(100);
    expect(byId.get("cycle5-ilij-003-f000")).toMatchObject({
      solveRate: 99.05,
      mirroredSolveRate: 100,
    });
  });

  it("HOLD+ACTIVE로 class를 정하고 다음 bag 앞 5미노까지만 BFS 풀에 넣는다", () => {
    expect(cycle5QueueContext(query())).toEqual({
      classPieces: ["T", "O"],
      buildPieces: ["T", "O", "I", "L", "J", "S", "Z"],
      searchNext: ["I", "L", "J", "S", "Z"],
      placeableNextCount: 5,
      classificationMode: "normal-distinct-pair",
    });
  });

  it("class key는 HOLD와 ACTIVE 순서에 무관하다", () => {
    expect(cycle5PiecePairKey(["T", "O"])).toBe(cycle5PiecePairKey(["O", "T"]));
    expect(cycle5PiecePairKey(["T", "O"])).toBe("OT");
  });

  it("정상 서로 다른 미노쌍 21개를 모두 class-addressable catalog에 연결한다", () => {
    const keys = new Set<string>();
    for (let left = 0; left < PIECES.length; left += 1) {
      for (let right = left + 1; right < PIECES.length; right += 1) {
        const pair = [PIECES[left], PIECES[right]] as Piece[];
        keys.add(cycle5PiecePairKey(pair));
        expect(setupsForCycle5Class(pair).length).toBeGreaterThan(0);
        expect(setupsForCycle5Class([...pair].reverse())).toEqual(setupsForCycle5Class(pair));
      }
    }
    expect(keys).toHaveLength(21);
  });

  it("HOLD가 없거나 다음 bag 앞 5미노가 정상 7-bag prefix가 아니면 판정하지 않는다", () => {
    expect(cycle5QueueContext(query({ hold: null }))).toBeNull();
    expect(cycle5QueueContext(query({ next: ["I", "L", "J", "S"] }))).toBeNull();
    expect(cycle5QueueContext(query({ next: ["I", "I", "J", "S", "Z"] }))).toBeNull();
  });

  it("중복 첫 두 미노를 정상 distinct-pair class로 오분류하지 않는다", () => {
    expect(cycle5QueueContext(query({ hold: "O", active: "O" }))).toMatchObject({
      classPieces: ["O", "O"],
      classificationMode: "duplicate-pair-unsupported",
    });
  });

  it("setup signature의 중복 개수와 최대 7P 경계를 multiset으로 검사한다", () => {
    const base = setup("base");
    const repeatedT = {
      ...base,
      pieceSignature: ["T", "T"] as Piece[],
      placements: base.placements.map((target, index) => ({ ...target, piece: "T" as Piece, id: `t-${index}` })),
    };
    expect(fitsCycle5BuildPool(base, ["T", "O", "I", "L", "J", "S", "Z"])).toBe(true);
    expect(fitsCycle5BuildPool(repeatedT, ["T", "O", "I", "L", "J", "S", "Z"])).toBe(false);
  });

  it("선택된 한 class catalog만 실시간 BFS로 조회하고 bestsave를 별도 순위로 사용하지 않는다", () => {
    const regular = setup("cycle5-to-a-regular", { side: "left" });
    const bestsave = setup("cycle5-to-z-bestsave", { bestsave: true, side: "right" });
    const candidates = queryCycle5ClassCatalog([regular, bestsave], query());
    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ setup }) => setup.id)).toEqual(["cycle5-to-a-regular", "cycle5-to-z-bestsave"]);
    expect(candidates[0].reasons[0]).toBe("Classified as Cycle 5 T/O from HOLD + ACTIVE.");
    expect(candidates[1].reasons.some((reason) => reason.includes("Cycle 6 No T"))).toBe(true);
    expect(candidates.every(({ plan }) => plan.steps.filter(({ action }) => action === "place").length === 2)).toBe(true);
  });

  it("TS-OI 4P를 홀드가 적은 고난도 TS-O 3P보다 먼저 추천한다", () => {
    const candidates = querySetups(query({
      active: "S",
      hold: "T",
      next: ["O", "I", "T", "L", "J"],
    }));
    const tsOiIndex = candidates.findIndex(({ setup }) => setup.displayName === "TS-OI");
    const tsOIndex = candidates.findIndex(({ setup }) => setup.displayName === "TS-O");
    const tsOi = candidates[tsOiIndex];
    const tsO = candidates[tsOIndex];

    expect(tsOiIndex).toBeGreaterThanOrEqual(0);
    expect(tsOIndex).toBeGreaterThanOrEqual(0);
    expect(tsOi!.setup).toMatchObject({ solveRate: 100, priority: 0, difficulty: 3 });
    expect(tsO!.setup).toMatchObject({ solveRate: 100, priority: 0, difficulty: 4 });
    expect(tsOi!.plan.holds).toBeGreaterThan(tsO!.plan.holds);
    expect(tsOiIndex).toBeLessThan(tsOIndex);
  });

  it("TO-[TIJ]!에서 고급 TO-[TIL]! 셋업의 좌우반전형을 추천한다", () => {
    const candidates = querySetups(query({
      hold: "O",
      active: "T",
      next: ["I", "J", "T", "S", "L"],
    }));

    expect(candidates.find(({ setup }) => setup.id === "cycle5-advanced-to-001-f000--mirror"))
      .toMatchObject({
        setup: {
          displayName: "TO-[TIJ]! (⇔ TO-[TIL]!)",
          derivedVariant: "mirror",
        },
        policy: {
          ruleId: "to5-advanced-direct-006",
          branchId: "initial",
        },
        qbCondition: "to5-advanced-direct-006",
        recommendationLabel: "TO - [TIJ]! QB",
      });
  });

  it("정식 querySetups가 일반 후보와 활성 고급 QB 후보를 별도 분류로 함께 반환한다", () => {
    const candidates = querySetups(query());
    expect(candidates.some(({ qbCondition }) => qbCondition === undefined)).toBe(true);
    expect(candidates.find(({ setup }) => setup.id === "cycle5-advanced-to-006-f000")).toMatchObject({
      setup: {
        id: "cycle5-advanced-to-006-f000",
        placements: expect.any(Array),
      },
      recommendationSource: {
        bundleId: "promoted:cycle5-advanced-to",
        kind: "cycle5-advanced",
      },
      policy: {
        ruleId: "to5-advanced-ilj-2",
        branchId: "initial",
      },
      qbCondition: "to5-advanced-ilj-2",
    });
    expect(candidates.find(({ setup }) => setup.id === "cycle5-advanced-to-006-f000")!
      .setup.placements.length).toBeLessThanOrEqual(6);
  });

  it("중복 class와 다른 회차 query에는 후보를 반환하지 않는다", () => {
    const catalog = [setup("cycle5-to")];
    expect(queryCycle5ClassCatalog(catalog, query({ hold: "O", active: "O" }))).toEqual([]);
    expect(queryCycle5ClassCatalog(catalog, { ...query(), cycle: 4 })).toEqual([]);
  });
});
