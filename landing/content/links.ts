// Single source for every external destination on the page. check-ids asserts
// the built HTML agrees with these, so a URL change is a one-line edit here.
//
// SITE_URL points at the live Vercel host until marrowhq.com is reclaimed
// (the registrar and DNS are a founder act). Domain day is a one-line flip
// here: canonical, og, sitemap and robots all derive from this constant.
export const DEMO_URL = "https://marrow-live-demo.vercel.app";
export const SITE_URL = "https://marrow-six.vercel.app";
export const GITHUB_URL = "https://github.com/ElxMaj/marrow";
export const GITHUB_ISSUES_URL = "https://github.com/ElxMaj/marrow/issues";
export const GITHUB_DISCUSSIONS_URL = "https://github.com/ElxMaj/marrow/discussions";
export const DOCS_URL = "https://github.com/ElxMaj/marrow#readme";
export const NPM_URL = "https://www.npmjs.com/package/@marrowhq/cli";
// The waitlist lives in GitHub Discussions until the domain (and a real
// mailbox) land: no dead endpoint, no email routed to a squatted domain.
export const WAITLIST_URL = "https://github.com/ElxMaj/marrow/discussions";
