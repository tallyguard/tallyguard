// SPDX-License-Identifier: Apache-2.0
// Probot adapter (D014). Wires pull_request events to the framework-agnostic handler.
//
// Webhook discipline (ROADMAP 2.3 / D064): GitHub marks a delivery failed after ~10s, so the
// handler acks immediately and the clone + scan run on as a background task that posts the check
// when done. Deliveries are deduped on their `X-GitHub-Delivery` ID (GitHub retries/redeliveries
// resend it), and the checkout is async so the event loop is not blocked while git runs.
//
// This is the one surface that cannot be exercised in unit tests: it needs a registered
// GitHub App (App ID, private key, webhook secret) and an always-on host. The logic it
// drives (reviewPullRequest, reviewDirectory, createDeliveryDeduper, signature verification)
// is tested directly. To run it: APP_ID/PRIVATE_KEY/WEBHOOK_SECRET env set, then
// `probot run ./dist/app/probot-app.js`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Probot } from "probot";
import { reviewPullRequest, createDeliveryDeduper } from "./handler.js";
import type { PullRequestRef, CheckRunInput } from "./handler.js";

const execFileP = promisify(execFile);

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

async function checkoutHead(token: string, ref: PullRequestRef): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "tg-pr-"));
  const url = `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`;
  try {
    await execFileP("git", ["clone", "--no-checkout", "--depth", "1", url, dir]);
    await execFileP("git", ["-C", dir, "fetch", "--depth", "1", "origin", ref.headSha]);
    await execFileP("git", ["-C", dir, "checkout", ref.headSha]);
  } catch {
    // Never rethrow the raw exec error: it embeds the command line, which contains the token.
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`git checkout of ${ref.owner}/${ref.repo}@${ref.headSha} failed`);
  }
  return dir;
}

export default function tallyguardApp(app: Probot): void {
  const isNewDelivery = createDeliveryDeduper();

  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    // Probot acks the webhook when this resolves, so it must return fast (GitHub's ~10s delivery
    // timeout). The actual work runs in `task`, deliberately not awaited.
    // eslint-disable-next-line @typescript-eslint/require-await
    async (context) => {
      if (!isNewDelivery(context.id)) {
        context.log.info({ delivery: context.id }, "duplicate delivery ignored");
        return;
      }
      const { owner, repo } = context.repo();
      const ref: PullRequestRef = { owner, repo, headSha: context.payload.pull_request.head.sha };

      const task = async (): Promise<void> => {
        const auth = (await context.octokit.auth({ type: "installation" })) as { token: string };
        await reviewPullRequest(ref, {
          checkout: (r) => checkoutHead(auth.token, r),
          cleanup: (dir) => {
            rmSync(dir, { recursive: true, force: true });
            return Promise.resolve();
          },
          createCheckRun: async (input) => {
            await checksCreate(context.octokit)(input);
          },
        });
      };
      // Scan errors already surface as a neutral "scan failed" check inside reviewPullRequest;
      // anything thrown past that (checkout/auth) is logged here, never left unhandled.
      task().catch((e: unknown) => {
        context.log.error({ err: e, owner, repo }, "pull request scan task failed");
      });
    },
  );
}
