# HRM Project Continuity Protocol 1.0.0

Status: operational protocol for HRM custody. It is not HRM doctrine and cannot amend the founding texts.

## 1. Purpose
Preserve identification, integrity, provenance and availability of HRM Version 1.0 after loss of any single computer, domain, account, model, agent or active operator.

## 2. Four separate questions
1. Integrity: are these the same bytes? Verified with cryptographic hashes.
2. Provenance: was this release approved by the authorized founder/custodian? Verified with a digital signature and an independently published public key.
3. Durability: can the release be recovered after loss of one location? Verified by independent copies and restoration tests.
4. Status: is this founding doctrine, an official translation, technical metadata, commentary, research or criticism? Verified by the release catalog and authority classes.

A hash, signature or archive identifier does not prove that HRM is philosophically correct. These mechanisms establish identity, provenance and custody only.

## 3. Immutable founding doctrine
- HRM Version 1.0 is never overwritten in place.
- A future doctrine must have a separate version and explicit founder approval while that authority exists.
- Packaging, metadata, gateways, validators and indexes have their own versions and do not alter doctrine.
- Historical releases remain identifiable after correction or supersession.

## 4. Authority classes
Public materials use explicit classes: founding_text, official_translation, technical_metadata, author_commentary, research_note, external_critique, agent_interpretation, evaluation_material.
Only founding_text and official_translation may be presented as doctrinal source text.

## 5. Founder signature
- The exact bytes of core/1.0.0/release.json are signed with Minisign/Ed25519.
- The founder private key is created and used manually.
- It is never copied into D:\MANIFEST, environment variables, source repositories, databases, agent memory or runtime services.
- Agents may receive the public key and public signature only.
- Automated custodians may verify signatures but may not generate a founder signature.

## 6. Public key anchoring
The founder public key and fingerprint should be published in at least two independently administered places. The first publication requires explicit founder confirmation. Rotation or revocation creates a new record; historical releases remain verifiable with the historical key.

## 7. Copies and deposits
An approved release should exist in three location classes: a canonical public release repository; hrm.se or its successor; and an independent archival/deposit service outside the same hosting/account structure. A local backup does not count as an independent public deposit.

## 8. Restoration test
At least annually, or after material infrastructure changes, obtain a release outside the active working directory and verify all payload hashes, the founder signature and offline readability without hrm.se, the Factory, a database or a language model.

## 9. Succession
No successor is presumed. A successor exists only after a real identified person knowingly accepts a written mandate. Until then, loss or withdrawal of the founder's active role causes archival mode, not automatic transfer of doctrinal authority.

A future steward may maintain mirrors, verify integrity and publish exact already-approved copies within an explicit mandate. A steward may not silently amend doctrine or use a custodian key as if it were the founder key.

## 10. Loss of a key
Loss of the private key does not invalidate historical releases already signed with it. If the founder is available, a new key may be established by an explicit rotation record. If no authorized signer is available, the last valid signed release remains the reference and the project continues in archival mode.

## 11. Loss of domain or repository
No domain or repository account is itself the identity of HRM. Recovery starts from a signed release plus a trusted public key. A new canonical location must preserve historical identifiers and clearly state continuity.

## 12. Automated custody limits
Automation may read approved sources, verify hashes/signatures, make local reports and check known copies. New external publication, new accounts, new deposits, third-party contact, paid operations and doctrinal changes remain disabled unless explicitly authorized.

## 13. Quiet mode
Healthy operation creates no routine decision request for the founder. Escalation is reserved for confirmed integrity/provenance failures, loss of independent copies, material doctrinal ambiguity, serious external analysis, concrete collaboration proposals or fundamental custody decisions.