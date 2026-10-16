# Drafts

Pages that are not published. GitHub Pages deploys only `docs/`, so nothing
here is reachable on pathfinding.cloud.

- `privacy/index.html`: draft privacy page for live labs, accounts and the
  leaderboard. Internal placeholder until it is reviewed and we decide between
  a page of our own and Datadog's generic privacy policy. It was written to sit
  at `docs/privacy/` and links site assets with absolute paths, so it only
  renders correctly once moved back there (or served from `docs/` locally).
  Publishing it also means restoring the footer link on every page
  (`scripts/generate-lab-stubs.py` regenerates the lab stubs) and the
  "Privacy details" link in the sign-in modal (`docs/js/pf-account.js`) and
  the "see Privacy" link in `docs/labs/getting-started/index.html`.
