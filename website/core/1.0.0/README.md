# HRM Core 1.0.0

Status rule: this package is a release candidate unless and until the exact 
elease.json bytes have a valid founder Minisign signature. No payload file is modified after signing.

This package freezes the already-existing HRM Version 1.0 sources. It does not amend, summarize or reinterpret the doctrine.

Language status: Polish = original; English = canonical translation; Swedish = additional official translation.

`source/` contains copied source files. `extracted/` contains machine-readable technical extractions from the DOCX files and is not an independent doctrinal source. `SOURCE_MAP.json`, `release.json` and `SHA256SUMS.txt` provide provenance and integrity metadata.

A future founder signature must cover the exact bytes of `release.json`. The automated system must never possess the founder signing key.
