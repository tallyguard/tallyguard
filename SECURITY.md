# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue. Use GitHub's **private
vulnerability reporting** on this repository (the **Security** tab -> **Report a
vulnerability**). Include steps to reproduce and the affected version or commit.

We aim to acknowledge a report within a few days. If Tallyguard is ever listed on the GitHub
Marketplace, we will additionally notify GitHub of a confirmed incident within 24 hours, per
Marketplace requirements.

## Scope

Tallyguard is a static analyzer. It parses source code and never executes it, makes no network
calls during analysis, and (for the CLI) reads only the local files you point it at. Security
concerns of interest include:

- The analyzer mishandling crafted input (parser resource exhaustion, path traversal).
- Supply-chain integrity of the published package.
- For the GitHub App: webhook signature handling and installation-token handling.

## No warranty

Tallyguard is provided as-is under the [Apache-2.0 license](LICENSE). It is not a guarantee of
security and does not replace a security review. Static analysis has bounded recall: it
reliably catches the catalogued shapes and will not catch a novel pattern it does not list.
