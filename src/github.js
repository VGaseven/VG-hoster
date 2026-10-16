// GitHub: hand tasks to Claude Code (via the Claude Code GitHub Action) and verify webhook deliveries.
import crypto from "node:crypto";

const apiBase = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
export const githubReady = () => !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

async function gh(path, body) {
  const r = await fetch(apiBase() + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vg-hoster-bridge", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message || "request failed"}`);
  return j;
}

export async function createIssue(repo, { title, body, labels = [] }) {
  if (!REPO_RE.test(repo)) throw new Error(`Bad repo name "${repo}" (expected owner/name)`);
  const i = await gh(`/repos/${repo}/issues`, { title: title.slice(0, 250), body, labels });
  return { number: i.number, url: i.html_url };
}

// X-Hub-Signature-256 check for /github/webhook.
export function verifySignature(rawBody, header) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(String(header));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
