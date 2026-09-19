# Read-only setup dictionary

Route: `/dictionary` (Vite entry: `dictionary.html`). No review-studio server or write API is used.

- Browse: English UI with separate PC# 1–8 tabs, active manifest bundles and reviewed source records. The reviewer's logical grouping produces 36 parent cards per page; clicking a card expands all of its physical forms and their own metrics. Conditions and OQB plans stay attached to their original records.
- Search: one seven-character `HOLD + ACTIVE + NEXT[0..4]` string. Whitespace/lowercase normalize; bag-boundary duplicate pieces are legal. The existing production recommendation Worker evaluates initial conditions and BFS. `maxCandidates` removes display caps; `includeAllForms` disables ordinary physical-form deduplication. Source-defined fallback and staged eligibility still apply.
- The same input accepts unordered classes for PC# 2–6: 4, 1, 5, 2, and 6 distinct pieces respectively. `NO IJ` / `-IJ` select the complement of those pieces (e.g. PC# 4); `NO I` / `-I` work for PC# 6. Seven pieces always mean an ordered queue. Other lengths, duplicates in classes and compound expressions are rejected.
- Class search uses promoted class selectors, including their mirrored forms, not a substring or "shape contains these pieces" filter. It lists conditional QB/OQB entries with their conditions retained and reports `Class · Queue unchecked`; only a full queue runs BFS and order/observation checks. PC# 1, 7 and 8 retain queue-only search.
- PC# 8 uses runtime cycle 1 for eligibility, but results are restricted to the selected PC#'s records. Input/PC# changes, reset and unmount dispose the search Worker. Request generation guards reject late stages and errors. Empty results stay empty.
- Presentation uses an allowlisted entry/branch model, not a policy JSON viewer. Bestsave is tri-state; Saves is displayed only when explicitly percentage-valued. Good Save is not PC%. Directional PC metrics follow the displayed runtime geometry.
- OQB diagrams come only from explicit Cycle 3, Cycle 5 and Cycle 8 policy references. Nested Cycle 5 observation/action stages are included. Branch conditions and diagrams retain source coordinates, clearly labelled; mirrored search entries also show the source precondition for comparison. A branch needing future information is not presented as already guaranteed.
- `includePendingOqb` is dictionary-only: Cycle 8 initial-window and BFS checks still apply, but a seven-piece search does not claim a post-build branch was observed. Normal game/replay queries keep their existing behavior.
- Stored solution shadows are labelled as post-clear results, never treated as new initial BFS placements. Missing geometry is not fabricated.
- Setups retain their original authors' rights; attribution remains on the shared Licence page.

Tests: `src/dictionary/*.test.ts`, `tests/integration/dictionary*.test.ts(x)`. The integration tests use public synthetic fixtures and promoted runtime data only.
