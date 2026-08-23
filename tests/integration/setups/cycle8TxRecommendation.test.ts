import { describe, expect, it } from "vitest";
import { createBoard, placeCells } from "../../../src/engine/board";
import { cycle8TxQueueAfterBuildPlan } from "../../../src/setups/cycle8TxCatalog";
import { resolveOqbProgress } from "../../../src/setups/oqbProgress";
import { querySetups } from "../../../src/setups/query";

describe("Cycle 8 T>X recommendation integration", () => {
  it("routes an exact T>S replacement window to Cycle 8 and keeps OQB staged", () => {
    const candidates = querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "T",
      active: "T",
      next: ["J", "Z", "L", "O", "I", "S", "T", "O"],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ setup }) => setup.cycle === 8)).toBe(true);
    expect(candidates.some(({ setup }) => setup.cycle === 1)).toBe(false);
    const oqb = candidates.find(({ policy }) => policy?.ruleId === "cycle8-tx-tjz-l-oqb");
    expect(oqb?.policy?.branchId).toBe("next-bag-s");
    expect(oqb?.qbCondition).toContain("OQB");
    const live = cycle8TxQueueAfterBuildPlan({
      hold: "T",
      active: "T",
      next: ["J", "Z", "L", "O", "I", "S", "T", "O"],
    }, oqb!.plan);
    const placement = oqb!.setup.placements[0];
    const progress = resolveOqbProgress({
      selectedCandidate: oqb!,
      query: {
        cycle: 1,
        board: placeCells(createBoard(), placement.cells, placement.piece),
        hold: live!.hold,
        active: live!.active,
        next: live!.next,
      },
    });
    expect(progress.status).toBe("continuation");
    if (progress.status === "continuation") {
      expect(progress.continuations.map(({ sourceSetupId }) => sourceSetupId))
        .toContain("geometry-cycle-8-tx-item-079-f000");
    }
  });

  it("does not borrow Cycle 1 setups for an unsupported non-T/L/J replacement", () => {
    expect(querySetups({
      cycle: 1,
      board: createBoard(),
      hold: "O",
      active: "O",
      next: ["T", "I", "J", "L", "S", "Z"],
    })).toEqual([]);
  });
});
