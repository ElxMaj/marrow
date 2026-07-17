import { WaitlistForm } from "@/components/waitlist-form";

// The terms: self-host is free forever, the cloud is for teams who would
// rather not run it. Tier names only, no prices; numbers on a page before
// validation would cut against everything the page just argued.
export function Cloud() {
  return (
    <section className="cloud" id="cloud" aria-label="Marrow cloud">
      <p className="claim-kicker" data-reveal>
        09 · Cloud
      </p>
      <div className="cloud-band" data-reveal>
        <div className="cloud-copy">
          <h2 className="claim-title">Yours to run. Or ours to run for you.</h2>
          <p>
            The core is Apache 2.0 on one Postgres, yours for good. Marrow Cloud adds the org layer:
            hosted brains, SSO, RBAC, audit, backups and support. The four sacred things are never
            gated: decided vs open, provenance, the question loop, task-scoped retrieval.
          </p>
          <p className="cloud-tiers">
            Free · Pro · Team · Enterprise. Pricing is not final and we will not pretend it is.
          </p>
        </div>
        <WaitlistForm />
      </div>
    </section>
  );
}
