import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import type { Piece } from "../../../src/engine/types";
import { setupCatalog, setupPolicyForCycle, sourceSetupCatalog } from "../../../src/setups/catalog";
import { cycle7QueueContext, fitsCycle7BuildPool } from "../../../src/setups/cycle7Context";
import { cycle7Advanced4pMatches, cycle7Advanced4pRuntimeBundle, cycle7Advanced4pRuntimeReady } from "../../../src/setups/cycle7Advanced4pCatalog";
import { mirrorPiece } from "../../../src/setups/mirror";
import { querySetups } from "../../../src/setups/query";
import { findBuildPlan } from "../../../src/setups/reachability";
import { cycle7QbCatalogForClass, cycle7QbClass, cycle7QbConditionRank, cycle7QbDisplayName, cycle7QbPolicyEntryForSetup, cycle7QbRecommendationRank, cycle7QbRuntimeBundle, cycle7QbRuntimeReady, cycle7QbSourceOrder } from "../../../src/setups/cycle7QbCatalog";
import { validateSetup } from "../../../src/setups/schema";

describe("7회차 3+7 큐 경계", () => {
  it("고급 4P runtime은 manifest 활성화와 완전한 setup/metric/entry coverage를 요구한다", () => {
    const setups = [
      { id: "setup-a", reviewStatus: "reviewed", runtimeEligible: true },
      { id: "setup-b", reviewStatus: "reviewed", runtimeEligible: true },
    ];
    const completePolicy = {
      reviewStatus: "reviewed",
      metrics: [{ setupId: "setup-a" }, { setupId: "setup-b" }],
      runtimePolicy: {
        catalogKind: "advanced-4p",
        integrationState: "active",
        entries: [{ setupId: "setup-a" }, { setupId: "setup-b" }],
        goodCycle8: { entryRates: [{ setupId: "setup-a" }, { setupId: "setup-b" }] },
      },
    };
    expect(cycle7Advanced4pRuntimeReady(
      { runtimeEnabled: true, setupCount: 2 },
      setups,
      completePolicy,
    )).toBe(true);
    expect(cycle7Advanced4pRuntimeReady(
      { runtimeEnabled: false, setupCount: 2 },
      setups,
      completePolicy,
    )).toBe(false);
    expect(cycle7Advanced4pRuntimeReady(
      { runtimeEnabled: true, setupCount: 2 },
      setups,
      {
        ...completePolicy,
        runtimePolicy: {
          ...completePolicy.runtimePolicy,
          entries: [{ setupId: "setup-a" }, { setupId: "setup-a" }],
        },
      },
    )).toBe(false);
    expect(cycle7Advanced4pRuntimeBundle()).not.toBeNull();
  });

  it("일반 고급 4P는 이전 가방 3개와 다음 가방 첫 미노를 정확히 바인딩한다", () => {
    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "T",
      active: "O",
      next: ["L", "S", "I", "J", "Z"],
      holdAvailable: true,
    });
    const advanced = candidates.filter(({ setup, qbCondition }) =>
      qbCondition === undefined && setup.placements.length === 4);
    expect(advanced[0]?.setup.id).toBe("cycle7-4p-006-f000");
    expect(advanced[0]?.goodCycle8EntryRate).toBe(63.77);
    expect(advanced[0]?.setup.solveRate).toBe(100);
    expect(advanced.some(({ setup }) => setup.id === "cycle7-4p-007-f000")).toBe(false);
    const normalIndex = candidates.findIndex(({ setup, qbCondition }) =>
      qbCondition === undefined && setup.placements.length <= 3);
    const advanced4pIndex = candidates.findIndex(({ setup, qbCondition }) =>
      qbCondition === undefined && setup.placements.length === 4);
    expect(normalIndex).toBeGreaterThanOrEqual(0);
    expect(advanced4pIndex).toBeGreaterThan(normalIndex);

    const wrongFourth = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "T",
      active: "O",
      next: ["L", "I", "J", "S", "Z"],
      holdAvailable: true,
    });
    expect(wrongFourth.some(({ setup }) => setup.id === "cycle7-4p-006-f000")).toBe(false);

    const emptyHold = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: null,
      active: "T",
      next: ["O", "L", "S", "I", "J"],
      holdAvailable: true,
    });
    expect(emptyHold.some(({ setup }) => setup.id === "cycle7-4p-006-f000")).toBe(true);
  });

  it("TLS-LJ에서는 첫 L을 직접 쓰는 TLS-L과 L을 HOLD하는 TLS-J를 모두 추천한다", () => {
    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "T",
      active: "L",
      next: ["S", "L", "J", "O", "I"],
      holdAvailable: true,
    });
    const tlsL = candidates.find(({ setup }) => setup.id === "cycle7-4p-026-f000");
    const tlsJ = candidates.find(({ setup }) => setup.id === "cycle7-4p-027-f000");
    expect(tlsL).toBeDefined();
    expect(tlsJ).toBeDefined();
    expect(tlsJ?.plan.steps).toContainEqual(expect.objectContaining({ action: "hold", piece: "L" }));
    expect(tlsJ?.reasons).toContain("HOLD the first L from the next bag and place NEXT[1].");
  });

  it("OIL-TJ는 T를 먼저 HOLD하고 J를 네 번째로 놓을 수 있을 때만 추천한다", () => {
    const queryOil = (prefix: Piece[]) => querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "O",
      active: "I",
      next: ["L", ...prefix, "S", "Z"],
      holdAvailable: true,
    });
    const valid = queryOil(["T", "J"]);
    const oilTj = valid.find(({ setup }) => setup.id === "cycle7-4p-092-f000");
    expect(oilTj).toBeDefined();
    expect(oilTj?.plan.steps).toContainEqual(expect.objectContaining({ action: "hold", piece: "T" }));
    expect(oilTj?.goodCycle8EntryRate).toBe(24.64);
    expect(queryOil(["J", "T"]).some(({ setup }) => setup.id === "cycle7-4p-092-f000")).toBe(false);
  });

  it("OIS-I의 OQB 선행·T/Z 관찰 분기를 초기 4P 하나로 평탄화하지 않는다", () => {
    const bundle = cycle7Advanced4pRuntimeBundle();
    expect(bundle).not.toBeNull();
    const matches = bundle ? cycle7Advanced4pMatches(
      ["O", "I", "S"],
      ["S", "I", "T", "Z", "L"],
      1,
      bundle,
    ) : [];
    expect(matches.some(({ setup }) => setup.family === "cycle7-4p-ois-i")).toBe(false);

    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "O",
      active: "I",
      next: ["S", "I", "T", "Z", "L"],
      holdAvailable: true,
    });
    expect(candidates.some(({ setup }) => setup.family === "cycle7-4p-ois-i")).toBe(false);
  });

  it("QB runtime은 manifest 활성화와 setup/policy reviewed 상태를 모두 요구한다", () => {
    const reviewedSetups = [
      { id: "setup-a", reviewStatus: "reviewed" },
      { id: "setup-b", reviewStatus: "reviewed" },
    ];
    const reviewedPolicy = {
      reviewStatus: "reviewed",
      entries: [{ setupId: "setup-a" }, { setupId: "setup-b" }],
    };
    expect(cycle7QbRuntimeReady({ runtimeEnabled: true }, reviewedSetups, reviewedPolicy)).toBe(true);
    expect(cycle7QbRuntimeReady({ runtimeEnabled: false }, reviewedSetups, reviewedPolicy)).toBe(false);
    expect(cycle7QbRuntimeReady(
      { runtimeEnabled: true },
      [{ id: "setup-a", reviewStatus: "draft" }],
      { reviewStatus: "reviewed", entries: [{ setupId: "setup-a" }] },
    )).toBe(false);
    expect(cycle7QbRuntimeReady(
      { runtimeEnabled: true },
      reviewedSetups,
      { ...reviewedPolicy, reviewStatus: "draft" },
    )).toBe(false);
    expect(cycle7QbRuntimeReady(
      { runtimeEnabled: true },
      reviewedSetups,
      { ...reviewedPolicy, entries: [{ setupId: "setup-a" }] },
    )).toBe(false);
    expect(cycle7QbRuntimeReady(
      { runtimeEnabled: true },
      reviewedSetups,
      { ...reviewedPolicy, entries: [{ setupId: "setup-a" }, { setupId: "setup-a" }] },
    )).toBe(false);
    expect(cycle7QbRuntimeBundle()).not.toBeNull();
  });

  it("일반 QB의 LSZ/JSZ·ISZ·OSZ만 분류하고 13개 원본 geometry를 검증한다", () => {
    expect(cycle7QbClass(["L", "S", "Z"])).toBe("LSZ");
    expect(cycle7QbClass(["J", "Z", "S"])).toBe("JSZ");
    expect(cycle7QbClass(["O", "S", "Z"])).toBe("OSZ");
    expect(cycle7QbClass(["O", "O", "I"])).toBeNull();
    const sourceForms = [
      ...cycle7QbCatalogForClass("LSZ"),
      ...cycle7QbCatalogForClass("ISZ"),
      ...cycle7QbCatalogForClass("OSZ"),
    ].filter(({ derivedVariant }) => derivedVariant === undefined);
    expect(sourceForms).toHaveLength(13);
    expect(sourceForms.every(({ placements }) => placements.length === 3)).toBe(true);
    expect(sourceForms.every((setup) => validateSetup(setup).length === 0)).toBe(true);
    expect(sourceForms.every(({ displayName, formLabel }) => !/[가-힣]/.test(`${displayName}${formLabel ?? ""}`))).toBe(true);
  });

  it("LSZ + TOIJ 조건 초안에서는 OJ보다 먼저 완성되는 TI를 선택한다", () => {
    const ranked = cycle7QbCatalogForClass("LSZ")
      .filter(({ id }) => !id.includes("--box-"))
      .map((setup) => ({
        setup,
        rank: cycle7QbConditionRank(cycle7QbPolicyEntryForSetup(setup)!, ["T", "O", "I", "J"], setup),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((left, right) => left.rank - right.rank);
    expect(ranked[0].setup.id).toContain("lsz-ti-early");
  });

  it("XSZ QB 정책은 모든 7P4 순열에서 적어도 한 조건을 선택한다", () => {
    const permutations = (prefix: Piece[], remaining: Piece[]): Piece[][] => prefix.length === 4
      ? [prefix]
      : remaining.flatMap((piece, index) => permutations(
        [...prefix, piece],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      ));
    const prefixes = permutations([], ["I", "J", "L", "O", "S", "T", "Z"]);
    for (const classId of ["LSZ", "JSZ", "ISZ", "OSZ"] as const) {
      const variants = cycle7QbCatalogForClass(classId).filter(({ id }) => !id.includes("--box-"));
      for (const prefix of prefixes) {
        const ranks = variants.map((setup) => {
          const entry = cycle7QbPolicyEntryForSetup(setup)!;
          return cycle7QbRecommendationRank(classId, entry, prefix, setup);
        });
        expect(Math.min(...ranks), `${classId} / ${prefix.join("")}`).toBeLessThan(Number.POSITIVE_INFINITY);
      }
    }
  });

  it("LSZ TS Early는 L과 Z가 모두 S보다 앞선 정확히 8개 prefix에서만 Form B를 top-1으로 선택한다", () => {
    const permutations = (prefix: Piece[], remaining: Piece[]): Piece[][] => prefix.length === 4
      ? [prefix]
      : remaining.flatMap((piece, index) => permutations(
        [...prefix, piece],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      ));
    const formBPrefixes: string[] = [];
    const variants = cycle7QbCatalogForClass("LSZ").filter(({ id }) => !id.includes("--box-"));
    for (const prefix of permutations([], ["I", "J", "L", "O", "S", "T", "Z"])) {
      const ranked = variants.map((setup) => ({
        setup,
        rank: cycle7QbRecommendationRank(
          "LSZ",
          cycle7QbPolicyEntryForSetup(setup)!,
          prefix,
          setup,
        ),
      })).filter(({ rank }) => Number.isFinite(rank));
      const bestRank = Math.min(...ranked.map(({ rank }) => rank));
      const top = ranked.filter(({ rank }) => rank === bestRank)
        .sort((left, right) => cycle7QbSourceOrder(left.setup) - cycle7QbSourceOrder(right.setup))[0];
      if (top?.setup.id === "cycle7-qb-lsz-ts-early-b") formBPrefixes.push(prefix.join(""));
    }
    expect(formBPrefixes.sort()).toEqual([
      "LTZS", "LZST", "LZTS", "TLZS", "TZLS", "ZLST", "ZLTS", "ZTLS",
    ]);
  });

  it("승격된 LSZ TS Form B 분기는 대표 초기 순서에서 3P만 추천하고 해법 미디어를 노출하지 않는다", () => {
    for (const [order, prefix] of [["LSZ", "LTZS"], ["ZSL", "ZTLS"]]) {
      const candidates = querySetups({
        cycle: 7,
        board: createBoard(),
        hold: order[0] as Piece,
        active: order[1] as Piece,
        next: [order[2], ...prefix] as Piece[],
        holdAvailable: true,
      });
      const top = candidates[0];
      expect(top?.setup.id, `${order}/${prefix}`).toBe("cycle7-qb-lsz-ts-early-b");
      expect(top?.setup.placements, `${order}/${prefix}`).toHaveLength(3);
      expect((top as typeof top & { solutionMedia?: unknown })?.solutionMedia, `${order}/${prefix}`).toBeUndefined();
    }
    const formA = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "L",
      active: "S",
      next: ["Z", "S", "T", "L", "O"],
      holdAvailable: true,
    })[0];
    expect(formA?.setup.id).toBe("cycle7-qb-lsz-ts-early-a");
    expect(formA?.setup.placements).toHaveLength(3);
  });

  it("JSZ는 LSZ의 source prefix와 form 규칙을 정확히 좌우대칭해 평가한다", () => {
    const sourcePrefixes = ["LTZS", "LZST", "LZTS", "TLZS", "TZLS", "ZLST", "ZLTS", "ZTLS"];
    const variants = cycle7QbCatalogForClass("JSZ").filter(({ id }) => !id.includes("--box-"));
    for (const sourcePrefix of sourcePrefixes) {
      const runtimePrefix = [...sourcePrefix].map((piece) => mirrorPiece(piece as Piece));
      const ranked = variants.map((setup) => ({
        setup,
        rank: cycle7QbRecommendationRank(
          "JSZ",
          cycle7QbPolicyEntryForSetup(setup)!,
          runtimePrefix,
          setup,
        ),
      })).filter(({ rank }) => Number.isFinite(rank));
      const bestRank = Math.min(...ranked.map(({ rank }) => rank));
      const top = ranked.filter(({ rank }) => rank === bestRank)
        .sort((left, right) => cycle7QbSourceOrder(left.setup) - cycle7QbSourceOrder(right.setup))[0];
      expect(top?.setup.id, `${sourcePrefix}/${runtimePrefix.join("")}`)
        .toBe("cycle7-qb-lsz-ts-early-b--mirror");
    }
  });

  it("ISZ QB 이름은 조건 문장 대신 실제 원본·미러 방향을 반영한 짧은 이름을 사용한다", () => {
    const queryIsz = (prefix: string) => querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "I",
      active: "S",
      next: ["Z", ...prefix] as Piece[],
      holdAvailable: true,
    })[0]?.setup.displayName;
    expect(queryIsz("LIOT")).toBe("ISZ L QB");
    expect(queryIsz("JIOT")).toBe("ISZ J QB");
    expect(queryIsz("OIJL")).toBe("ISZ O QB");
    expect(queryIsz("TSZL")).toBe("ISZ TSZ QB");
  });

  it("QB policy의 프런트 노출 문구는 영어다", () => {
    const bundle = cycle7QbRuntimeBundle();
    expect(bundle).not.toBeNull();
    expect(bundle!.policy.entries.every(({ conditionLabel, runtimeDescription }) =>
      !/[가-힣]/u.test(`${conditionLabel} ${runtimeDescription ?? ""}`))).toBe(true);
  });

  it("모든 XSZ QB에 클래스와 실제 방향을 반영한 통일 이름을 적용한다", () => {
    const expected = new Map<string, string>([
      ["LSZ/cycle7-qb-lsz-oz-or-iz-early", "LSZ Z QB"],
      ["LSZ/cycle7-qb-lsz-oj-early", "LSZ OJ QB"],
      ["LSZ/cycle7-qb-lsz-ti-early", "LSZ TI QB"],
      ["LSZ/cycle7-qb-lsz-ts-early-a", "LSZ TS QB (Form A)"],
      ["LSZ/cycle7-qb-lsz-ts-early-b", "LSZ TS QB (Form B)"],
      ["LSZ/cycle7-qb-lsz-l-early-o-visible", "LSZ L QB"],
      ["LSZ/cycle7-qb-lsz-l-early-o-not-visible", "LSZ L QB"],
      ["JSZ/cycle7-qb-lsz-oz-or-iz-early--mirror", "JSZ S QB"],
      ["JSZ/cycle7-qb-lsz-oj-early--mirror", "JSZ OL QB"],
      ["JSZ/cycle7-qb-lsz-ti-early--mirror", "JSZ TI QB"],
      ["JSZ/cycle7-qb-lsz-ts-early-a--mirror", "JSZ TZ QB (Form A)"],
      ["JSZ/cycle7-qb-lsz-ts-early-b--mirror", "JSZ TZ QB (Form B)"],
      ["JSZ/cycle7-qb-lsz-l-early-o-visible--mirror", "JSZ J QB"],
      ["JSZ/cycle7-qb-lsz-l-early-o-not-visible--mirror", "JSZ J QB"],
      ["ISZ/cycle7-qb-isz-l-before-j", "ISZ L QB"],
      ["ISZ/cycle7-qb-isz-l-before-j--mirror", "ISZ J QB"],
      ["ISZ/cycle7-qb-isz-o-before-sz", "ISZ O QB"],
      ["ISZ/cycle7-qb-isz-tsz-early", "ISZ TSZ QB"],
      ["OSZ/cycle7-qb-osz-i-early", "OSZ I QB"],
      ["OSZ/cycle7-qb-osz-jls-or-jlz-early", "OSZ JLS/JLZ QB"],
      ["OSZ/cycle7-qb-osz-all-other", "OSZ Other QB"],
      ["OSZ/cycle7-qb-osz-all-other--mirror", "OSZ Other QB"],
    ]);
    for (const classId of ["LSZ", "JSZ", "ISZ", "OSZ"] as const) {
      const variants = cycle7QbCatalogForClass(classId).filter(({ id }) => !id.includes("--box-"));
      for (const setup of variants) {
        const entry = cycle7QbPolicyEntryForSetup(setup)!;
        expect(cycle7QbDisplayName(classId, entry, setup), `${classId}/${setup.id}`)
          .toBe(expected.get(`${classId}/${setup.id}`));
      }
    }
    expect(expected.size).toBe(22);
  });

  it("ISZ의 O-fourth 예외 18개는 sfinder 검증된 O QB fallback으로 선택한다", () => {
    const exceptions = [
      "ISTO", "ISZO", "ITSO", "ITZO", "IZSO", "IZTO",
      "SITO", "SIZO", "STIO", "SZIO",
      "TISO", "TIZO", "TSIO", "TZIO",
      "ZISO", "ZITO", "ZSIO", "ZTIO",
    ] as const;
    const variants = cycle7QbCatalogForClass("ISZ").filter(({ id }) => !id.includes("--box-"));
    for (const rawPrefix of exceptions) {
      const prefix = [...rawPrefix] as Piece[];
      const ranked = variants
        .map((setup) => ({
          setup,
          rank: cycle7QbConditionRank(cycle7QbPolicyEntryForSetup(setup)!, prefix, setup),
        }))
        .filter(({ rank }) => Number.isFinite(rank))
        .sort((left, right) => left.rank - right.rank);
      const selected = ranked[0];
      expect(selected?.setup.id, rawPrefix).toBe("cycle7-qb-isz-o-before-sz");
      expect(selected?.rank, rawPrefix).toBe(3);
      if (!selected) throw new Error(`No ISZ QB selected for ${rawPrefix}`);
      expect(cycle7QbPolicyEntryForSetup(selected.setup)?.conditionLabel)
        .toBe("O Visible (4th Included)");
    }
  });

  it("OSZ는 See I 다음에 T 유무와 관계없이 See JLS/JLZ를 우선한다", () => {
    const affectedPrefixes = ["JLST", "JSLT", "LJZT", "LZJT", "SJLT", "ZLJT"] as const;
    const variants = cycle7QbCatalogForClass("OSZ").filter(({ id }) => !id.includes("--box-"));
    for (const rawPrefix of affectedPrefixes) {
      const prefix = [...rawPrefix] as Piece[];
      const ranked = variants
        .map((setup) => ({
          setup,
          rank: cycle7QbConditionRank(cycle7QbPolicyEntryForSetup(setup)!, prefix, setup),
        }))
        .filter(({ rank }) => Number.isFinite(rank))
        .sort((left, right) => left.rank - right.rank);
      expect(ranked.map(({ setup }) => setup.id), rawPrefix)
        .toEqual(["cycle7-qb-osz-jls-or-jlz-early"]);
    }
  });

  it("3P top-1 solve 100% 전수검증을 통과한 7회차 QB와 일반 셋업을 함께 노출한다", () => {
    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "S",
      active: "L",
      next: ["Z", "T", "O", "I", "J"],
      holdAvailable: true,
    });
    const qbIndex = candidates.findIndex(({ qbCondition }) => qbCondition !== undefined);
    const normalIndex = candidates.findIndex(({ qbCondition }) => qbCondition === undefined);
    expect(qbIndex).toBeGreaterThanOrEqual(0);
    expect(normalIndex).toBeGreaterThan(qbIndex);
  });

  it("가장 빠른 QB가 BFS에 실패하면 두 번째로 빠른 조건의 QB로 fallback한다", () => {
    const query = {
      cycle: 7 as const,
      hold: "L" as const,
      active: "S" as const,
      next: ["Z", "I", "J", "L", "O"] as Piece[],
      holdAvailable: true,
    };
    const clear = querySetups({ ...query, board: createBoard() })
      .filter(({ qbCondition }) => qbCondition !== undefined);
    expect(clear[0]?.setup.id).toBe("cycle7-qb-lsz-l-early-o-visible");
    expect(clear[0]?.score[1]).toBe(2);

    const blocked = createBoard();
    blocked[0][9] = "I";
    const fallback = querySetups({ ...query, board: blocked })
      .filter(({ qbCondition }) => qbCondition !== undefined);
    expect(fallback[0]?.setup.id).toBe("cycle7-qb-lsz-oj-early");
    expect(fallback[0]?.score[1]).toBe(3);
  });

  it("7회차 QB 조건을 평가할 수 없으면 일반 후보로 fallback한다", () => {
    const candidates = querySetups({
      cycle: 7,
      board: createBoard(),
      hold: "I",
      active: "O",
      next: ["S", "Z"],
      holdAvailable: true,
    });
    expect(candidates.some(({ qbCondition }) => qbCondition !== undefined)).toBe(false);
    expect(candidates.some(({ qbCondition }) => qbCondition === undefined)).toBe(true);
  });
  it("HOLD + ACTIVE + NEXT 1을 구축 풀로 분리한다", () => {
    const context = cycle7QueueContext({
      cycle: 7,
      board: createBoard(),
      hold: "I",
      active: "O",
      next: ["S", "Z", "L", "T", "J"],
    });
    expect(context).toEqual({
      buildPieces: ["I", "O", "S"],
      searchNext: ["S", "Z", "L", "T", "J"],
      placeableNextCount: 1,
    });
  });

  it("HOLD가 비면 ACTIVE + NEXT 2를 구축 풀로 사용한다", () => {
    const context = cycle7QueueContext({
      cycle: 7,
      board: createBoard(),
      hold: null,
      active: "I",
      next: ["O", "S", "Z", "L"],
    });
    expect(context).toEqual({
      buildPieces: ["I", "O", "S"],
      searchNext: ["O", "S", "Z", "L"],
      placeableNextCount: 2,
    });
  });

  it("3P는 정확한 세 미노, OIS/OIZ 2P는 I 세이브 풀에서만 통과한다", () => {
    const threePiece = sourceSetupCatalog.find(({ id }) => id === "pcinfokorea-c7-002-iot")!;
    const ois = sourceSetupCatalog.find(({ id }) => id === "pcinfokorea-c7-024-os")!;
    const oiz = sourceSetupCatalog.find(({ id }) => id === "pcinfokorea-c7-024-oz")!;
    const policy = setupPolicyForCycle(7);
    const pool = (pieces: string) => [...pieces] as Piece[];

    expect(fitsCycle7BuildPool(threePiece, pool("IOT"), policy)).toBe(true);
    expect(fitsCycle7BuildPool(threePiece, pool("JOT"), policy)).toBe(false);
    expect(fitsCycle7BuildPool(ois, pool("IOS"), policy)).toBe(true);
    expect(fitsCycle7BuildPool(ois, pool("LOS"), policy)).toBe(false);
    expect(fitsCycle7BuildPool(oiz, pool("IOZ"), policy)).toBe(true);
    expect(fitsCycle7BuildPool(oiz, pool("JOZ"), policy)).toBe(false);
  });

  it("미러 확장 후에도 2P 세이브 제약을 유지한다", () => {
    const mirrored = setupCatalog.find(({ mirrorOf }) => mirrorOf === "pcinfokorea-c7-024-os");
    if (!mirrored) return;
    expect(fitsCycle7BuildPool(mirrored, ["I", "O", "Z"], setupPolicyForCycle(7))).toBe(true);
    expect(fitsCycle7BuildPool(mirrored, ["J", "O", "Z"], setupPolicyForCycle(7))).toBe(false);
  });

  it("다음 가방 버퍼 미노는 setup geometry에 놓을 수 없다", () => {
    const setup = sourceSetupCatalog.find(({ id }) => id === "pcinfokorea-c7-004-ost")!;
    const plan = findBuildPlan(
      setup,
      createBoard(),
      "O",
      "S",
      ["I", "T"],
      true,
      1,
    );
    expect(plan).toBeNull();
  });

});
