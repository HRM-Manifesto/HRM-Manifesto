# HRM production deployment

Production files are transferred to Loopia with a dedicated FTPS account restricted by Loopia to `/hrm.se/public_html/`. The Loopia owner password, BankID, and 2FA are never used by GitHub Actions.

## Safety boundary

- `deployment/hrm-static-files.txt` is the explicit deployment allowlist.
- Founding Manifesto Version 1.0, the Charter, Decalogue, Declaration, Threshold, historical archive, licenses, documents, and checksum files are rejected even if someone adds them to the allowlist.
- The deploy workflow runs repository tests before it can reach production.
- Every deployment first downloads the exact target files to a private GitHub Actions artifact retained for 30 days.
- Rollback is a separate manual workflow and restores only the paths touched by the selected deployment run.

## Required GitHub Actions secrets

- `LOOPIA_FTPS_USERNAME`
- `LOOPIA_FTPS_PASSWORD`

The server name is not secret and remains fixed in the workflow as `ftpcluster.loopia.se`. FTPS certificate verification is mandatory.

## Controlled use

1. Review a pull request that changes public, non-protected files and the allowlist if needed.
2. Run **HRM Production Deploy** with `probe` first or `production` plus the exact confirmation text.
3. If rollback is needed, run **HRM Production Rollback** with the deployment run ID and the exact confirmation text.
