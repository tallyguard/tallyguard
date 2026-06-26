// SPDX-License-Identifier: Apache-2.0
// Probot adapter (D014). Wires pull_request events to the framework-agnostic handler.
//
// This is the one surface that cannot be exercised in unit tests: it needs a registered
// GitHub App (App ID, private key, webhook secret) and an always-on host. The logic it
// drives (reviewPullRequest, reviewDirectory, signature verification) is tested directly.
// To run it: `GITHUB_APP_* env set, then `probot run ./dist/app/probot-app.js`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Probot } from "probot";
import { reviewPullRequest } from "./handler.js";
import type { PullRequestRef, CheckRunInput } from "./handler.js";

// Octokit exposes the Checks API either flattened (`octokit.checks`) or under `octokit.rest`,
// depending on plugins. Resolve whichever is present without coupling to Probot's exact types.
type CheckCreate = (input: CheckRunInput) => Promise<unknown>;
function checksCreate(octokit: unknown): CheckCreate {
  const o = octokit as {
    checks?: { create: CheckCreate };
    rest?: { checks: { create: CheckCreate } };
  };
  const create = o.rest?.checks.create ?? o.checks?.create;
  if (!create) throw new Error("octokit has no checks.create");
  return create;
}

function checkoutHead(token: string, ref: PullRequestRef): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-pr-"));
  const url = `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`;
  const opts = { stdio: "ignore" as const };
  execFileSync("git", ["clone", "--no-checkout", "--depth", "1", url, dir], opts);
  execFileSync("git", ["-C", dir, "fetch", "--depth", "1", "origin", ref.headSha], opts);
  execFileSync("git", ["-C", dir, "checkout", ref.headSha], opts);
  return dir;
}

export default function tallyguardApp(app: Probot): void {
  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    async (context) => {
      const { owner, repo } = context.repo();
      const ref: PullRequestRef = { owner, repo, headSha: context.payload.pull_request.head.sha };

      const auth = (await context.octokit.auth({ type: "installation" })) as { token: string };

      await reviewPullRequest(ref, {
        checkout: (r) => Promise.resolve(checkoutHead(auth.token, r)),
        cleanup: (dir) => {
          rmSync(dir, { recursive: true, force: true });
          return Promise.resolve();
        },
        createCheckRun: async (input) => {
          await checksCreate(context.octokit)(input);
        },
      });
    },
  );
}
