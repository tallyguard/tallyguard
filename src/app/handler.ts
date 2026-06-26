// SPDX-License-Identifier: Apache-2.0
// Framework-agnostic pull-request handler. The GitHub I/O (checkout, posting the check)
// is injected as `deps`, so the orchestration is testable with fakes and the Probot
// adapter stays thin. Processing is transient: the checkout is cleaned up in `finally`,
// nothing is persisted (D008/D010 data-minimization).

import { reviewDirectory } from "./review.js";
import type { ReviewResult, Annotation } from "./review.js";

export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
}

export interface CheckRunInput {
  readonly owner: string;
  readonly repo: string;
  readonly head_sha: string;
  readonly name: string;
  readonly status: "completed";
  readonly conclusion: "success" | "failure" | "neutral";
  readonly output: {
    readonly title: string;
    readonly summary: string;
    readonly annotations: Annotation[];
  };
}

export interface ReviewDeps {
  /** Check out the PR head into a local directory; returns its path. */
  checkout(ref: PullRequestRef): Promise<string>;
  /** Remove the checkout (always called, even on error). */
  cleanup(dir: string): Promise<void>;
  /** Post the result as a GitHub check run. */
  createCheckRun(input: CheckRunInput): Promise<void>;
  /** Override the scan (defaults to reviewDirectory); injectable for testing. */
  review?: (rootDir: string) => ReviewResult;
}

const CHECK_NAME = "Tallyguard";

/**
 * Review a PR head: check out, scan, and post a check run, then clean up. If the scan itself
 * fails, degrade gracefully by posting a neutral "scan failed" check rather than throwing or
 * leaving the PR with no feedback (the plan's reliability requirement). Returns the review,
 * or undefined if the scan failed.
 */
export async function reviewPullRequest(
  ref: PullRequestRef,
  deps: ReviewDeps,
): Promise<ReviewResult | undefined> {
  const dir = await deps.checkout(ref);
  const base = {
    owner: ref.owner,
    repo: ref.repo,
    head_sha: ref.headSha,
    name: CHECK_NAME,
  } as const;
  try {
    let review: ReviewResult;
    try {
      review = (deps.review ?? reviewDirectory)(dir);
    } catch (e) {
      await deps.createCheckRun({
        ...base,
        status: "completed",
        conclusion: "neutral",
        output: {
          title: "Scan could not complete",
          summary: `Tallyguard could not complete the scan: ${(e as Error).message}`,
          annotations: [],
        },
      });
      return undefined;
    }
    await deps.createCheckRun({
      ...base,
      status: "completed",
      conclusion: review.conclusion,
      output: { title: review.title, summary: review.summary, annotations: review.annotations },
    });
    return review;
  } finally {
    await deps.cleanup(dir);
  }
}
