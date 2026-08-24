# QniaPC에 최신 sfinder-wasm 통합 지침

## 대상

- QniaPC: `Qnia28/PC_Setup_Trainer`
- sfinder-wasm 최신본: `sfinder-wasm-single-queue-shared-engine-cleanup.zip`
- ZIP SHA-256: `353a3cea15d180faabb3981bd0ffd146ea8dbefadec6859f9836510975431170`

---

## 1. 작업 목표

QniaPC에 포함된 기존 sfinder-wasm snapshot을 최신본으로 교체한다.

이번 버전에서는 단순히 WASM 바이너리만 교체하는 것이 아니라 solver 구조가 정리되었고, 다음 기능들이 공용 엔진을 공유한다.

- chance
- saves
- minimals
- per-save-minimals
- single exact queue path
- solve-one
- solve-all
- per-save-all
- 5~6L broad-pattern path
- cover 계열

특히 QniaPC에서 기존에 직접 구현하던 다음 구조를 제거한다.

```text
solveOne()
solveAll()
perSaveAll()
→ WasmPcSolver.enumeratePc()
→ JS에서 정렬 / save 분류 / Fumen 생성
```

대신 sfinder-wasm이 제공하는 공식 single-queue wrapper/API를 사용한다.

핵심 원칙:

> QniaPC는 "무슨 기능을 요청할지"만 결정하고, "어떻게 계산할지"는 sfinder-wasm이 담당한다.

---

## 2. vendor 갱신

현재 QniaPC의 solver vendor 경계는 다음과 같다.

```text
vendor/sfinder-wasm/
  README.md
  upstream/
```

다음 방식으로 갱신한다.

1. 기존 `vendor/sfinder-wasm/upstream/` 내용을 제거한다.
2. 최신 ZIP의 `sfinder-wasm/` 전체 내용을 `vendor/sfinder-wasm/upstream/`에 넣는다.

최소한 다음 항목을 빠뜨리지 않는다.

```text
src/
wasm/
docs/
rust/
tests/
LICENSE
THIRD_PARTY_NOTICES.md
README.md
package.json
```

특히 최신 버전을 반드시 사용하는 파일:

```text
wasm/pc_wasm.wasm
wasm/batch_wasm.wasm
wasm/legal_boards_4.lgb

src/wasm-backend.mjs
src/path-engine.mjs
src/pc-input.mjs
src/pc-solve.mjs
src/features.mjs
src/per-save-minimals*.mjs
src/piece-order.mjs
```

`vendor/sfinder-wasm/upstream/` 내부에 QniaPC 전용 로직을 추가하지 않는다.

---

## 3. QniaPC Worker 구조는 유지

QniaPC의 다음 구조는 유지한다.

```text
src/solver/pc.worker.mjs
src/solver/worker-runtime.mjs
src/solver/workerClient.ts
```

이 계층은 QniaPC 전용으로 다음을 담당한다.

- persistent Worker
- solver instance 재사용
- WASM memory 추적
- 128 MiB recycle 정책
- cancellation
- application request protocol

따라서 QniaPC Worker를 sfinder-wasm의 Worker로 통째로 교체하지 않는다.

대신 QniaPC Worker는 sfinder-wasm의 public feature/wrapper API를 호출하는 adapter가 되도록 한다.

---

## 4. QniaPC 자체 `wasm-backend.mjs` 중복 제거

현재 QniaPC의:

```text
src/solver/wasm-backend.mjs
```

에는 `WasmPcSolver` 구현이 복제되어 있다.

최신 sfinder-wasm의 `src/wasm-backend.mjs`에는 이미 다음이 포함되어 있다.

```text
bulk solution export
bestPc()
saved-piece export
pattern dispatch
canPcMany()
enumeratePcMany()
perSaveBest()
minimumCover()
```

따라서 QniaPC의 local backend는 다음 둘 중 하나로 정리한다.

### 권장

upstream backend를 직접 import한다.

### 호환성 유지가 필요한 경우

얇은 re-export만 남긴다.

예:

```js
export {
  loadWasmAssets,
  WasmPcSolver,
} from "../../vendor/sfinder-wasm/upstream/src/wasm-backend.mjs";
```

QniaPC에 다음 solver 내부 구현을 다시 복제하지 않는다.

```text
PIECE_CODE
queueBits()
solution mask getter
pattern dispatch
saved-piece 계산
minimum-cover 호출
```

---

## 5. QniaPC Worker runtime 정리

QniaPC에서 유지할 것:

- `getSolver()`
- solver cache
- warmup
- memory accounting
- recycle policy
- Worker lifecycle

QniaPC에서 제거할 중복 구현:

```text
geometry()
exactQueue()
preferredSolution()
solveOne()
solveAll()
perSaveAll()
```

이 기능들은 최신 sfinder-wasm의 공용 계층에 맡긴다.

권장 import:

```js
import {
  calculateChance,
  calculateMinimalsFeature,
  calculatePerSaveMinimalsFeature,
  calculateSaves,
} from "../../vendor/sfinder-wasm/upstream/src/features.mjs";

import {
  solveSingleQueueFeature,
} from "../../vendor/sfinder-wasm/upstream/src/pc-solve.mjs";

import {
  resolvePerSaveTargetLines,
} from "../../vendor/sfinder-wasm/upstream/src/per-save-minimals.mjs";

import {
  loadWasmAssets,
  WasmPcSolver,
} from "../../vendor/sfinder-wasm/upstream/src/wasm-backend.mjs";
```

Worker dispatch는 대략 다음 형태로 정리한다.

```js
export async function runWorkerRequest(request) {
  const targetLines = requestHeight(request);

  if (request.kind === "warmup") {
    return warmup(targetLines);
  }

  const solver = await getSolver(targetLines);
  const input = { ...request.input, solver };

  switch (request.kind) {
    case "chance":
      return calculateChance({ ...input, clear: targetLines });

    case "saves":
      return calculateSaves({ ...input, clear: targetLines });

    case "minimals":
      return calculateMinimalsFeature({ ...input, clear: targetLines });

    case "per-save-minimals":
      return calculatePerSaveMinimalsFeature({
        ...input,
        targetLines,
      });

    case "solve-one":
    case "solve-all":
    case "per-save-all":
      return solveSingleQueueFeature(request.kind, {
        ...input,
        targetLines,
      });

    default:
      throw new Error(`unknown request ${request.kind}`);
  }
}
```

---

## 6. QniaPC 기능별 사용 명령

여기서 "명령"은 `SolverWorkerClient.request(kind, input)`의 request kind를 의미한다.

### Standalone PC Solver

| QniaPC 기능 | 조건 | Worker 명령 |
|---|---|---|
| One minimal / One solution | save 없음, exact queue | `solve-one` |
| All solutions | save 없음, exact queue | `solve-all` |
| One per Save | 한 미노 더 보이는 save mode | `per-save-minimals` |
| All per Save | 한 미노 더 보이는 save mode | `per-save-all` |

---

## 7. `solve-one`

사용 예:

```js
client.request("solve-one", {
  sourceFumen,
  pattern: exactQueue,
  targetLines,
  useHold: true,
  title: "QniaPC Solver",
});
```

의미:

- 정확히 하나의 concrete queue만 허용
- queue 길이 = PC에 필요한 placement 수
- Rust `bestPc()` 경로 사용
- 모든 solution을 JS로 반환한 뒤 하나를 고르지 않음
- 선택 기준:
  1. playable `orderCount` 최대
  2. 동률이면 solution key 사전순 최소
- Fumen 생성도 sfinder-wasm wrapper가 담당

QniaPC에서 `preferredSolution()`을 다시 구현하지 않는다.

---

## 8. `solve-all`

사용 예:

```js
client.request("solve-all", {
  sourceFumen,
  pattern: exactQueue,
  targetLines,
  useHold: true,
  title: "QniaPC Solver",
});
```

의미:

- exact queue 전용
- queue 길이 = PC에 필요한 placement 수
- 모든 distinct PC solution 반환
- sfinder-wasm이 solution key 순으로 정렬
- Fumen 생성도 sfinder-wasm이 담당

QniaPC에서 `solver.enumeratePc()`를 직접 호출하지 않는다.

---

## 9. `per-save-minimals`

사용 예:

```js
client.request("per-save-minimals", {
  sourceFumen,
  pattern: queueWithOneExtraPiece,
  targetLines,
  useHold: true,
  title: "QniaPC Solver",
});
```

의미:

- queue 길이 = `piecesNeeded + 1`
- save별 대표 minimal solution 계산
- concrete single queue에서는 내부적으로 optimized `perSaveBest()` 계열 사용
- pattern matrix에서는 exact minimum-cover 사용
- save별 Fumen / `pageCounts` / `results` 반환

QniaPC의 "One" + save mode는 이 명령을 사용한다.

---

## 10. `per-save-all`

사용 예:

```js
client.request("per-save-all", {
  sourceFumen,
  pattern: queueWithOneExtraPiece,
  targetLines,
  useHold: true,
  title: "QniaPC Solver",
});
```

의미:

- exact queue 전용
- queue 길이 = `piecesNeeded + 1`
- 모든 solution 계산
- Rust에서 전달된 saved-piece 정보를 사용
- save별 전체 solution grouping
- `pageCounts`와 Fumen 반환

QniaPC에서 다시 `unusedPieceForSolution()`으로 전체 해법을 재분류하지 않는다.

---

## 11. Live Solver

Live Solver의 4라인 제한은 의도된 것이므로 수정하지 않는다.

현재 정책:

```text
remaining target lines = 2~4 only
```

명령 매핑:

| Live Solver 상황 | 명령 |
|---|---|
| PC 이후 정확히 3개 placement가 끝난 시점 | `solve-one` |
| 그 이후 save별 해법 제시 | `per-save-minimals` |

기존 의미를 유지한다.

```js
const kind =
  piecesLockedSinceLastPc === 3
    ? "solve-one"
    : "per-save-minimals";
```

`liveSolver.ts`의 `targetLines: 2 | 3 | 4` 제한도 유지한다.

---

## 12. 일반 sfinder-wasm 기능 명령표

| 원하는 기능 | Worker 명령 | 비고 |
|---|---|---|
| PC 확률 | `chance` | pattern 가능 |
| 특정 save 확률 | `saves` | save expression 사용 |
| 조건식 minimal set | `minimals` | `*p7` 등 pattern matrix 가능 |
| save별 minimal | `per-save-minimals` | concrete queue 또는 matrix |
| exact queue 대표 1개 | `solve-one` | QniaPC One |
| exact queue 모든 해법 | `solve-all` | QniaPC All |
| save별 모든 해법 | `per-save-all` | exact queue + 1 piece |
| fourth 분석 | `fourth` | clear=4 전용 |
| fifth 분석 | `fifth` | clear=4 전용 |

낮은 수준 API:

```js
solver.enumeratePc(...)
solver.bestPc(...)
solver.enumeratePcMany(...)
solver.canPcMany(...)
```

는 sfinder-wasm 내부 구현 또는 테스트용으로 보고, QniaPC application layer에서는 직접 사용하지 않는다.

---

## 13. Cover 계열

cover 계열은 PC Worker와 분리한다.

대상 기능:

```text
cover
coverpercent
congruent
congruentcover
```

이들은 sfinder-wasm의 batch worker/runtime/client 계층을 사용한다.

명령 매핑:

| 기능 | Batch Worker 명령 |
|---|---|
| Cover | `cover` |
| Cover Percent | `coverpercent` |
| Congruent | `congruent` |
| Congruent Cover | `congruentcover` |

PC solver Worker에 cover 계열을 섞지 않는다.

---

## 14. Queue 길이 규칙

board geometry 기준으로 계산한다.

```text
targetCells = targetLines × 10
remainingCells = targetCells - occupiedCells
piecesNeeded = remainingCells / 4
```

### save 없는 exact solve

```text
solve-one
solve-all
```

조건:

```text
queue.length === piecesNeeded
```

### save가 있는 exact solve

```text
per-save-all
per-save-minimals
```

QniaPC concrete queue 사용 시:

```text
queue.length === piecesNeeded + 1
```

이 검증은 가능하면 QniaPC에 복제하지 말고 `pc-input.mjs` / `pc-solve.mjs`에 맡긴다.

---

## 15. 4L / 5~6L 최적화 분기 금지

QniaPC에서 다음과 같이 solver optimization을 직접 선택하지 않는다.

```js
if (targetLines === 4) {
  ...
} else if (targetLines >= 5) {
  ...
}
```

sfinder-wasm 내부가 자동으로 처리한다.

현재 내부 정책은 대략 다음과 같다.

```text
2~4L
  → 기존 optimized fast path

4L
  → legal-board pack
  → Stage-8 / Stage-9 oracle

5~6L broad pattern
  → pattern-level shared DAG

5~6L exact queue
  → optimized single-queue flat DAG

broad chance/path
  → shared geometry
  → queue/Hold trie

exact single solution
  → bestPc()

solution transfer
  → bulk WASM export
```

QniaPC는 명령의 의미만 선택하고 계산 전략은 선택하지 않는다.

---

## 16. 제거해야 할 QniaPC 중복 코드

통합 후 QniaPC application layer에 다음 구현이 남지 않도록 한다.

```text
preferredSolution()
local geometry()
local exactQueue()
local solveOne()
local solveAll()
local perSaveAll()

PIECE_CODE
queueBits()
WASM solution mask 반복 getter
saved-piece 계산 복제
```

특히 구버전 QniaPC `wasm-backend.mjs`의 solution별 개별 getter 호출은 제거하고 최신 upstream backend를 사용한다.

---

## 17. 수정하지 말아야 할 것

이번 통합에서 다음은 변경하지 않는다.

- `liveSolver.ts`의 2~4L 제한
- QniaPC 게임 mechanics
- queue/bag prediction 로직
- standalone Solver UI 동작
- save 표시 순서
- Worker cancellation UX
- 128 MiB Worker recycle 정책
- solver 결과 canvas rendering
- vendor 내부 sfinder-wasm에 QniaPC 전용 로직 추가

Standalone solver의 4/5/6L 지원은 그대로 유지한다.

---

## 18. 통합 후 필수 테스트

### QniaPC 전체

```bash
npm run typecheck
npm run test:all
npm run build
```

### Exact queue One

4L / 5L representative fixture에서:

```text
solve-one
```

확인:

```text
solutionCount
선택된 solution
Fumen
```

성공 시 `solutionCount === 1`.

가능하면 기존 QniaPC 방식의 `orderCount 최대 → key 사전순` 결과와 동일한지도 회귀 테스트한다.

### Exact queue All

```text
solve-all
```

확인:

- solution 수 동일
- duplicate geometry 없음
- Fumen page 수 정상
- solution order 안정적

### Per-save

```text
per-save-minimals
per-save-all
```

확인:

- save grouping 정상
- `pageCounts` 합계 정상
- T/I/L/J/S/Z/O 손실 없음
- 기존 save 표시 순서 유지

### 4L Live Solver

게임 중:

```text
3 pieces locked
→ solve-one

그 이후
→ per-save-minimals
```

가 그대로 동작하는지 확인한다.

5L/6L로 확장하지 않는다.

### Worker recycle

반복 요청 후:

```text
memoryBytes
recycle
```

처리가 기존과 동일하게 작동하는지 확인한다.

---

## 19. 완료 기준

다음을 모두 만족해야 통합 완료로 본다.

- 최신 `vendor/sfinder-wasm/upstream/` snapshot 설치
- 최신 `pc_wasm.wasm`, `batch_wasm.wasm`, `legal_boards_4.lgb` 사용
- QniaPC의 복제 `WasmPcSolver` 제거 또는 얇은 re-export화
- `solve-one`이 sfinder-wasm `bestPc` 경로 사용
- `solve-all`이 sfinder-wasm single-queue wrapper 사용
- `per-save-all`이 sfinder-wasm wrapper 사용
- `per-save-minimals`가 최신 shared engine 사용
- QniaPC app 코드에서 직접 `enumeratePc()` 후 ranking/grouping하지 않음
- Live Solver 4L 제한 유지
- Worker lifecycle/recycle 정책 유지
- `typecheck`, unit/integration tests, production build PASS

최종 구조:

```text
QniaPC UI
   ↓
SolverWorkerClient
   ↓
QniaPC pc.worker
   ↓
QniaPC worker-runtime
   │
   │ lifecycle / memory / recycle
   ↓
sfinder-wasm public feature/wrapper API
   ├─ chance
   ├─ saves
   ├─ minimals
   ├─ per-save-minimals
   ├─ solve-one
   ├─ solve-all
   └─ per-save-all
        ↓
shared path/input/solver layers
        ↓
WasmPcSolver
        ↓
Rust pc-core
```

---

## 20. 구현 원칙 요약

1. QniaPC에는 solver 내부 로직을 복제하지 않는다.
2. sfinder-wasm의 public wrapper/feature API를 우선 사용한다.
3. QniaPC Worker는 lifecycle adapter 역할만 한다.
4. 4L/5~6L 최적화 선택은 sfinder-wasm 내부에 맡긴다.
5. `solve-one`, `solve-all`, `per-save-all`에서 직접 `enumeratePc()`를 호출하지 않는다.
6. Live Solver의 4L 제한은 유지한다.
7. vendor snapshot은 한 단위로 교체하고 QniaPC 전용 변경을 upstream에 섞지 않는다.
