# CI integration

Tallyguard is built to gate a CI step. It is deterministic (same input, same output), needs no
network or secrets in the detection path, and uses stable exit codes.

## Exit-code gating

The scan exits `2` when it finds something and `1` on a tool error, so a plain CI step fails
the build on findings:

```yaml
- run: npx tallyguard scan .
```

To let findings annotate without failing the job (report-only), don't rely on the exit code,
take the SARIF route below instead.

## GitHub code scanning (SARIF)

Emit SARIF 2.1.0 and upload it; findings then appear in the repository's Security tab and inline
on pull requests.

```yaml
name: Tallyguard
on: [pull_request]
permissions:
  contents: read
  security-events: write # required to upload SARIF
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx tallyguard scan . --sarif > tallyguard.sarif
        continue-on-error: true # let the upload run even when findings exist
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: tallyguard.sarif
```

SARIF caps to respect (GitHub's limits): 10 MB gzipped, 25,000 results per run, top 5,000
displayed by severity.

## Notes

- Pin third-party actions to commit SHAs and keep the default `GITHUB_TOKEN` read-only,
  elevating per job (this repo's own workflows follow that).
- The scan reads only your source; it does not install or run your dependencies.
- For monorepos, run one scan per app, or point `scan` at the app subdirectory.
