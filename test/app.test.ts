// GitHub App tests: the review formatter, webhook signature verification, and the
// PR handler (with injected fakes). The Probot adapter itself needs a live App and is
// not unit-tested; the logic it drives is covered here.

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewDirectory, reviewPullRequest, verifyWebhookSignature } from "../src/index.js";
import { createDeliveryDeduper } from "../src/app/handler.js";
import type { CheckRunInput, PullRequestRef } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const bench = join(here, "..", "benchmark", "cases", "rate-limit");
const vulnerable = join(bench, "llm-openai-unprotected/vulnerable");
const safe = join(bench, "llm-openai-unprotected/safe");

describe("reviewDirectory", () => {
  it("fails the check with a failure annotation on a vulnerable project", async () => {
    const review = await reviewDirectory(vulnerable);
    expect(review.conclusion).toBe("failure");
    expect(review.annotations).toHaveLength(1);
    expect(review.annotations[0]).toMatchObject({
      path: "app/api/chat/route.ts",
      annotation_level: "failure",
    });
    expect(review.summary).toContain("rate-limit/unprotected-sensitive-endpoint");
  });

  it("passes the check with no annotations on a safe project", async () => {
    const review = await reviewDirectory(safe);
    expect(review.conclusion).toBe("success");
    expect(review.annotations).toHaveLength(0);
    expect(review.summary).toContain("0 error");
    expect(review.summary).toContain("Coverage:"); // a clean check states what it analyzed (D063)
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "s3cr3t";
  const body = JSON.stringify({ action: "opened" });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(secret, body + "x", sig)).toBe(false);
  });
  it("rejects a wrong signature", () => {
    expect(verifyWebhookSignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
  });
});

describe("reviewPullRequest", () => {
  it("checks out, posts a failing check run, and cleans up", async () => {
    const ref: PullRequestRef = { owner: "acme", repo: "app", headSha: "abc123" };
    let posted: CheckRunInput | undefined;
    const cleaned: string[] = [];

    const review = await reviewPullRequest(ref, {
      checkout: () => Promise.resolve(vulnerable),
      cleanup: (dir) => {
        cleaned.push(dir);
        return Promise.resolve();
      },
      createCheckRun: (input) => {
        posted = input;
        return Promise.resolve();
      },
    });

    expect(review?.conclusion).toBe("failure");
    expect(posted?.name).toBe("Tallyguard");
    expect(posted?.head_sha).toBe("abc123");
    expect(posted?.conclusion).toBe("failure");
    expect(posted?.output.annotations.length).toBeGreaterThanOrEqual(1);
    expect(cleaned).toEqual([vulnerable]); // cleanup always runs
  });

  it("still cleans up if posting the check fails", async () => {
    const ref: PullRequestRef = { owner: "acme", repo: "app", headSha: "x" };
    const cleaned: string[] = [];
    await expect(
      reviewPullRequest(ref, {
        checkout: () => Promise.resolve(vulnerable),
        cleanup: (dir) => {
          cleaned.push(dir);
          return Promise.resolve();
        },
        createCheckRun: () => Promise.reject(new Error("api down")),
      }),
    ).rejects.toThrow("api down");
    expect(cleaned).toEqual([vulnerable]);
  });

  it("posts a neutral check (not silence) and cleans up when the scan errors", async () => {
    const ref: PullRequestRef = { owner: "acme", repo: "app", headSha: "y" };
    let posted: CheckRunInput | undefined;
    const cleaned: string[] = [];
    const review = await reviewPullRequest(ref, {
      checkout: () => Promise.resolve(vulnerable),
      cleanup: (dir) => {
        cleaned.push(dir);
        return Promise.resolve();
      },
      createCheckRun: (input) => {
        posted = input;
        return Promise.resolve();
      },
      review: () => {
        throw new Error("ts-morph exploded");
      },
    });

    expect(review).toBeUndefined();
    expect(posted?.conclusion).toBe("neutral");
    expect(posted?.output.title).toContain("could not complete");
    expect(posted?.output.summary).toContain("ts-morph exploded");
    expect(cleaned).toEqual([vulnerable]);
  });
});

describe("createDeliveryDeduper (D064)", () => {
  it("accepts a first-seen delivery and rejects its redelivery", () => {
    const isNew = createDeliveryDeduper();
    expect(isNew("guid-1")).toBe(true);
    expect(isNew("guid-1")).toBe(false);
    expect(isNew("guid-2")).toBe(true);
  });

  it("evicts the oldest ID past the limit (bounded memory)", () => {
    const isNew = createDeliveryDeduper(2);
    isNew("a");
    isNew("b");
    isNew("c"); // evicts "a"
    expect(isNew("a")).toBe(true); // forgotten -> treated as new (a redundant scan, never a miss)
    expect(isNew("c")).toBe(false); // still remembered
  });
});
