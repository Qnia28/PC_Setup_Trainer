import projectLicense from "../../LICENSE?raw";
import { SiteHeader } from "../site/SiteHeader";
import {
  SETUP_DATA_ACKNOWLEDGEMENTS,
  SFINDER_ACKNOWLEDGEMENTS,
  THIRD_PARTY_LICENCES,
  type Acknowledgement,
} from "./thirdPartyLicences";

function AcknowledgementList({ entries }: { entries: readonly Acknowledgement[] }) {
  return <ul>
    {entries.map((entry) => <li key={entry.name}>
      <h4>{entry.sourceUrl
        ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.name}</a>
        : entry.name}</h4>
      <p><strong>{entry.credit}</strong> — {entry.summary}</p>
    </li>)}
  </ul>;
}

export function LicenceApp() {
  return <>
    <SiteHeader active="licence" />
    <main className="licence-shell">
      <header className="licence-intro">
        <span>QNIAPC</span>
        <h1>Licences</h1>
        <p>
          QniaPC and its bundled third-party software are distributed under the
          licence terms listed below.
        </p>
      </header>

      <section className="licence-section" aria-labelledby="project-licence-title">
        <h2 id="project-licence-title">QniaPC — MIT License</h2>
        <pre>{projectLicense}</pre>
      </section>

      <section className="licence-section" aria-labelledby="third-party-title">
        <h2 id="third-party-title">Bundled third-party licences</h2>
        <p className="licence-note">
          The MIT License terms above apply to the MIT-licensed entries together
          with their respective copyright notices.
        </p>
        <ul className="licence-list">
          {THIRD_PARTY_LICENCES.map((entry) => <li key={entry.name}>
            <h3><a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.name}</a></h3>
            <dl>
              <div><dt>Licence</dt><dd>{entry.licence}</dd></div>
              <div><dt>Copyright</dt><dd>{entry.copyright}</dd></div>
            </dl>
          </li>)}
        </ul>
      </section>

      <section className="licence-section" aria-labelledby="acknowledgements-title">
        <h2 id="acknowledgements-title">Acknowledgements</h2>
        <div className="acknowledgement-groups">
          <article>
            <h3>SFinder-related</h3>
            <AcknowledgementList entries={SFINDER_ACKNOWLEDGEMENTS} />
          </article>
          <article>
            <h3>Setup data</h3>
            <AcknowledgementList entries={SETUP_DATA_ACKNOWLEDGEMENTS} />
          </article>
        </div>
      </section>
    </main>
  </>;
}
