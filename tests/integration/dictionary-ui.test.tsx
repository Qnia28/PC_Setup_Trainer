import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DictionaryApp } from "../../src/dictionary/DictionaryApp";
import type { DictionaryEntry } from "../../src/dictionary/model";
import type { StagedRecommendationResult } from "../../src/setups/query";
const mocks = vi.hoisted(() => ({ load: vi.fn(), start: vi.fn(), dispose: vi.fn(), classSearch: vi.fn() }));
vi.mock("../../src/dictionary/data", () => ({ loadDictionary: mocks.load }));
vi.mock("../../src/dictionary/classSearch", () => ({ searchDictionaryClass: mocks.classSearch }));
vi.mock("../../src/setups/recommendationWorkerClient", () => ({
  RecommendationRequestCancelled: class extends Error {}, RecommendationWorkerSlot: class { start = mocks.start; dispose = mocks.dispose; },
}));
const entry: DictionaryEntry = { key: "test", title: "Synthetic", source: "Public", dataCycle: 1, kind: "General", conditions: [], branches: [],
  forms: [{ id: "test", cycle: 1, family: "test", displayName: "Synthetic", pieceSignature: ["O"], placements: [], reviewStatus: "reviewed", difficulty: 1 }] };
let tree: ReactTestRenderer;
beforeEach(() => { mocks.load.mockReset().mockResolvedValue([entry]); mocks.start.mockReset(); mocks.dispose.mockReset(); mocks.classSearch.mockReset().mockReturnValue([entry]); });
afterEach(() => { if (tree) act(() => tree.unmount()); });
const text = () => JSON.stringify(tree.toJSON());
describe("dictionary same-page filtering", () => {
  it("shows an empty match instead of all setups; editing restores browse and suppresses late results", async () => {
    let deliver!: (stage: StagedRecommendationResult) => void;
    let finish!: () => void;
    mocks.start.mockImplementation((_query, callback) => { deliver = callback; return { done: new Promise<void>(resolve => { finish = resolve; }) }; });
    await act(async () => { tree = create(<DictionaryApp />); });
    expect(text()).toContain("Synthetic");
    await act(async () => { tree.root.findByProps({ "aria-label": "Queue or class" }).props.onChange({ target: { value: "TOILJSZ" } }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await act(async () => { deliver({ stage: "primary", candidates: [], complete: true, preferredCandidateId: null }); });
    expect(text()).not.toContain("Synthetic"); expect(text()).toContain("No matching setups.");
    await act(async () => { tree.root.findByProps({ "aria-label": "Queue or class" }).props.onChange({ target: { value: "IOLJSTZ" } }); });
    await act(async () => { deliver({ stage: "primary", candidates: [], complete: true, preferredCandidateId: null }); finish(); });
    expect(text()).toContain("Synthetic"); expect(text()).toContain("All"); expect(mocks.dispose).toHaveBeenCalled();
  });
  it("does not expose policy fields, internal scores or editing actions", async () => {
    await act(async () => { tree = create(<DictionaryApp />); });
    const serialized = text();
    expect(serialized).not.toContain("priority"); expect(serialized).not.toContain("ruleId");
    expect(tree.root.findAllByType("button").map(button => button.children.join(" ")).join(" ")).not.toMatch(/Save|Edit|Delete|Promote/);
    expect(serialized).not.toMatch(/[가-힣]|SETUP LIBRARY|dictionary-fineprint|dictionary-detail-footer/);
  });
  it("starts collapsed, then exposes all forms together without a form selector", async () => {
    mocks.load.mockResolvedValue([entry, { ...entry, key: "other", forms: [{ ...entry.forms[0]!, id: "other", solveRate: 81 }] }]);
    await act(async () => { tree = create(<DictionaryApp />); });
    const cards = () => tree.root.findAllByType("button").filter(button => button.props.className?.includes("dictionary-card"));
    expect(cards()).toHaveLength(1);
    expect(tree.root.findAllByProps({ "aria-label": "Setup forms" })).toHaveLength(0);
    await act(async () => { cards()[0]!.props.onClick(); });
    expect(tree.root.findAllByProps({ className: "dictionary-form" })).toHaveLength(2);
    expect(text()).toContain("81%");
    expect(tree.root.findAllByType("select")).toHaveLength(1); // Type only.
    await act(async () => { tree.root.findByProps({ "aria-label": "Close forms" }).props.onClick(); });
    expect(tree.root.findAllByProps({ "aria-label": "Setup forms" })).toHaveLength(0);
  });
  it("shows PC# 3 Good and T rates on cards and their physical forms", async () => {
    mocks.load.mockResolvedValue([{ ...entry, dataCycle: 3, forms: [{ ...entry.forms[0]!, cycle: 3,
      solveRate: 100, nextPcGPercent: 96.25, nextPcTPercent: 91.5 }] }]);
    await act(async () => { tree = create(<DictionaryApp />); });
    await act(async () => { tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[2]!.props.onClick(); });
    const card = tree.root.findAllByType("button").find(button => button.props.className?.includes("dictionary-card"))!;
    const rates = card.findByProps({ className: "dictionary-card-rates" }).findAllByType("span")
      .filter(rate => rate.props.className !== "dictionary-card-rates").map(rate => rate.children.join(""));
    expect(rates).toEqual(["PC 100%", "Good 96.25%", "T 91.5%"]);
    await act(async () => { card.props.onClick(); });
    const details = tree.root.findByProps({ "aria-label": "Setup forms" });
    expect(details.findAllByType("dt").map(metric => metric.children.join(""))).toEqual(expect.arrayContaining(["PC%", "Good", "T"]));
    expect(text()).not.toContain("nextPcGPercent");
  });
  it("orders cards by their displayed PC, Good and T rates", async () => {
    const makeEntry = (key: string, solveRate: number, nextPcGPercent: number, nextPcTPercent: number): DictionaryEntry => ({
      ...entry, key, planId: key, title: key, dataCycle: 3,
      forms: [{ ...entry.forms[0]!, id: key, displayName: key, cycle: 3, solveRate, nextPcGPercent, nextPcTPercent }],
    });
    mocks.load.mockResolvedValue([makeEntry("Low", 80, 100, 100), makeEntry("Low T", 90, 80, 70),
      makeEntry("High T", 90, 80, 90), makeEntry("High PC", 100, 0, 0)]);
    await act(async () => { tree = create(<DictionaryApp />); });
    await act(async () => { tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[2]!.props.onClick(); });
    const cards = tree.root.findAllByType("button").filter(button => button.props.className?.includes("dictionary-card"));
    expect(cards.map(card => card.findByType("strong").children.join(""))).toEqual(["High PC", "High T", "Low T", "Low"]);
  });
  it("switches isolated PC pages and cancels in-flight search results", async () => {
    let deliver!: (stage: StagedRecommendationResult) => void;
    mocks.start.mockImplementation((_query, callback) => { deliver = callback; return { done: Promise.resolve() }; });
    await act(async () => { tree = create(<DictionaryApp />); });
    await act(async () => { tree.root.findByProps({ "aria-label": "Queue or class" }).props.onChange({ target: { value: "TOILJSZ" } }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    const pc8 = tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[7]!;
    await act(async () => { pc8.props.onClick(); });
    await act(async () => { deliver({ stage: "primary", candidates: [], complete: true, preferredCandidateId: null }); });
    expect(mocks.load).toHaveBeenLastCalledWith(8);
    expect(mocks.dispose).toHaveBeenCalled();
    expect(text()).toContain("Synthetic");
    expect(tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[7]!.props["aria-current"]).toBe("page");
  });
  it("routes short classes locally and does not mark OQB observations as checked", async () => {
    mocks.classSearch.mockReturnValue([{ ...entry, kind: "OQB", observation: "NEXT[4]", branches: [] }]);
    await act(async () => { tree = create(<DictionaryApp />); });
    await act(async () => { tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[4]!.props.onClick(); });
    await act(async () => { tree.root.findByProps({ "aria-label": "Queue or class" }).props.onChange({ target: { value: "to" } }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(mocks.classSearch).toHaveBeenCalledWith([entry], expect.objectContaining({ kind: "class", pc: 5, pieces: ["T", "O"] }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(text()).toContain("Class TO · Queue unchecked");
    await act(async () => { tree.root.findAllByType("button").find(button => button.props.className?.includes("dictionary-card"))!.props.onClick(); });
    expect(text()).not.toContain("Pending observation");
    await act(async () => { tree.root.findAllByType("button").find(button => button.children.join("") === "Reset")!.props.onClick(); });
    expect(text()).not.toContain("Queue unchecked");
  });
  it("rejects a wrong class size without starting a worker or class search", async () => {
    await act(async () => { tree = create(<DictionaryApp />); });
    await act(async () => { tree.root.findByProps({ "aria-label": "PC number" }).findAllByType("button")[3]!.props.onClick(); });
    await act(async () => { tree.root.findByProps({ "aria-label": "Queue or class" }).props.onChange({ target: { value: "NO I" } }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(text()).toContain("5 distinct");
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.classSearch).not.toHaveBeenCalled();
  });
});
