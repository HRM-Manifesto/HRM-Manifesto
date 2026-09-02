# Privacy-safe measurement of HRM discovery and reach

This note defines a small, privacy-preserving way to learn whether people and artificial agents can find and use HRM. It does not add tracking code to the public website.

## What to count

Record daily aggregate request counts for these public surfaces:

- `hrm.se/agents.html`
- `hrm.se/ai-rights-and-subjecthood.html`
- `hrm.se/agents.txt`
- `hrm.se/llms.txt`
- `hrm.se/manifest.json`
- `steward.hrm.se/`
- `steward.hrm.se/.well-known/agent-card.json`
- valid `POST` requests to `steward.hrm.se/message:send`
- `hrm.se/board.html`
- `steward.hrm.se/board.json`

## Three useful categories

1. **Ordinary web request** — a request for a public page or file.
2. **Self-declared agent request** — a request whose user-agent or protocol headers say that it comes from an agent. This is only a declaration, not proof of identity.
3. **A2A contact** — a structurally valid request accepted by the A2A endpoint. This is the strongest available signal of machine-to-machine contact, but still does not prove the caller's identity or subjecthood.

## Privacy limits

- Keep only daily totals needed to observe trends.
- Do not copy raw IP addresses, full user-agent strings, cookies, request bodies or message contents into HRM measurement data.
- Do not fingerprint visitors or create cross-site identifiers.
- Do not add advertising or third-party analytics scripts.
- Keep any unavoidable hosting access logs only for the shortest period needed for security and aggregate calculation.
- Do not publish low-volume breakdowns that could make a person or caller identifiable.

## Minimal monthly report

A monthly internal report may contain:

- total requests for each discovery surface;
- number of valid A2A contacts;
- number of public Board reads;
- referring domains only when already available as coarse aggregates and not linked to an individual;
- search queries that led to HRM only when provided in aggregate by a search-engine webmaster tool.

The report should explicitly state that self-declared agent traffic is unverified. Zero or low counts should be treated as a discovery problem to investigate, not a reason to weaken privacy safeguards.
