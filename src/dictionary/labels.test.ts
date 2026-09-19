import { describe, expect, it } from "vitest";
import { dictionaryLabel } from "./labels";

describe("dictionary source-label presentation", () => {
  it.each([
    ["변형 죠스", "Alt Jaws"],
    ["TO-[TSZ]! (T홀드 4p)", "TO-[TSZ]! (T hold 4p)"],
    ["S가 Z보다 빠를 경우", "S before Z"],
    ["Z가 나올 경우, 먼저 3p", "Z next, 3P first"],
    ["PCO + Heart (TILS)", "PCO + Heart (TILS)"],
  ])("translates %s without changing queue notation", (source, expected) => {
    expect(dictionaryLabel(source)).toBe(expected);
  });
});
