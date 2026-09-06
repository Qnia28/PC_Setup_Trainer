import { describe, expect, it } from "vitest";
import { createBoard } from "../../../src/engine/board";
import type { Piece } from "../../../src/engine/types";
import { cycle7TwoPlusTwoRuntimeBundle } from "../../../src/setups/cycle7TwoPlusTwoCatalog";
import { querySetups, type SetupQuery, type SetupCandidate } from "../../../src/setups/query";
import { querySetupsStagedCooperative } from "../../../src/setups/cooperativeQuery";
import type { SelectedRecommendationScope } from "../../../src/setups/recommendationScope";

function selected(row: number): SelectedRecommendationScope {
  const b=cycle7TwoPlusTwoRuntimeBundle();
  expect(b).not.toBeNull();
  const entry=b!.policy.entries.find(e=>e.id===`c7-2plus2-entry-${String(row).padStart(3,"0")}`)!;
  expect(entry).toBeDefined();
  return {mode:"selected-bundles",bundles:[{...b!,bundleId:"two-plus-two",cycle:7,kind:"cycle7-2plus2-qb",
    catalog:b!.catalog.filter(s=>entry.candidateSetupIds.includes(s.id)),policy:{...b!.policy,entries:[entry]}}]};
}
function query(active:Piece, next:string, hold:Piece|null="T"):SetupQuery {
  return {cycle:7,board:createBoard(),hold,active,next:[...next] as Piece[],maxCandidates:100};
}

describe("promoted Cycle 7 2+2 QB recommendation",()=>{
  it.each([["S","ZOILJ",true],["Z","SOILJ",false]] as const)("selects the physical side for %s first",(active,next,mirrored)=>{
    const result=querySetups(query(active,next),selected(258));
    expect(result).toHaveLength(1);
    expect(result[0].setup.id.endsWith("--mirror")).toBe(mirrored);
    expect(result[0].qbCondition).toBe("c7-2plus2-entry-258");
    expect(result[0].recommendationLabel).toBe("TSZ - OI 2+2");
    expect(result[0].setup.displayName).toBe("TSZ - OI 2+2");
    expect(result[0].autoSelect).toBe(false);
    expect(result[0].goodSavePercent).toBe(33.45);
    expect(result[0].setup.solveRate).toBeUndefined();
    expect(result[0].plan.steps.filter(s=>s.action==="place").map(s=>s.piece).sort()).toEqual(["I","O","S","Z"]);
  });
  it("does not recommend that geometry for a mismatched pair, or leak another bundle",()=>{
    expect(querySetups(query("S","ZLIOJ"),selected(258))).toEqual([]);
    expect(querySetups(query("S","ZLJOI"),selected(258))).toEqual([]);
  });
  it("preserves empty-HOLD provenance and uses the shifted next-bag pair",()=>{
    const result=querySetups(query("T","SZOILJ",null),selected(258));
    expect(result).toHaveLength(1);
    expect(result[0].setup.id).toBe("c7-2plus2-qb-row-258--mirror");
  });
  it("Worker/cooperative execution retains the same selected physical outcome and Good Save",async()=>{
    let final:SetupCandidate[]=[];
    const preferredIds:(string|null)[]=[];
    await querySetupsStagedCooperative(query("S","ZOILJ"),{onNode(){}},stage=>{
      preferredIds.push(stage.preferredCandidateId);
      if(stage.complete)final=stage.candidates;
    },selected(258));
    expect(final.map(c=>[c.setup.id,c.goodSavePercent,c.qbCondition])).toEqual([
      ["c7-2plus2-qb-row-258--mirror",33.45,"c7-2plus2-entry-258"],
    ]);
    expect(preferredIds).toEqual([null,null]);
  });
  it("places 2+2 after ordinary 3P and advanced 4P without automatic selection",async()=>{
    let final:SetupCandidate[]=[];
    const preferredIds:(string|null)[]=[];
    await querySetupsStagedCooperative(query("O","LSIJZ"),{onNode(){}},stage=>{
      preferredIds.push(stage.preferredCandidateId);
      if(stage.complete)final=stage.candidates;
    });
    const firstManual=final.findIndex(candidate=>candidate.autoSelect===false);
    expect(firstManual).toBeGreaterThan(0);
    expect(final.slice(firstManual).every(candidate=>candidate.autoSelect===false)).toBe(true);
    const standardIndex=final.findIndex(candidate=>!candidate.qbCondition && candidate.setup.placements.length===3);
    const advancedIndex=final.findIndex(candidate=>candidate.setup.id==="cycle7-4p-006-f000");
    expect(standardIndex).toBeGreaterThanOrEqual(0);
    expect(advancedIndex).toBeGreaterThan(standardIndex);
    expect(advancedIndex).toBeLessThan(firstManual);
    expect(preferredIds.every(id=>id!==null && final.find(candidate=>candidate.setup.id===id)?.autoSelect!==false)).toBe(true);
  });
  it("production includes this family in the QB section with entry-level Good Save ordering",()=>{
    const result=querySetups(query("S","ZOILJ")).filter(c=>c.qbCondition?.startsWith("c7-2plus2-entry-"));
    expect(result.length).toBeGreaterThan(0);
    expect(result.map(c=>c.goodSavePercent)).toEqual([...result.map(c=>c.goodSavePercent)].sort((a,b)=>b!-a!));
    expect(result.every(c=>c.setup.displayName.endsWith("2+2"))).toBe(true);
  });
});
