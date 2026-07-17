import { WAITLIST_URL } from "@/content/links";

// The waitlist is a GitHub Discussions link, stated plainly. The previous
// form posted to an endpoint that did not exist and fell back to an email
// address on a domain we do not control yet, so every signup dead-ended.
// Until the domain and a real mailbox land, the honest path is the one that
// works today: GitHub, where a maintainer actually answers.
export function WaitlistForm() {
  return (
    <div className="waitlist">
      <div className="waitlist-row">
        <a className="btn-promote" href={WAITLIST_URL}>
          Join the waitlist on GitHub
        </a>
      </div>
      <p className="waitlist-note">
        Cloud is a short waitlist while the core hardens. It lives in GitHub Discussions until the
        domain lands, so nothing you send can dead-end. No tracking.
      </p>
    </div>
  );
}
