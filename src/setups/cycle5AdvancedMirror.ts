import { mirrorPiece } from "./mirror";
import type {
  Cycle5AdvancedDirectRule, Cycle5AdvancedOqbPlan, Cycle5AdvancedQueuePattern,
  Cycle5AdvancedQueuePatternBody, Cycle5AdvancedSetupRef,
} from "./cycle5AdvancedPolicy";

function mirrorBody(body: Cycle5AdvancedQueuePatternBody): Cycle5AdvancedQueuePatternBody {
  return { parts: body.parts.map((part) => ({
    ...part, symbols: part.symbols.map((piece) => piece === "X" ? piece : mirrorPiece(piece)),
  })) };
}

/** Queue order, wildcard positions and exclusions are semantic, never display notation. */
export function mirrorCycle5AdvancedPattern(pattern: Cycle5AdvancedQueuePattern): Cycle5AdvancedQueuePattern {
  const mapBody = (body: Cycle5AdvancedQueuePatternBody) => {
    const result = mirrorBody(body);
    // The class pair is unordered, but keep its established spelling (LJ, not JL).
    // Do not reorder any next-bag segment.
    const original = body.parts[0];
    const mirrored = result.parts[0];
    if (pattern.scope === "visible-seven" && original?.kind === "ordered"
      && original.symbols.length === 2 && mirrored
      && [...original.symbols].sort().join("") === [...mirrored.symbols].sort().join("")) {
      mirrored.symbols = [...original.symbols];
    }
    return result;
  };
  return { ...pattern, ...mapBody(pattern),
    ...(pattern.excludes ? { excludes: pattern.excludes.map(mapBody) } : {}),
  };
}

export function mirrorCycle5AdvancedRef(ref: Cycle5AdvancedSetupRef): Cycle5AdvancedSetupRef {
  // displayHoldPiece is expressed in the referenced geometry's source basis.
  // Its runtime consumer applies the resulting geometry transform once.
  return { ...ref, transform: ref.transform === "mirror-x" ? "identity" : "mirror-x" };
}

export function mirrorCycle5AdvancedDirect(entry: Cycle5AdvancedDirectRule): Cycle5AdvancedDirectRule {
  return { ...entry, id: `${entry.id}--mirror`,
    alternatives: entry.alternatives.map((alternative) => ({
      pattern: mirrorCycle5AdvancedPattern(alternative.pattern),
      setupRefs: alternative.setupRefs.map(mirrorCycle5AdvancedRef),
    })),
    ...(entry.postBuildAvailability ? { postBuildAvailability: {
      ...entry.postBuildAvailability, pieces: entry.postBuildAvailability.pieces.map(mirrorPiece),
    } } : {}),
  };
}

export function mirrorCycle5AdvancedOqbInitial(plan: Cycle5AdvancedOqbPlan): Cycle5AdvancedOqbPlan {
  return { ...plan, id: `${plan.id}--mirror`,
    initialPatterns: plan.initialPatterns.map(mirrorCycle5AdvancedPattern),
    preconditionTransform: plan.preconditionTransform === "mirror-x" ? "identity" : "mirror-x",
    // Checkpoint predicates, actions and refs remain in the precondition's
    // SOURCE geometry basis. oqbProgress transforms the entire live state into
    // that basis and every observation/outcome back, including nested stages.
  };
}
