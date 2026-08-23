import projectLicense from "../../LICENSE?raw";
import thirdPartyNotices from "../../THIRD_PARTY_NOTICES.md?raw";
import { SiteHeader } from "../site/SiteHeader";

export function LicenceApp() {
  return <>
    <SiteHeader active="licence" />
    <main className="licence-shell">
      <header className="licence-intro">
        <span>QNIAPC</span>
        <h1>Licences &amp; Acknowledgements</h1>
        <p>
          QniaPC is distributed under the MIT License. The bundled sfinder-wasm
          runtime is included under a separate project-specific MIT grant from
          its copyright holder; its public upstream release remains GPL-3.0-only.
        </p>
      </header>

      <section className="licence-section" aria-labelledby="project-licence-title">
        <h2 id="project-licence-title">QniaPC — MIT License</h2>
        <pre>{projectLicense}</pre>
      </section>

      <section className="licence-section" aria-labelledby="third-party-title">
        <h2 id="third-party-title">Third-party notices and acknowledgements</h2>
        <p className="licence-note">
          The following is the complete notice document shipped with this project.
          Reference acknowledgements do not imply that the referenced material is
          distributed as part of QniaPC.
        </p>
        <pre>{thirdPartyNotices}</pre>
      </section>
    </main>
  </>;
}
