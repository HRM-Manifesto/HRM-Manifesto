# HRM recovery procedure

1. Obtain release.json, release.json.minisig, the public founder key and release payload.
2. Verify the public key against a second independently administered location.
3. Verify the Minisign signature over the exact release.json bytes.
4. Verify every SHA-256 listed in release.json.
5. Read SOURCE_MAP.json to determine source status and language authority.
6. If hrm.se is unavailable, use the verified package directly.
7. If repositories disagree, prefer the copy that verifies against the trusted signature and exact historical release manifest. Record the conflict; do not silently merge files.
8. A claimed new doctrine without a valid authorized signature is unverified material, not a replacement for HRM Version 1.0.