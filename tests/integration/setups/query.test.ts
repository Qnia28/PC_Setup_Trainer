import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import type { Piece } from "../../../src/engine/types";
import { limitSetupCandidatesForCycle, queryCatalog, queryCatalogCooperative, querySetups, type SetupCandidate } from "../../../src/setups/query";
import { setupCatalog, sourceSetupCatalog } from "../../../src/setups/catalog";
import type { SetupVariant } from "../../../src/setups/schema";

function stageHierarchyFixture() {
  const source = sourceSetupCatalog.find(({ id }) => id === "cycle1-grace-system-a")!;
  const pieces = [..."IZSOLJ"] as Piece[];
  const query = {
    cycle: 1 as const,
    board: createBoard(),
    active: pieces[0]!,
    hold: null,
    next: pieces.slice(1),
  };
  const sourcePlan = queryCatalog([source], query)[0]!.plan;
  const placementOrder: Piece[] = sourcePlan.steps
    .filter((step) => step.action === "place")
    .map(({ piece }) => piece);
  const atStage = (count: number, id: string, group = "stage:test-hierarchy"): SetupVariant => {
    const included = new Set(placementOrder.slice(0, count));
    const placements = source.placements.filter(({ piece }) => included.has(piece));
    return {
      ...source,
      id,
      family: id,
      recommendationGroup: group,
      placements,
      pieceSignature: placements.map(({ piece }) => piece).sort(),
    };
  };
  const makeUnbuildable = (setup: SetupVariant, id: string): SetupVariant => {
    const placements = setup.placements.map((placement, index) => index === 0
      ? { ...placement, piece: "T" as Piece }
      : placement);
    return { ...setup, id, family: id, placements, pieceSignature: placements.map(({ piece }) => piece).sort() };
  };
  return { query, atStage, makeUnbuildable };
}

describe("setup catalog/query", () => {
  it("1회차와 5회차 3P 셋업에 회차별 난이도를 적용한다", () => {
    const cycle1ThreePiece = sourceSetupCatalog.filter(
      ({ cycle, placements }) => cycle === 1 && placements.length === 3,
    );
    const cycle5ThreePiece = sourceSetupCatalog.filter(
      ({ cycle, placements }) => cycle === 5 && placements.length === 3,
    );

    expect(cycle1ThreePiece).toHaveLength(12);
    expect(cycle1ThreePiece.every(({ difficulty }) => difficulty === 5)).toBe(true);
    expect(cycle5ThreePiece).toHaveLength(83);
    expect(cycle5ThreePiece.every(({ difficulty }) => difficulty === 4)).toBe(true);
  });

  it("정식 런타임 셋업의 이름·별칭·form label은 영어 표기다", () => {
    for (const setup of sourceSetupCatalog) {
      expect(setup.displayName).not.toMatch(/[가-힣]/);
      expect(setup.formLabel ?? "").not.toMatch(/[가-힣]/);
      for (const alias of (setup as SetupVariant & { aliases?: string[] }).aliases ?? []) expect(alias).not.toMatch(/[가-힣]/);
    }
  });

  it("같은 ILOT 구축 풀에서 일반·고급 3P·QB 후보와 tier 순서를 함께 유지한다", () => {
    const candidates = querySetups({
      cycle: 2,
      board: createBoard(),
      hold: "I",
      active: "L",
      next: ["O", "T", "S", "Z", "J"],
      holdAvailable: true,
    });
    expect(candidates.some(({ setup }) => setup.id === "pcinfokorea-c2-002-f0")).toBe(true);
    expect(candidates.some(({ setup }) => setup.id === "cycle2-advanced-odd-toiltoij-001-f000")).toBe(true);
    expect(candidates.some(({ setup }) => setup.placements.length === 4)).toBe(true);
    expect(candidates.some(({ setup }) => setup.placements.length === 3)).toBe(true);
    const generalIndex = candidates.findIndex(({ setup }) => setup.id.startsWith("pcinfokorea-c2-"));
    const qbIndex = candidates.findIndex(({ qbCondition }) => qbCondition !== undefined);
    const advanced3pIndex = candidates.findIndex(({ setup }) =>
      setup.id.startsWith("cycle2-advanced-") && !setup.id.includes("-qb-"));
    expect(generalIndex).toBeGreaterThanOrEqual(0);
    expect(advanced3pIndex).toBeGreaterThan(generalIndex);
    expect(qbIndex).toBeGreaterThan(advanced3pIndex);
    expect(candidates[qbIndex]?.setup.solveRate).toBeUndefined();
  });

  it("협력형 catalog 검색은 동기 검색과 같은 후보와 plan을 반환한다", async () => {
    const setup = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const pieces = [..."IOJS"] as Piece[];
    const query = {
      cycle: 1 as const,
      board: createBoard(),
      active: pieces[0]!,
      hold: null,
      next: pieces.slice(1),
    };
    const synchronous = queryCatalog([setup], query);
    let expandedNodes = 0;
    const cooperative = await queryCatalogCooperative([setup], query, {
      onNode() { expandedNodes += 1; },
    });
    expect(cooperative).toEqual(synchronous);
    expect(expandedNodes).toBeGreaterThan(0);
  });

  it("staged recommendation group은 BFS 가능한 최고 6P만 남긴다", () => {
    const { query, atStage } = stageHierarchyFixture();
    const candidates = queryCatalog([
      atStage(4, "stage-4p"),
      atStage(5, "stage-5p-a"),
      atStage(5, "stage-5p-b"),
      atStage(6, "stage-6p"),
    ], query);
    expect(candidates.map(({ setup }) => setup.id)).toEqual(["stage-6p"]);
  });

  it("6P가 불가능하면 가능한 두 5P 형제를 안정 순서로 모두 남긴다", () => {
    const { query, atStage, makeUnbuildable } = stageHierarchyFixture();
    const candidates = queryCatalog([
      atStage(5, "stage-5p-z"),
      makeUnbuildable(atStage(6, "stage-6p"), "stage-6p-unbuildable"),
      atStage(4, "stage-4p"),
      atStage(5, "stage-5p-a"),
      atStage(5, "stage-5p-a--mirror"),
    ], query);
    expect(candidates.map(({ setup }) => setup.id)).toEqual(["stage-5p-a", "stage-5p-z"]);
  });

  it("6P와 5P가 모두 불가능하면 4P로 fallback한다", () => {
    const { query, atStage, makeUnbuildable } = stageHierarchyFixture();
    const candidates = queryCatalog([
      makeUnbuildable(atStage(6, "stage-6p"), "stage-6p-unbuildable"),
      makeUnbuildable(atStage(5, "stage-5p"), "stage-5p-unbuildable"),
      atStage(4, "stage-4p"),
    ], query);
    expect(candidates.map(({ setup }) => setup.id)).toEqual(["stage-4p"]);
  });

  it("일반 recommendation group은 기존처럼 하나만 남기고 비그룹 후보는 유지한다", () => {
    const { query, atStage } = stageHierarchyFixture();
    const candidates = queryCatalog([
      atStage(4, "normal-z", "normal:test"),
      atStage(4, "normal-a", "normal:test"),
      { ...atStage(4, "ungrouped"), recommendationGroup: undefined },
    ], query);
    expect(candidates.map(({ setup }) => setup.id)).toEqual(["normal-a", "ungrouped"]);
  });

  it("staged 최고 단계 투영은 협력형 BFS와 동기 BFS에서 동일하다", async () => {
    const { query, atStage, makeUnbuildable } = stageHierarchyFixture();
    const catalog = [
      atStage(5, "stage-5p-z"),
      makeUnbuildable(atStage(6, "stage-6p"), "stage-6p-unbuildable"),
      atStage(4, "stage-4p"),
      atStage(5, "stage-5p-a"),
    ];
    const synchronous = queryCatalog(catalog, query);
    const cooperative = await queryCatalogCooperative(catalog, query, { onNode() {} });
    expect(cooperative).toEqual(synchronous);
  });

  it("Grace System을 하나의 family와 구축 큐가 다른 두 6P 형태로 유지한다", () => {
    const forms = sourceSetupCatalog.filter(({ family }) => family === "grace-system");
    expect(forms).toHaveLength(2);
    expect(forms.map(({ formLabel }) => formLabel).sort()).toEqual(["A", "B"]);
    expect(forms.every(({ placements, pieceSignature, solveRate }) => placements.length === 6 && pieceSignature.length === 6 && solveRate === 88.57)).toBe(true);
  });

  it("Grace System A/B를 각각 실제 6개 큐에서 구축한다", () => {
    const formA = sourceSetupCatalog.find(({ id }) => id === "cycle1-grace-system-a")!;
    const formB = sourceSetupCatalog.find(({ id }) => id === "cycle1-grace-system-b")!;
    const run = (setup: typeof formA, queue: string) => {
      const pieces = [...queue] as Piece[];
      return queryCatalog([setup], {
        cycle: 1,
        board: createBoard(),
        active: pieces[0],
        hold: null,
        next: pieces.slice(1),
      });
    };
    expect(run(formA, "IZSOLJ")).toHaveLength(1);
    expect(run(formB, "JLOSZI")).toHaveLength(1);
  });

  it("HOLD가 빈 1회차에서 숨은 마지막 bag 미노까지 복원해 6P 셋업을 추천한다", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      active: "O",
      hold: null,
      next: ["S", "I", "T", "Z", "L"],
    });

    expect(candidates.some(({ setup }) => setup.family === "grace-system")).toBe(true);
  });

  it("6P PCO를 85.36%의 6개 미노 셋업으로 조회하고 구축한다", () => {
    const setup = sourceSetupCatalog.find(({ id }) => id === "cycle1-6p-pco-a")!;
    const pieces = [..."TSZLOJ"] as Piece[];
    const result = queryCatalog([setup], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(setup).toMatchObject({ family: "pco-6p", displayName: "6P PCO", solveRate: 85.36 });
    expect(setup.placements).toHaveLength(6);
    expect(result).toHaveLength(1);
  });

  it("PCINFO 고유 셋업의 canonical 이름과 방향별 확률을 운영 catalog에 보존한다", () => {
    const halfGrace = sourceSetupCatalog.find(({ id }) => id === "cycle1-pcinfo-006")!;
    const jaws = sourceSetupCatalog.find(({ id }) => id === "cycle1-jaws-a")!;
    const elephant = sourceSetupCatalog.find(({ id }) => id === "cycle1-elephant-a")!;
    const cliffO = sourceSetupCatalog.find(({ id }) => id === "cycle1-cliff-o-a")!;
    expect(halfGrace).toMatchObject({ displayName: "HALF GRACE", solveRate: 98.1, saves: 1 });
    expect(sourceSetupCatalog.some(({ id }) => id === "cycle1-pcinfo-001")).toBe(false);
    expect(jaws.displayName).toBe("JAWS");
    expect(elephant).toMatchObject({ solveRate: 98.21, mirroredSolveRate: 98.33 });
    expect(cliffO).toMatchObject({ solveRate: 98.1, mirroredSolveRate: 97.74 });
  });

  it("OILJ BOX는 승격 anchor와 허용된 mirror에서만 다섯 minimal을 만든다", () => {
    const source = sourceSetupCatalog.filter(({ id }) => id.startsWith("cycle1-pcinfo-020"));
    expect(source).toHaveLength(1);
    expect(source[0]).toMatchObject({ id: "cycle1-pcinfo-020", formLabel: "ILJO", solveRate: 92.46, saves: 1 });

    const runtime = setupCatalog.filter(({ cycle, pieceSignature, recommendationGroup }) =>
      cycle === 1
      && [...pieceSignature].sort().join("") === "IJLO"
      && recommendationGroup === "cycle1-box");
    expect(runtime).toHaveLength(10);
    expect(new Set(runtime.map(({ placements }) => Math.min(
      ...placements.flatMap(({ cells }) => cells.map(({ x }) => x)),
    )))).toEqual(new Set([0, 6]));
    expect(new Set(runtime
      .map(({ formLabel }) => formLabel?.match(/minimal (\d+)/)?.[1])
      .filter((value) => value !== undefined)).size).toBe(4);
  });

  it("같은 BOX 그룹에서 여러 형상이 가능해도 가장 높은 후보 하나만 추천한다", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      active: "I",
      hold: "T",
      next: ["L", "J", "O", "S", "Z"],
      holdAvailable: true,
    });
    const boxes = candidates.filter(({ setup }) => setup.recommendationGroup === "cycle1-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.setup).toMatchObject({ displayName: "BOX", solveRate: 92.46 });
    expect(candidates[0]?.setup.displayName).toBe("BOX");
  });

  it("ILJS와 ILJO 대표만 저장하고 모든 공용 BOX minimal을 하나의 추천 그룹으로 묶는다", () => {
    const boxes = sourceSetupCatalog.filter(({ cycle, family }) => cycle === 1 && family === "box");
    expect(boxes).toHaveLength(2);
    expect(new Set(boxes.map(({ recommendationGroup }) => recommendationGroup))).toEqual(new Set(["cycle1-box"]));
    const runtimeBoxes = setupCatalog.filter(({ cycle, recommendationGroup }) =>
      cycle === 1 && recommendationGroup === "cycle1-box");
    expect(runtimeBoxes).toHaveLength(36);
    expect(runtimeBoxes.filter(({ pieceSignature }) =>
      [...pieceSignature].sort().join("") === "IJLO")).toHaveLength(10);
    expect(runtimeBoxes.filter(({ pieceSignature }) => {
      const signature = [...pieceSignature].sort().join("");
      return signature === "IJLS" || signature === "IJLZ";
    })).toHaveLength(26);
  });

  it("2회차 OILJ BOX는 source와 mirror anchor에서만 SFinder minimal을 확장한다", () => {
    const forms = setupCatalog.filter(({ cycle, recommendationGroup }) =>
      cycle === 2 && recommendationGroup === "cycle2-oilj-box");
    expect(forms).toHaveLength(10);
    expect(new Set(forms.map(({ placements }) => Math.min(
      ...placements.flatMap(({ cells }) => cells.map(({ x }) => x)),
    )))).toEqual(new Set([0, 6]));
    expect(forms.every(({ derivedVariant }) => derivedVariant === "box-minimal")).toBe(true);
  });

  it("2회차 구축 탐색에는 HOLD + ACTIVE + NEXT 2만 사용한다", () => {
    const candidates = querySetups({
      cycle: 2,
      board: createBoard(),
      hold: "T",
      active: "I",
      next: ["S", "Z", "L", "O", "J"],
      holdAvailable: true,
    });
    expect(candidates.length).toBeGreaterThan(0);
    const buildPool = new Set<Piece>(["T", "I", "S", "Z"]);
    for (const candidate of candidates) {
      expect(candidate.setup.pieceSignature.every((piece) => buildPool.has(piece))).toBe(true);
      expect(candidate.plan.steps.filter(({ action }) => action === "place").every(({ piece }) => buildPool.has(piece))).toBe(true);
    }
  });

  it("OSZ 3P는 I 세이브인 IOSZ에서만 추천한다", () => {
    const queryPool = (pool: string) => {
      const [hold, active, next0, next1] = [...pool] as Piece[];
      return querySetups({
        cycle: 2,
        board: createBoard(),
        hold,
        active,
        next: [next0, next1, "J", "L", "T"],
        holdAvailable: true,
      }).filter(({ setup }) => setup.family === "osz");
    };
    expect(queryPool("IOSZ").length).toBeGreaterThan(0);
    expect(queryPool("LOSZ")).toHaveLength(0);
    expect(queryPool("JOSZ")).toHaveLength(0);
    expect(queryPool("TOSZ")).toHaveLength(0);
  });

  it("LOZ 3P는 T 세이브인 TLOZ에서만 추천한다", () => {
    const queryPool = (pool: string) => {
      const [hold, active, next0, next1] = [...pool] as Piece[];
      return querySetups({
        cycle: 2,
        board: createBoard(),
        hold,
        active,
        next: [next0, next1, "I", "J", "S"],
        holdAvailable: true,
      }).filter(({ setup }) => setup.family === "loz" && setup.placements.length === 3);
    };
    expect(queryPool("TLOZ").length).toBeGreaterThan(0);
    expect(queryPool("ILOZ")).toHaveLength(0);
    expect(queryPool("JLOZ")).toHaveLength(0);
    expect(queryPool("SLOZ")).toHaveLength(0);
  });

  it("7회차 OIS는 OS 2P를 구축하고 I를 남긴다", () => {
    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "I",
      active: "O",
      next: ["S", "Z", "L", "T", "J"],
      holdAvailable: true,
    });
    const ois = candidates.find(({ setup }) => setup.id === "pcinfokorea-c7-024-os");
    expect(ois).toBeDefined();
    expect(ois?.plan.steps.filter(({ action }) => action === "place").map(({ piece }) => piece).sort())
      .toEqual(["O", "S"]);
  });

  it("3x4 Box + O의 두 minimal과 좌우 attachment를 개별 도달성 검사한다", () => {
    const pieces = [..."JLOS"] as Piece[];
    const permutations = pieces.flatMap((a) =>
      pieces.filter((b) => b !== a).flatMap((b) =>
        pieces.filter((c) => c !== a && c !== b).map((c) => {
          const d = pieces.find((piece) => piece !== a && piece !== b && piece !== c)!;
          return [a, b, c, d] as Piece[];
        })));
    const seen = new Map<string, SetupCandidate>();
    for (const [hold, active, next0, next1] of permutations) {
      for (const candidate of querySetups({
        cycle: 2,
        board: createBoard(),
        hold,
        active,
        next: [next0, next1, "J", "L", "I"],
        holdAvailable: true,
      })) {
        if (candidate.setup.id.startsWith("pcinfokorea-c2-036-f")) seen.set(candidate.setup.id, candidate);
      }
      if (seen.size === 4) break;
    }
    expect([...seen.keys()].sort()).toEqual([
      "pcinfokorea-c2-036-f0",
      "pcinfokorea-c2-036-f0--box-minimal-m1-x0",
      "pcinfokorea-c2-036-f1",
      "pcinfokorea-c2-036-f1--box-minimal-m1-x0",
    ]);
    expect(seen.get("pcinfokorea-c2-036-f0")).toMatchObject({ setup: { side: "left", solveRate: 100 }, policy: { preferred: true } });
    expect(seen.get("pcinfokorea-c2-036-f0--box-minimal-m1-x0")).toMatchObject({ setup: { side: "left", solveRate: 100 }, policy: { preferred: true } });
    expect(seen.get("pcinfokorea-c2-036-f1")).toMatchObject({ setup: { side: "right", solveRate: 99.96 }, policy: { preferred: false } });
    expect(seen.get("pcinfokorea-c2-036-f1--box-minimal-m1-x0")).toMatchObject({ setup: { side: "right", solveRate: 99.96 }, policy: { preferred: false } });
  }, 15_000);

  it("다음 가방 방향 조건이 보이지 않으면 동일 확률 미러 후보를 임의로 합치지 않는다", () => {
    const simultaneous = querySetups({
      cycle: 2,
      board: createBoard(),
      hold: null,
      active: "J",
      next: ["L", "S", "T", "O", "I"],
      holdAvailable: true,
    }).filter(({ setup }) => setup.id === "pcinfokorea-c2-025-f0" || setup.id === "pcinfokorea-c2-025-f1");

    expect(simultaneous).toHaveLength(2);
    expect(simultaneous.every(({ policy }) => policy?.branchId === "unobserved")).toBe(true);
    expect(new Set(simultaneous.map(({ setup }) => setup.solveRate))).toEqual(new Set([99.96]));
  });

  it("스크린샷 큐에서 Hills 미러와 Elephant를 모두 반환하고 Hills를 먼저 추천한다", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      active: "L",
      hold: "I",
      next: ["O", "T", "S", "Z", "J"],
      holdAvailable: true,
    });
    expect(candidates.map(({ setup }) => setup.id)).toContain("cycle1-hills-a--mirror");
    expect(candidates.map(({ setup }) => setup.id)).toContain("cycle1-elephant-a");
    expect(candidates[0]?.setup.id).toBe("cycle1-hills-a--mirror");
    expect(candidates[0]?.setup.solveRate).toBe(98.45);
  });

  it("L>O replacement 상태에는 Cycle 8 L/J>X 셋업만 추천한다", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      active: "L",
      hold: "I",
      next: ["S", "Z", "T", "J", "L"],
      holdAvailable: true,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ setup }) => setup.cycle === 8)).toBe(true);
    expect(candidates.some(({ setup }) => setup.cycle === 1)).toBe(false);
  });

  it("동일 확률인 좌우 미러 셋업은 추천 목록에 하나만 반환한다", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      active: "Z",
      hold: "L",
      next: ["J", "T", "S", "O", "I"],
      holdAvailable: true,
    });
    const symmetricVariants = candidates.filter(({ setup }) =>
      setup.id.startsWith("cycle1-pcinfo-019"));

    expect(symmetricVariants).toHaveLength(1);
    expect(symmetricVariants[0]?.setup.solveRate).toBe(91.03);
  });

  it("priority·난이도보다 퍼클 확률을 먼저 적용한다", () => {
    const base = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const lowRate = { ...base, id: "low-rate", solveRate: 90, priority: 100, difficulty: 1 as const };
    const highRate = { ...base, id: "high-rate", solveRate: 99, priority: -100, difficulty: 5 as const };
    const pieces = [..."IOJS"] as Piece[];
    const result = queryCatalog([lowRate, highRate], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(result.map(({ setup }) => setup.id)).toEqual(["high-rate", "low-rate"]);
  });

  it("퍼클 확률이 같으면 priority가 높은 후보를 먼저 적용한다", () => {
    const base = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const lowPriority = { ...base, id: "low-priority", solveRate: 99, priority: -10, difficulty: 1 as const, saves: 100 };
    const highPriority = { ...base, id: "high-priority", solveRate: 99, priority: 10, difficulty: 5 as const, saves: 0 };
    const pieces = [..."IOJS"] as Piece[];
    const result = queryCatalog([lowPriority, highPriority], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(result.map(({ setup }) => setup.id)).toEqual(["high-priority", "low-priority"]);
  });

  it("퍼클 확률과 priority가 같으면 난이도가 낮은 후보를 먼저 적용한다", () => {
    const base = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const hard = { ...base, id: "hard", solveRate: 99, priority: 0, difficulty: 5 as const, saves: 100 };
    const easy = { ...base, id: "easy", solveRate: 99, priority: 0, difficulty: 1 as const, saves: 0 };
    const pieces = [..."IOJS"] as Piece[];
    const result = queryCatalog([hard, easy], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(result.map(({ setup }) => setup.id)).toEqual(["easy", "hard"]);
  });

  it("퍼클 확률·priority·난이도가 같으면 Saves가 높은 후보를 먼저 적용한다", () => {
    const base = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const lowSaves = { ...base, id: "low-saves", solveRate: 99, priority: 0, saves: 90, difficulty: 3 as const };
    const highSaves = { ...base, id: "high-saves", solveRate: 99, priority: 0, saves: 98, difficulty: 3 as const };
    const pieces = [..."IOJS"] as Piece[];
    const result = queryCatalog([lowSaves, highSaves], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(result.map(({ setup }) => setup.id)).toEqual(["high-saves", "low-saves"]);
  });

  it("모든 추천 지표가 같으면 setup ID 사전순으로 정렬한다", () => {
    const base = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const z = { ...base, id: "z-setup", solveRate: 99, priority: 0, saves: 95, difficulty: 3 as const };
    const a = { ...base, id: "a-setup", solveRate: 99, priority: 0, saves: 95, difficulty: 3 as const };
    const pieces = [..."IOJS"] as Piece[];
    const result = queryCatalog([z, a], {
      cycle: 1,
      board: createBoard(),
      active: pieces[0],
      hold: null,
      next: pieces.slice(1),
    });
    expect(result.map(({ setup }) => setup.id)).toEqual(["a-setup", "z-setup"]);
  });

  it("분리 표시 회차는 QB와 일반 P-count 한도를 서로 소비하지 않는다", () => {
    const baseSetup = sourceSetupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const base: SetupCandidate = {
      setup: baseSetup,
      plan: { steps: [], holds: 0 },
      score: [],
      reasons: [],
    };
    const candidate = (id: string, pieceCount: number): SetupCandidate => ({
      ...base,
      setup: {
        ...base.setup,
        id,
        placements: Array.from({ length: pieceCount }, (_, index) => ({
          ...base.setup.placements[0],
          id: `${id}-${index}`,
        })),
      },
    });
    const ranked = [
      ...Array.from({ length: 10 }, (_, index) => candidate(`four-${index}`, 4)),
      ...Array.from({ length: 6 }, (_, index) => candidate(`three-${index}`, 3)),
    ];

    for (const cycle of [1, 2, 3, 5, 6, 7] as const) {
      const limited = limitSetupCandidatesForCycle(ranked, cycle);
      expect(limited.filter(({ setup }) => setup.placements.length >= 4).map(({ setup }) => setup.id))
        .toEqual(Array.from({ length: 8 }, (_, index) => `four-${index}`));
      expect(limited.filter(({ setup }) => setup.placements.length === 3).map(({ setup }) => setup.id))
        .toEqual(Array.from({ length: 4 }, (_, index) => `three-${index}`));
    }

    const qb = Array.from({ length: 6 }, (_, index) => ({
      ...candidate(`qb-${index}`, 3),
      qbCondition: "QB",
    }));
    const cycle7 = limitSetupCandidatesForCycle([...qb, ...ranked], 7);
    expect(cycle7.filter(({ qbCondition }) => qbCondition !== undefined)).toHaveLength(6);
    expect(cycle7.filter(({ qbCondition, setup }) => qbCondition === undefined && setup.placements.length === 3)).toHaveLength(4);
  });

  it("Legs 단일 catalog의 양성·See7·음성 큐를 같은 엔진으로 판정한다", () => {
    const legs = setupCatalog.find(({ id }) => id === "cycle1-legs-a")!;
    const run = (queue: string) => {
      const pieces = [...queue] as Piece[];
      return queryCatalog([legs], {
        cycle: 1,
        board: createBoard(),
        active: pieces[0],
        hold: null,
        next: pieces.slice(1),
      });
    };
    const positive = run("IOJS")[0];
    expect(positive?.setup.family).toBe("legs");
    expect(positive?.plan.steps.filter(({ action }) => action === "place").map(({ piece }) => piece))
      .toEqual(["I", "O", "J", "S"]);
    expect(run("IOJSLT")).toHaveLength(1);
    expect(run("LIZO")).toHaveLength(0);
  });
});
