import { describe, expect, it } from "vitest";
import type { Piece } from "../engine/types";
import type { SetupQuery } from "./query";
import { cycle7TwoPlusTwoLabel, cycle7TwoPlusTwoBundleValid, cycle7TwoPlusTwoMatches, cycle7TwoPlusTwoRuntimeReady, type Cycle7TwoPlusTwoBundle } from "./cycle7TwoPlusTwoPolicy";

function fixture(prior: Piece[] = ["T", "I", "S"], pair: Piece[] = ["L", "S"]): Cycle7TwoPlusTwoBundle {
  const pieces = [...prior, ...pair];
  pieces.splice(pieces.indexOf("T"), 1);
  return { catalog: [{ id:"a", cycle:7, family:"cycle-7-2plus2-qb", displayName:"test", recommendationGroup:"entry",
    pieceSignature:pieces, placements:pieces.map((piece,i)=>({id:`p${i}`,piece,cells:[]})),
    reviewStatus:"reviewed",runtimeEligible:true,difficulty:3 }],
    policy:{schemaVersion:2,cycle:7,reviewStatus:"reviewed",metrics:[],selectionRules:[],
      runtimePolicy:{catalogKind:"cycle7-2plus2-qb",integrationState:"active",executable:true,setupBuildSegments:[2,2],
        requiredUnplacedPriorPiece:"T",classSelector:"exact-prior-three-multiset",pairSelector:"unordered-next-bag-first-two",ranking:"good-save-desc-then-entry-order"},
      entries:[{id:"entry",candidateSetupIds:["a"],previousBagPieces:prior,nextBagPrefixPieces:pair,goodSavePercent:57.38,order:0}] } };
}
const query = (hold: Piece|null, active:Piece, next:Piece[]):SetupQuery => ({cycle:7,board:[],hold,active,next});

describe("Cycle 7 2+2 exact context",()=>{
  it("formats the visible name without QB permutation notation",()=>{
    expect(cycle7TwoPlusTwoLabel(fixture(["T","I","L"],["L","J"]).policy.entries[0]))
      .toBe("TIL - LJ 2+2");
  });
  it("observes NEXT[1,2], not the previous bag's NEXT[0]",()=>{
    const bundle=fixture();
    for(const pair of [["L","S"],["S","L"]] as Piece[][]){
      const match=cycle7TwoPlusTwoMatches(query("T","I",["S",...pair,"J"]),bundle);
      expect(match?.catalog.map(s=>s.id)).toEqual(["a"]);
      expect(match?.placeableNextCount).toBe(3);
    }
    expect(cycle7TwoPlusTwoMatches(query("T","I",["S","L","J","S"]),bundle)?.catalog).toEqual([]);
  });
  it("moves both prior and new-bag boundaries when HOLD is empty",()=>{
    expect(cycle7TwoPlusTwoMatches(query(null,"T",["I","S","S","L","J"]),fixture())?.placeableNextCount).toBe(4);
    expect(cycle7TwoPlusTwoMatches(query(null,"T",["I","S","L"]),fixture())).toBeNull();
  });
  it("preserves repeated prior and geometry pieces",()=>{
    const b=fixture(["T","I","I"],["O","I"]);
    expect(cycle7TwoPlusTwoMatches(query("I","T",["I","I","O"]),b)?.catalog).toHaveLength(1);
    expect(cycle7TwoPlusTwoMatches(query("I","T",["S","I","O"]),b)?.catalog).toHaveLength(0);
    expect(cycle7TwoPlusTwoBundleValid(b)).toBe(true);
  });
  it("fails closed on unseen/duplicate/T next-bag observations",()=>{
    for(const next of [["S"],["S","L"],["S","L","L"],["S","T","L"]] as Piece[][])
      expect(cycle7TwoPlusTwoMatches(query("T","I",next),fixture())).toBeNull();
  });
  it("rejects a 3+1 composition, dangling refs and overlapping policy bindings",()=>{
    const b=fixture(); b.catalog[0].pieceSignature=["T","I","S","L"];
    expect(cycle7TwoPlusTwoBundleValid(b)).toBe(false);
    const c=fixture(); c.policy.entries[0].candidateSetupIds.push("missing");
    expect(cycle7TwoPlusTwoBundleValid(c)).toBe(false);
    const d=fixture();d.policy.entries.push({...d.policy.entries[0],id:"other"});
    expect(cycle7TwoPlusTwoBundleValid(d)).toBe(false);
  });
  it("requires activation, compiler, exact counts and reviewed physical candidates",()=>{
    const b=fixture(); const gate={runtimeEnabled:true,conditionCompilerReady:true,setupCount:1,logicalSetupCount:1};
    expect(cycle7TwoPlusTwoRuntimeReady(gate,b)).toBe(true);
    expect(cycle7TwoPlusTwoRuntimeReady({...gate,runtimeEnabled:false},b)).toBe(false);
    expect(cycle7TwoPlusTwoRuntimeReady({...gate,setupCount:2},b)).toBe(false);
    b.catalog[0].runtimeEligible=false;
    expect(cycle7TwoPlusTwoRuntimeReady(gate,b)).toBe(false);
  });
});
