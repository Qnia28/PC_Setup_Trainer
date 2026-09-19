import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SiteHeader } from "../site/SiteHeader";
import { RecommendationRequestCancelled, RecommendationWorkerSlot } from "../setups/recommendationWorkerClient";
import type { SetupCandidate } from "../setups/query";
import type { SetupVariant } from "../setups/schema";
import { setupRateMetrics } from "../site/setupMetricDisplay";
import { loadDictionary } from "./data";
import { dictionaryLabel } from "./labels";
import { parseDictionarySearch } from "./searchInput";
import { bestsaveLabel, dictionaryQuery, groupDictionaryEntries, percent, searchedEntries, sortDictionaryGroupsByRates,
  type DictionaryBranch, type DictionaryEntry, type DictionaryGroup, type DictionaryPc } from "./model";

const COLORS: Record<string, string> = { I: "#62d6ed", J: "#6686ed", L: "#f2a457", O: "#eed266", S: "#87cc85", T: "#b390df", Z: "#ed8185" };
const PCS: DictionaryPc[] = [1, 2, 3, 4, 5, 6, 7, 8];
const PAGE_SIZE = 36;

export function SetupDiagram({ setup, label = setup.displayName }: { setup: SetupVariant; label?: string }) {
  const cells = new Map(setup.placements.flatMap(placement => placement.cells.map(cell => [`${cell.x},${cell.y}`, placement.piece] as const)));
  return <svg className="dictionary-board" viewBox="0 0 240 96" role="img" aria-label={dictionaryLabel(label)}>
    {Array.from({ length: 40 }, (_, index) => {
      const x = index % 10, y = 3 - Math.floor(index / 10), piece = cells.get(`${x},${y}`);
      return <rect key={index} x={x * 24 + 1} y={(3 - y) * 24 + 1} width="22" height="22" rx="2" fill={piece ? COLORS[piece] : "#192831"} />;
    })}
  </svg>;
}

function Branches({ branches }: { branches: DictionaryBranch[] }) {
  return <ol className="dictionary-branches">{branches.map((branch, index) => <li key={index}>
    <strong>{dictionaryLabel(branch.condition)}</strong>
    {branch.note && <p>{dictionaryLabel(branch.note)}</p>}
    <div className="dictionary-branch-forms">{branch.forms.map((form, index) => <figure key={`${form.id}:${index}`}>
      <SetupDiagram setup={form} /><figcaption>{form.geometryKind === "solution-shadow" ? "Post-clear field" : dictionaryLabel(form.displayName)}</figcaption>
    </figure>)}</div>
    {branch.children?.length ? <Branches branches={branch.children} /> : null}
  </li>)}</ol>;
}

function EntryDetails({ entry, searched }: { entry: DictionaryEntry; searched: boolean }) {
  return <section className="dictionary-entry">
    <div className="dictionary-forms">{entry.forms.map((setup, index) => <article className="dictionary-form" key={`${setup.id}:${index}`}>
      <h3>{dictionaryLabel(setup.formLabel ?? setup.displayName)}{setup.derivedVariant === "mirror" ? " · Mirror" : ""}</h3>
      <SetupDiagram setup={setup} />
      <dl className="dictionary-metrics">
        <div><dt>Pieces</dt><dd>{setup.pieceSignature.join(" ")} · {setup.placements.length}P</dd></div>
        {setupRateMetrics(setup).map(metric => <div key={metric.label}><dt>{metric.label === "PC" ? "PC%" : metric.label}</dt><dd>{metric.value}</dd></div>)}
        <div><dt>Bestsave</dt><dd>{bestsaveLabel(setup.bestsave ?? entry.bestsave)}</dd></div>
        {setup.saveMetricKind === "percentage" && <div><dt>Saves%</dt><dd>{percent(setup.saves)}</dd></div>}
        {entry.goodSavePercent !== undefined && <div><dt>Good Save%</dt><dd>{percent(entry.goodSavePercent)}</dd></div>}
      </dl>
    </article>)}</div>
    {entry.conditions.length > 0 && <section className="dictionary-conditions"><h3>Conditions · Source orientation</h3>
      <ul>{entry.conditions.map((condition, index) => <li key={index}>{dictionaryLabel(condition)}</li>)}</ul></section>}
    {entry.kind === "OQB" && <section className="dictionary-followup"><h3>OQB continuations · Source orientation</h3>
      {searched && <span className="dictionary-tag">Pending observation</span>}
      {entry.observation && <p>{dictionaryLabel(entry.observation)}</p>}
      {entry.referenceForm && <figure className="dictionary-reference"><SetupDiagram setup={entry.referenceForm} label="Source precondition" /><figcaption>Source precondition</figcaption></figure>}
      <Branches branches={entry.branches} />
    </section>}
  </section>;
}

function GroupDetails({ group, searched, onClose }: { group: DictionaryGroup; searched: boolean; onClose: () => void }) {
  const simple = group.entries.every(entry => entry.conditions.length === 0 && entry.kind !== "OQB");
  return <section className={`dictionary-details ${simple ? "simple" : ""}`} id="dictionary-expanded" aria-label="Setup forms">
    <header><h2>{dictionaryLabel(group.title)} <span>{group.formCount} forms</span></h2><button type="button" onClick={onClose} aria-label="Close forms">×</button></header>
    {group.entries.map(entry => <EntryDetails key={entry.key} entry={entry} searched={searched} />)}
  </section>;
}

type SearchState = { status: "idle" } | { status: "loading" | "ready"; candidates: SetupCandidate[]; queue: string }
  | { status: "class-loading" | "class-ready"; entries: DictionaryEntry[]; label: string } | { status: "error"; message: string };
export function DictionaryApp() {
  const [pc, setPc] = useState<DictionaryPc>(1);
  const [queue, setQueue] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("All");
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const worker = useRef<RecommendationWorkerSlot | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    setCatalogState("loading"); setEntries([]); setCatalogError("");
    void loadDictionary(pc).then(result => { if (active) { setEntries(result); setCatalogState("ready"); } })
      .catch(reason => { if (active) { setCatalogError(String(reason)); setCatalogState("error"); } });
    return () => { active = false; };
  }, [pc]);
  useEffect(() => () => { generation.current++; worker.current?.dispose(); worker.current = null; }, []);

  function resetSearch() {
    generation.current++; worker.current?.dispose(); worker.current = null;
    setSearch({ status: "idle" }); setPage(0); setSelected(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); resetSearch();
    const request = generation.current;
    try {
      const input = parseDictionarySearch(pc, queue);
      if (input.kind === "class") {
        setSearch({ status: "class-loading", entries: [], label: input.value });
        const { searchDictionaryClass } = await import("./classSearch");
        if (generation.current !== request) return;
        setSearch({ status: "class-ready", entries: searchDictionaryClass(entries, input), label: input.value });
        return;
      }
      const query = dictionaryQuery(pc, input.value);
      const normalized = input.value;
      setSearch({ status: "loading", candidates: [], queue: normalized });
      worker.current = new RecommendationWorkerSlot();
      const task = worker.current.start(query, stage => {
        if (generation.current !== request) return;
        setSearch({ status: stage.complete ? "ready" : "loading", candidates: stage.candidates, queue: normalized });
      });
      await task.done;
    } catch (reason) {
      if (generation.current !== request || reason instanceof RecommendationRequestCancelled) return;
      setSearch({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
    }
  }
  const searching = search.status === "loading" || search.status === "ready";
  const classSearch = search.status === "class-loading" || search.status === "class-ready";
  const busy = search.status === "loading" || search.status === "class-loading";
  const list = useMemo(() => searching ? searchedEntries(entries, search.candidates)
    : classSearch ? search.entries : entries, [entries, search, searching, classSearch]);
  const groups = useMemo(() => sortDictionaryGroupsByRates(groupDictionaryEntries(list)), [list]);
  const filtered = useMemo(() => groups.filter(group => (kind === "All" || group.entries[0]!.kind === kind)
    && dictionaryLabel(`${group.title} ${group.entries.map(entry => `${entry.title} ${entry.source}`).join(" ")}`).toLowerCase().includes(name.toLowerCase())), [groups, name, kind]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <><SiteHeader active="dictionary" /><main className="dictionary-shell">
    <header className="dictionary-heading"><h1>Setup Dictionary</h1></header>
    <nav className="dictionary-pcs" aria-label="PC number">{PCS.map(value => <button key={value} type="button"
      aria-current={pc === value ? "page" : undefined} onClick={() => {
        if (pc !== value) { resetSearch(); setName(""); setKind("All"); setPc(value); }
      }}>PC# {value}</button>)}</nav>
    <section aria-label={`PC# ${pc} setups`}>
    <form className="dictionary-search" onSubmit={event => void submit(event)}>
      <label className="dictionary-queue-label">Queue / Class<input aria-label="Queue or class" value={queue} placeholder="TOILJSZ / TO / NO IJ / -IJ" autoComplete="off" spellCheck={false}
        onChange={event => { resetSearch(); setQueue(event.target.value.toUpperCase()); }} /></label>
      <button type="submit" disabled={catalogState !== "ready" || busy}>{busy ? "Searching…" : "Search"}</button>
      <button type="button" className="dictionary-secondary" onClick={() => { resetSearch(); setQueue(""); }}>Reset</button>
    </form>
    <div className="dictionary-filters"><label>Name<input value={name} placeholder="Find setup" onChange={event => { setName(event.target.value); setPage(0); setSelected(null); }} /></label>
      <label>Type<select value={kind} onChange={event => { setKind(event.target.value); setPage(0); setSelected(null); }}>
        <option value="All">All</option><option>General</option><option>QB</option><option>OQB</option>
      </select></label><p role="status">{catalogState === "loading" ? "Loading…" : `PC# ${pc} · ${searching ? `Queue ${search.queue}` : classSearch ? `Class ${search.label} · Queue unchecked` : "All"} · ${filtered.length} setups`}</p>
    </div>
    {catalogState === "error" && <p role="alert">{catalogError}</p>}
    {search.status === "error" && <p role="alert">{search.message}</p>}
    <section aria-label="Setup list" aria-busy={busy || catalogState === "loading"}>
      <div className="dictionary-grid">{visible.map(group => {
        const entry = group.entries[0]!, setup = entry.forms[0]!, expanded = selected === group.key;
        return <Fragment key={group.key}><button type="button" className={`dictionary-card ${expanded ? "selected" : ""}`}
          aria-expanded={expanded} aria-controls={expanded ? "dictionary-expanded" : undefined}
          onClick={() => setSelected(expanded ? null : group.key)}>
          <div className="dictionary-card-top"><span className={`dictionary-tag ${entry.kind.toLowerCase()}`}>{entry.kind}</span><span>{setup.placements.length}P</span></div>
          <SetupDiagram setup={setup} label={group.title} /><strong>{dictionaryLabel(group.title)}</strong>
          <span className="dictionary-card-bottom"><span className="dictionary-card-rates">{setupRateMetrics(setup).map(metric => <span key={metric.label}>{metric.label} {metric.value}</span>)}</span>{(setup.bestsave ?? entry.bestsave) === true && <span className="dictionary-bestsave">Bestsave</span>}</span>
          <small>{group.formCount} {group.formCount === 1 ? "form" : "forms"}</small>
        </button>{expanded && <GroupDetails group={group} searched={searching} onClose={() => setSelected(null)} />}</Fragment>;
      })}</div>
      {catalogState === "ready" && filtered.length === 0 && <p className="dictionary-empty">{busy ? "Searching…" : "No matching setups."}</p>}
      {pageCount > 1 && <nav className="dictionary-pagination" aria-label="Setup pages"><button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelected(null); }}>Previous</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage + 1 === pageCount} onClick={() => { setPage(currentPage + 1); setSelected(null); }}>Next</button></nav>}
    </section>
    </section>
  </main></>;
}
