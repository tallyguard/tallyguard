# Releasing `tallyguard` to npm

Publishing is automated and tokenless: a `v*` tag triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs the full gate
(typecheck, lint, format, tests, the benchmark scorer, build) and then `npm publish` using
**npm trusted publishing** (OIDC) with **build provenance**. No `NPM_TOKEN` is stored anywhere.

## One-time setup (npmjs.com, the maintainer does this once)

1. Sign in to npmjs.com with **2FA enabled** on the account/org.
2. Reserve/create the package name (an empty first publish, or just the name) so it exists.
3. On the package's **Settings → Trusted publishers**, add a GitHub Actions trusted publisher:
   - Repository: `tallyguard/tallyguard`
   - Workflow filename: `release.yml`
   - (Environment: leave blank unless you add one.)
4. That is it. The workflow's OIDC identity is now allowed to publish; no token to manage.

## Cutting a release

1. Bump `version` in `package.json` (semver) and update anything user-facing if needed.
2. Commit it (`Release vX.Y.Z`), and merge to `main` (CI must be green).
3. Tag and push the tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The Release workflow runs the gate, verifies the tag matches `package.json`, and publishes
   with provenance. Confirm on npm: `npm view tallyguard version`.

After the first publish, `npx tallyguard scan <path>` works for everyone.

## Notes

- The published tarball contains only `dist/` plus `README.md`, `LICENSE`, and `package.json`
  (`"files": ["dist"]`); source, tests, and the benchmark are not shipped. Verify with
  `npm pack --dry-run`.
- Type declarations (`.d.ts`) are not generated yet (the CLI bin is the shipped artifact);
  re-enable when the library API is published for external TypeScript consumers.
- The release workflow pins its actions to commit SHAs, like the other workflows.
