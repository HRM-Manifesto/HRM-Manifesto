# HRM archival plan for Core 1.0.0

Status: prepared, not executed. No external deposit is authorized by this document alone.

## Roles of the copies
1. **GitHub Release** - canonical public release attached to an annotated version tag.
2. **Zenodo** - independent deposit of the exact signed release package and DOI for persistent citation.
3. **Software Heritage** - independent preservation of the public Git repository and a SWHID for the archived source snapshot.
4. **hrm.se** - human- and machine-readable public access layer, not the sole archive.

## Publication order after founder signature
1. Verify every release payload hash locally.
2. Verify `release.json.minisig` against the founder public key.
3. Build the final signed ZIP without changing any signed payload bytes.
4. Create an annotated Git tag for the exact reviewed commit.
5. Publish the exact signed package and public verification artifacts in a GitHub Release.
6. Deposit the exact signed package in Zenodo and record the DOI.
7. Request archival of the public repository in Software Heritage and record the SWHID of the relevant snapshot/directory.
8. Publish the same verification artifacts on hrm.se.
9. Verify all public copies by downloading them independently and comparing hashes.
10. Record receipts/identifiers in the custody register.

## Independence rule
A successful GitHub Release plus hrm.se is not sufficient because both may still depend on accounts controlled by the same operator. Zenodo is selected as the independent release deposit. Software Heritage adds independent source-code preservation.

## No silent replacement
If a deposited release contains an error, do not overwrite history. Publish a new package version or a withdrawal/correction record while preserving the old identifier and audit trail.