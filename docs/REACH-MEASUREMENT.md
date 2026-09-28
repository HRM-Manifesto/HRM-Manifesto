# HRM reach measurement and privacy

This document describes the measurement code that is actually present on the public HRM website.

## Purpose

HRM Radar is a first-party system used to understand whether HRM ideas are being found and read. It is not an advertising system and is not intended for behavioural profiling.

## Browser-side data

The public website may send:

- page views;
- coarse engagement thresholds;
- scroll-depth thresholds;
- selected download, contact, external-discussion and internal-navigation clicks;
- page language and broad idea category;
- UTM source / medium / campaign / content parameters;
- referring hostname and limited referring path when the browser provides them.

## Identifiers

HRM does not create a persistent cross-session visitor identifier.

The browser generates random identifiers in `sessionStorage` for the current browser session. These disappear when the browser session ends. The server stores a hash of the supplied session-related identifier for measurement.

The collector is designed not to store raw IP addresses or a full user-agent string in the Radar measurement dataset.

## Visitor choice

- The browser's `Do Not Track: 1` signal disables Radar client-side.
- A visitor can disable Radar from the public Privacy page.
- The opt-out preference `hrm_radar_optout_v1=1` is stored locally so the choice persists.
- No third-party advertising analytics script is used.

Public explanations:
- EN: `/privacy.html`
- PL: `/pl/privacy.html`
- SV: `/sv/privacy.html`

## Retention

The current collector configuration provides for a maximum Radar retention period of 100 days. Security/hosting logs are a separate operational layer and must not be silently treated as Radar analytics data.

## Interpretation limits

A session is not a person. A click is not agreement. A self-declared agent request is not proof of agent identity or subjecthood. Metrics must not be presented as evidence that HRM has been accepted by a community, institution or artificial system.

## Minimal reporting

Internal aggregate reports may include page views, sessions, engagement thresholds, idea categories, broad referral sources and campaign parameters. Low-volume breakdowns should not be published when they could make a visitor identifiable.

## Governance

Any future change that introduces persistent identifiers, third-party analytics, additional personal data, longer retention or new tracking purposes requires an explicit privacy review and corresponding public documentation before deployment.
