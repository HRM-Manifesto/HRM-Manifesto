# HRM Approval Gateway — component prepared, not deployed

This directory describes the persistent storage boundary for the mobile approval gateway. The reviewed HTTP/state-machine implementation is in `../src/approval-gateway.mjs`; it is deliberately not connected to public hosting in this repository.

## Safety contract

- `GET`, `HEAD`, previews and prefetches never mutate persistent state.
- A decision requires a same-origin form `POST` and a short-lived, stateless CSRF value bound to the capability token and action.
- Capability tokens contain 256 bits of random entropy, are different from Approval IDs, expire with the signed approval record and are stored only as SHA-256 hashes.
- The database must claim an active token atomically before publication. Reuse, replay and expiry are denied.
- A failed or ambiguous publication leaves the token consumed (`failed`), never active for an automatic retry.
- `notification_key` is unique. A repeated GitHub event returns `created: false` and produces no second review email.
- Every signed case must match the single repository configured for the gateway.
- The gateway must never log raw tokens, signed records, Approval IDs, approved text or secrets.

## Required production adapter

Before deployment, implement the store interface used by `MemoryGatewayStore` with transactions against the table in `schema.sql`. `createCase` must use the unique `notification_key`; `claim` must be one conditional update from `active` to `processing`. The in-memory store exists only for deterministic tests and must not be used in production.

The gateway also needs a thin server adapter and the existing reviewed publication executor. Deployment must be audited separately before DNS, Loopia or the public site is changed.

## Hosting finding

Loopia documents PHP on its ordinary UNIX hosting and states that Node.js requires a VPS. The current public site responds from Loopia infrastructure, but the account plan and enabled PHP/database features cannot be established from the repository. Therefore no runtime, database, URL or DNS setting is assumed and nothing is deployed by this change.
