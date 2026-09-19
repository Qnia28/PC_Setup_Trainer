// Bounded before/after benchmark. No network listener, files, or database writes.
// Run: node scripts/benchmarks/recommendation.mjs
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = fileURLToPath(new URL("../../tests/integration/setups/fixtures/reachabilityBaseline.ts", import.meta.url));
const cases = [
  [1, null, "I", "ZSOLJ"], [2, "I", "L", "OTSZJ"],
  [3, "T", "L", "TIJSZ"], [4, "J", "O", "STZIL"],
  [5, "T", "O", "ILJSZ"], [6, "T", "O", "LJSZI"],
  [7, "T", "O", "LSIJZ"], [1, "T", "T", "JZLOISTO", "8 T>S"],
  [1, "I", "I", "TOJSZ", "8 I>L"], [1, "O", "O", "TLIJZ", "8 O>S"],
];

async function load(baseline) {
  const server = await createServer({
    root, configFile: false, logLevel: "error", server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    plugins: baseline ? [{
      name: "frozen-reachability-benchmark", enforce: "pre",
      resolveId(source, importer) {
        if (source === "./reachability" && importer?.replaceAll("\\", "/").includes("/src/setups/")) return baselinePath;
      },
    }] : [],
  });
  const { querySetups } = await server.ssrLoadModule("/src/setups/query.ts");
  const { createBoard } = await server.ssrLoadModule("/src/engine/board.ts");
  return { server, querySetups, createBoard };
}

const before = await load(true);
const after = await load(false);
try {
  console.log("Query CPU only; excludes module/Worker loading. Fresh query caches each invocation.");
  const rows = [];
  for (const height of [10, 24]) for (const [cycle, hold, active, next, label = cycle] of cases) {
    const invoke = (engine) => engine.querySetups({ cycle, board: engine.createBoard(height), hold, active, next: [...next], holdAvailable: true });
    const timed = (engine) => {
      const start = performance.now();
      const result = invoke(engine);
      return { ms: performance.now() - start, result };
    };
    const coldBefore = timed(before);
    const coldAfter = timed(after);
    if (JSON.stringify(coldBefore.result) !== JSON.stringify(coldAfter.result)) throw new Error(`PC#${label}/${height}: candidate/plan mismatch`);
    const samplesBefore = [], samplesAfter = [];
    for (let round = 0; round < 5; round++) {
      // Alternate execution order to reduce warmup/order bias.
      const first = timed(round % 2 ? after : before);
      const second = timed(round % 2 ? before : after);
      samplesBefore.push((round % 2 ? second : first).ms);
      samplesAfter.push((round % 2 ? first : second).ms);
    }
    const median = (values) => values.sort((a, b) => a - b)[2];
    const oldMs = median(samplesBefore), newMs = median(samplesAfter);
    rows.push({ height, pc: label, candidates: coldAfter.result.length,
      firstBeforeMs: +coldBefore.ms.toFixed(2), firstAfterMs: +coldAfter.ms.toFixed(2),
      medianBeforeMs: +oldMs.toFixed(2), medianAfterMs: +newMs.toFixed(2), speedup: +(oldMs / newMs).toFixed(2) });
  }
  console.table(rows);
} finally {
  await Promise.all([before.server.close(), after.server.close()]);
}
