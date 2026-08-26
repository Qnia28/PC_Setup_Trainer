# SFinder Tools User Guide

This guide explains the tools available from the **SFinder** menu in QniaPC.
`PC Solver` solves **one concrete visible queue**, while the other pages expose SFinder-style analysis features through the web interface.

The SFinder analysis pages support 2 through 6 target lines. The separate PC Solver currently provides 4L, 5L, and 6L modes.

---

## Common inputs

### Field / Fumen
You can draw the field directly or paste a Fumen code or Fumen URL.
`Target lines` is the height that must be filled to complete the PC. The SFinder analysis pages support **2 through 6 lines**.

- `2-4L Mode`: 2, 3, or 4 lines
- `5-6L Mode`: 5 or 6 lines
- These two mode groups belong to the analysis pages. PC Solver instead provides separate 4L, 5L, and 6L buttons.
- Blocks above the selected target height are not allowed.
- Chance / Saves / Minimals / Per-save minimals normally analyze the first Fumen page.

### Queue pattern
SFinder-style queue patterns are supported.

```text
TOILJSZ        one exact queue
*p7            every permutation of seven pieces
*!             alias of *p7; every permutation of seven pieces
[TILJS]!       every permutation of the listed pieces
T,*p7          fixed T followed by a seven-piece bag
I[JS]![TO]!,*p2
A;B            analyze both branches
```

Branches separated by a semicolon (`;`) are kept as separate analysis cases.

### Hold
When `Use hold` is enabled, the calculation includes normal Hold usage.
Keeping it enabled is recommended unless you intentionally want a no-Hold calculation.

---

# PC Solver

> **Finds actual PC solutions for the current field and one concrete queue.**
> Unlike the SFinder pattern tools, this is intended for directly solving the specific queue visible during Tetris PC play.

### Inputs
- Field or Fumen
- Target line count: 4, 5, or 6 in the current PC Solver UI
- A **concrete queue** containing only `TILJOSZ`
- Display mode: `One` or `All`

The number of pieces required for the PC is:

```text
pieces needed = (Target lines × 10 - occupied cells) / 4
```

### One minimal
If the queue length is exactly the number of pieces required, `One minimal` returns **one preferred solution**.

The solver prefers solutions with more playable placement orders. Ties are resolved deterministically so the same input produces the same preferred solution.

Despite the UI label, this is not a minimum-cover calculation. It selects one preferred solution for the concrete queue.

### All
Under the same exact-queue condition, `All` returns **every distinct PC solution**.

### Save mode
If the queue contains **at least one extra piece**, the solver uses the first `pieces needed + 1` pieces as a save calculation.

- `One`: shows a preferred solution for each piece that can be saved
- `All`: shows every solution grouped under Save T / I / L / J / O / S / Z
- Pieces after the required `P+1` prefix are ignored

PC Solver does not accept SFinder pattern syntax such as `*p7` or `[TILJS]!`.

---

# Chance

> **Calculates how often the field can be Perfect Cleared across a queue pattern.**
> Use it when you want the PC success rate and the exact queues that fail.

### Inputs
- Field or Fumen
- Queue pattern
- Target lines
- Use hold

### Results
- `Chance`: PC success percentage
- `Success`: number of successful queues
- `Total`: total expanded queues
- `Failed`: number of failed queues
- List of failed queues

For example, `*p7` checks all 5040 permutations of seven pieces.

Chance is the best choice when you only need **whether a PC is possible**. If you also need representative solution Fumens, use Minimals instead.

---

# Saves

> **Calculates how often a PC is possible while preserving a requested saved piece or save condition.**
> For example, it can tell you how many successful queues can finish while keeping T.

### Inputs
- Field or Fumen
- Queue pattern
- Target lines
- `Wanted save`
- Use hold

### Wanted save examples

```text
T          save T
TI         save both T and I
T || I     save T or I
T && I     save both T and I
!T         do not save T
(T || I) && !O
```

Parentheses can be combined with `||`, `&&`, and `!`.

### Important
Saves must know which pieces belong to the **final bag**. Use a bag-aware SFinder pattern such as `*p7`, `[....]!`, or `...pN` when performing save analysis.

### Results
- Number of cases satisfying the save condition
- Total analysis cases
- Success percentage
- Failed queue list

Leaving `Wanted save` empty removes the save filter, although in that case Chance is usually the more appropriate tool.

---

# Minimals

> **Finds the smallest set of solutions needed to cover the queue pattern.**
> Use it when you want a small collection of representative PC solutions instead of one solution for every queue.

### Inputs
- Field or Fumen
- Queue pattern
- Target lines
- Optional: `Wanted save`
- Optional: Result title
- Use hold

Leave `Wanted save` empty to find minimals across all PC solutions.

> In the current web UI, use an **empty Wanted save field** for all solutions. Do not type `all`.

To restrict the result to a save condition, use the same expressions as Saves.

```text
T
T || I
TI
!O
```

### Results
- Number of queues satisfying the PC/save condition
- Number of minimal solutions
- Coverage count for each selected solution
- Result Fumen

Selected solutions are displayed in **coverage-descending order**. If two solutions cover the same number of cases, their deterministic solution key is used as the tie-break.

For example, if three selected solutions cover 300, 200, and 120 queues respectively, they are displayed in that order.

### How to interpret it
Minimals is not simply "pick the solutions with the highest individual coverage."
It first finds a **globally smallest solution set that covers all successful cases**, then sorts the selected solutions by coverage for easier viewing.

As with Saves, use a pattern that provides final-bag information when applying a save condition.

---

# Per-save minimals

> **Finds representative/minimal solutions separately for every possible saved piece.**
> Use it when you want one section for Save T, another for Save I, and so on.

### Inputs
- Field or Fumen
- `Visible queue`
- Target lines
- Optional: Result title
- Use hold

If the current field needs `P` pieces to complete the PC, every input queue must contain exactly **P+1 pieces**.

```text
pieces needed = (Target lines × 10 - occupied cells) / 4
queue length = pieces needed + 1
```

For example, on a 5-line field with 26 occupied cells:

```text
remaining cells = 50 - 26 = 24
pieces needed = 6
queue length = 7
```

### One exact queue
For one concrete queue, the tool quickly selects a preferred playable solution for each save piece that is possible.

### Pattern input
For a queue-pattern matrix, the tool computes an **exact minimal covering set for each saved piece**.

### Results
For Save T / I / L / J / O / S / Z, the page shows:

- Whether that save is possible and its rate
- Number of minimal solutions
- Solution Fumens

When a save group contains multiple solutions, higher-coverage solutions are displayed first. The current UI does not list each solution's numeric coverage count separately.
