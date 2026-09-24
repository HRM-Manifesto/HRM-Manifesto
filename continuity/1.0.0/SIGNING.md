# Signing HRM Core 1.0.0

This procedure is for Aleksander Krzymowski. It is not doctrine.

## Before signing
1. Run tools/verify_hrm_release.py and require a clean integrity result.
2. Review core/1.0.0/SOURCE_MAP.json and the source files.
3. Confirm that core/1.0.0/release.json is the exact release being approved.
4. Do not sign if the release remains uncertain.

## Private-key rule
Create and keep the secret key outside D:\MANIFEST and outside repositories, runtime services, environment variables and agent-accessible memory. Prefer encrypted removable/offline storage plus a separate encrypted recovery copy. Never send the private key or its passphrase to an AI system.

## Manual key creation
Run Minisign yourself in a normal terminal and choose the secret-key location yourself:
minisign -G -p HRM_FOUNDER.pub -s <PRIVATE_LOCATION>\HRM_FOUNDER.key

## Manual signature
minisign -Sm D:\MANIFEST\GitHub\HRM-Manifesto\core\1.0.0\release.json -s <PRIVATE_LOCATION>\HRM_FOUNDER.key

The public artifact is release.json.minisig. The secret key remains outside the project.

## Verification
minisign -Vm D:\MANIFEST\GitHub\HRM-Manifesto\core\1.0.0\release.json -p HRM_FOUNDER.pub

After successful verification, only the public key, its fingerprint and the signature may be copied into public HRM material.