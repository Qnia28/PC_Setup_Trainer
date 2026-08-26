export type SfinderCommandId =
  | "chance"
  | "saves"
  | "minimals"
  | "per_save_minimals"
  | "cover"
  | "congruent_cover"
  | "congruent";

export interface SfinderCommandDefinition {
  id: SfinderCommandId;
  label: string;
  summary: string;
  patternLabel: string | null;
  patternPlaceholder: string | null;
}

export const SFINDER_COMMANDS: readonly SfinderCommandDefinition[] = [
  {
    id: "chance",
    label: "Chance",
    summary: "Measure the chance of completing the selected field across a queue pattern.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "T,*p7",
  },
  {
    id: "saves",
    label: "Saves",
    summary: "Compare save conditions for the selected field and queue pattern.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "T,[^TIL]!,*p2",
  },
  {
    id: "minimals",
    label: "Minimals",
    summary: "Reduce the solution set to a minimal group that covers the queue pattern.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "[TILJS]!,*p2",
  },
  {
    id: "per_save_minimals",
    label: "Per-save minimals",
    summary: "Find a minimal solution group for every available saved piece.",
    patternLabel: "Visible queue",
    patternPlaceholder: "[TILJS]!,*p2",
  },
  {
    id: "cover",
    label: "Cover",
    summary: "Check which queues can build at least one supplied target.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "[TILJS]!",
  },
  {
    id: "congruent_cover",
    label: "Congruent cover",
    summary: "Calculate coverage while grouping congruent solution geometries.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "[TILJS]!",
  },
  {
    id: "congruent",
    label: "Congruent",
    summary: "Group equivalent solution geometries from the supplied Fumen pages.",
    patternLabel: "Queue pattern",
    patternPlaceholder: "[TILJS]!",
  },
] as const;

const HIDDEN_SFINDER_COMMANDS = new Set<SfinderCommandId>(["cover", "congruent_cover", "congruent"]);
export const SFINDER_MENU_COMMANDS = SFINDER_COMMANDS.filter(({ id }) => !HIDDEN_SFINDER_COMMANDS.has(id));

const COMMAND_BY_ID = new Map(SFINDER_COMMANDS.map((command) => [command.id, command]));

export function sfinderCommandPath(command: SfinderCommandId): string {
  return `/sfinder/${command}`;
}

export function isSfinderGuideRoute(pathname: string, fallback?: string | null): boolean {
  const pathCommand = pathname.match(/^\/sfinder\/([^/?#]+)/)?.[1];
  return (pathCommand ?? fallback) === "guide";
}

export function defaultWantedSave(command: SfinderCommandId): string {
  return command === "minimals" ? "" : "T";
}

export function resolveSfinderCommand(pathname: string, fallback?: string | null): SfinderCommandDefinition {
  const pathCommand = pathname.match(/^\/sfinder\/([^/?#]+)/)?.[1];
  const resolved = pathCommand ?? fallback ?? "chance";
  return COMMAND_BY_ID.get(resolved as SfinderCommandId) ?? COMMAND_BY_ID.get("chance")!;
}
