# Screenshot input prototype

Original implementation; no eztofumen source, palette, or assets were copied.

## Scope

TETR.IO and Jstris default-style colored screenshots with a full visible 10x20
grid, one current piece near spawn, a visible HOLD region, and five NEXT pieces.
The PC field must fit within six rows. The Clipboard button beside Fumen accepts
images for recognition or plain text for the Fumen input. Direct image paste uses
the same browser-local pipeline; no file picker is shown. Clipboard permission
errors leave inputs unchanged and offer Ctrl+V / Cmd+V as a fallback. Images are
not uploaded. Recognition runs in a
short-lived Worker, which is cancelled on replacement or unmount.

The recognizer finds locally contrasting frame lines and verifies repeating grid
edges on both axes. This avoids treating a neutral background or adjacent meter
as the board. Connected filled regions are seeded by color strength and separated
by relative chroma and hue, then checked against tetromino geometry, not fixed RGB
palettes. Narrow bevel seams are bridged and duplicate detections at the same
position are merged without collapsing repeated NEXT pieces. Preview brightness
and hue calibrate stack/ghost discrimination.
Borderline ghost cells must match the current piece's predicted landing.
Recognized results replace field and queue together, clearing stale Fumen input.
Queue order is HOLD (if present), ACTIVE, then NEXT, for the solver's initial
hold-choice convention. No unseen tail is inferred and Calculate is not automatic.

On detection failure, inputs remain unchanged. Successful results remain editable
and must be checked before Calculate. This is a prototype, not a guarantee of
zero false positives across arbitrary skins or HDR transforms. Unseen/disabled
gray HOLD, monochrome skins, garbage, animation frames, nonstandard preview
scales, missing grids, and active pieces touching the stack are unsupported.

## Evidence

- Public synthetic tests: `tests/integration/solver/screenshotRecognition.test.ts`.
- Supplied TETR.IO example: 16 cells; HOLD T, ACTIVE L, NEXT SJZTL.
- Supplied Jstris example: 16 cells; HOLD O, ACTIVE T, NEXT LIJLT.
- Both examples preserved results at brightness 0.8, gamma 0.8 and 1.35,
  and nearest-neighbor scales 0.75 and 1.25. This is not an exhaustive HDR/skin test.
- User screenshots remain outside the public checkout. Local fixture audit code
  is under the ignored `tests/internal` directory.
- 2026-09-20 transparent-background fixtures: all three supplied images contain
  16 settled cells; queues are `LTSOLTI`, `JTSOSIZ`, and `TJLSSJI`. Exact bottom-up
  fields and HOLD/ACTIVE/NEXT are independently transcribed in the private audit
  `tests/internal/screenshot-transparent-audit.mjs`.
- These three images also retain exact results at brightness 0.8, gamma 0.8/1.35,
  and nearest-neighbor scales 0.75/1.25 (18 checks including originals). Earlier
  supplied TETR.IO/Jstris image paths no longer exist locally; their historical
  evidence above is not a fresh revalidation. Public synthetic regressions cover
  colored backgrounds, tint, bevel seams, repeated NEXT, ghosts, and rejection of
  distinct multiple boards. Browser verification was explicitly waived.
