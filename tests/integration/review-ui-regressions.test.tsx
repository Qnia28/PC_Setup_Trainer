import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { encoder, Field } from "tetris-fumen";
import { SolverApp } from "../../src/solverPage/SolverApp";
import { FumenClipboardInput } from "../../src/solverPage/FumenClipboardInput";
import { ReplayApp } from "../../src/replay/ReplayApp";
import { SetupTestApp } from "../../src/setupTest/SetupTestApp";
import { SettingsPanel } from "../../src/input/SettingsPanel";
import { GameSession } from "../../src/engine/game";
import { encodeReplayCode } from "../../src/replay/format";
import { createReplayV3Data } from "../../src/replay/qpcr3";

const mocks = vi.hoisted(() => ({
  solve: vi.fn(), controllers: [] as { destroy: ReturnType<typeof vi.fn> }[],
  start: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../../src/solver/workerClient", () => ({
  viteWorkerFactory: vi.fn(),
  SolverWorkerClient: class { request = mocks.solve; dispose() {} },
}));
vi.mock("../../src/solverPage/FumenClipboardInput", () => ({ FumenClipboardInput: () => null }));
vi.mock("../../src/input/controller", () => ({ InputController: class {
  destroy = vi.fn(); constructor() { mocks.controllers.push(this); }
} }));
vi.mock("../../src/replay/recommendationPool", () => ({ ReplayRecommendationPool: class {
  warm() {} dispose() {} cancelAll() {} request() { return () => {}; }
} }));
vi.mock("../../src/setups/recommendationWorkerClient", () => ({
  RecommendationRequestCancelled: class extends Error {},
  RecommendationWorkerSlot: class { start = mocks.start; dispose() {} },
}));
vi.mock("../../src/setupTest/catalogSources", () => ({
  promotedSetupTestCatalogs: [{ id: "synthetic", label: "Synthetic", cycle: 4, group: "promoted", variant: "general", setupPath: "synthetic.json" }],
  fetchDraftSetupTestCatalogs: async () => [],
  loadSetupTestCatalog: async () => ({ catalog: [], policy: null }),
  setupTestRecommendationBundle: () => ({ kind: "generic", catalog: [] }),
}));

let tree: ReactTestRenderer;
beforeEach(() => {
  mocks.controllers.length = 0;
  mocks.solve.mockReset().mockImplementation(async (kind) => kind === "warmup" ? { ready: true } : { fumen: null });
  mocks.start.mockReset(); mocks.cancel.mockReset();
  vi.stubGlobal("window", { location: { href: "http://localhost/replay.html", pathname: "/replay.html" },
    addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals(); });
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAllByType("button").find(node => node.children.join("") === label)!;

describe("review UI regressions (mounted React, no browser)", () => {
  it.each(["queue", "mode", "field"])("invalidates results after the same Fumen is recalculated then %s changes", async (change) => {
    await act(async () => { tree = create(<SolverApp />); });
    const fumen = encoder.encode([{ field: Field.create() }]);
    await act(async () => {
      tree.root.findByType(FumenClipboardInput).props.onText(fumen);
      tree.root.findByProps({ placeholder: "TILJOSZ…" }).props.onChange({ target: { value: "TILJOSZTILJ" } });
    });
    await act(async () => { button("Calculate").props.onClick(); });
    expect(text()).toContain("No solve");
    await act(async () => { button("Calculate").props.onClick(); });
    expect(text()).toContain("No solve");
    await act(async () => {
      if (change === "queue") tree.root.findByProps({ placeholder: "TILJOSZ…" }).props.onChange({ target: { value: "ILJOSZTILJ" } });
      else if (change === "mode") tree.root.findAllByProps({ name: "solution-mode" })[0]!.props.onChange();
      else button("Clear").props.onClick();
    });
    expect(text()).toContain("Solutions will appear here.");
    expect(text()).not.toContain("No solve");
  });

  it("aborts and ignores a pending same-Fumen recalculation after an input edit", async () => {
    await act(async () => { tree = create(<SolverApp />); });
    await act(async () => {
      tree.root.findByType(FumenClipboardInput).props.onText(encoder.encode([{ field: Field.create() }]));
      tree.root.findByProps({ placeholder: "TILJOSZ…" }).props.onChange({ target: { value: "TILJOSZTILJ" } });
    });
    await act(async () => { button("Calculate").props.onClick(); });
    let resolve!: (data: { fumen: null }) => void;
    mocks.solve.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { button("Calculate").props.onClick(); });
    const signal = mocks.solve.mock.lastCall![2].signal as AbortSignal;
    await act(async () => { tree.root.findByProps({ placeholder: "TILJOSZ…" }).props.onChange({ target: { value: "ILJOSZTILJ" } }); });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ fumen: null }); });
    expect(text()).toContain("Solutions will appear here.");
  });

  it("destroys Snapshot input while Controls is open and recreates it on close", async () => {
    const game = new GameSession("modal");
    const code = encodeReplayCode(createReplayV3Data(game.placementHistory.initialState(), game.placementHistory.eventLog()));
    await act(async () => { tree = create(<ReplayApp />); });
    await act(async () => { tree.root.findByType("textarea").props.onChange({ target: { value: code } }); });
    await act(async () => { button("Load Replay").props.onClick(); });
    await act(async () => { button("Snapshot").props.onClick(); });
    const controller = mocks.controllers.at(-1)!;
    expect(controller).toBeDefined();
    await act(async () => { button("Controls").props.onClick(); });
    expect(controller.destroy).toHaveBeenCalledOnce();
    const count = mocks.controllers.length;
    await act(async () => { tree.root.findByType(SettingsPanel).props.onClose(); });
    expect(mocks.controllers.length).toBe(count + 1);
  });

  it.each(["queue", "hold"])("discards selected and late recommendations after %s edits, then starts free practice", async (change) => {
    let deliver!: (stage: unknown) => void;
    let finish!: () => void;
    mocks.start.mockImplementation((_input, callback) => {
      deliver = callback;
      return { cancel: mocks.cancel, done: new Promise<void>(resolve => { finish = resolve; }) };
    });
    await act(async () => { tree = create(<SetupTestApp />); });
    await act(async () => { void tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    const stage = { complete: false, candidates: [{ setup: { id: "old", displayName: "Old candidate", cycle: 4,
      family: "test", pieceSignature: [], placements: [], difficulty: 1, reviewStatus: "reviewed" }, score: 0 }] };
    await act(async () => { deliver(stage); });
    expect(text()).toContain("Old candidate");
    await act(async () => {
      if (change === "hold") tree.root.findByProps({ className: "setup-test-hold" }).findByType("input").props.onChange({ target: { checked: false } });
      else {
        const input = tree.root.findByProps({ className: "setup-test-bags" }).findAllByType("input")[0]!;
        input.props.onChange({ target: { value: input.props.value.split("").reverse().join("") } });
      }
    });
    expect(mocks.cancel).toHaveBeenCalled();
    await act(async () => { deliver({ ...stage, complete: true }); });
    expect(text()).not.toContain("Old candidate");
    await act(async () => { finish(); });
    expect(text()).toContain("Recommendations not run");
    await act(async () => { button("Play 0P").props.onClick(); });
    expect(text()).toContain("Playable 0P practice");
    expect(text()).not.toContain("Old candidate");
  });
});
