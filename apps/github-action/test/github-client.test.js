import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github-client.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("GitHubClient constructor rejects empty token / owner / repo", () => {
  assert.throws(() => new GitHubClient({ token: "", owner: "o", repo: "r" }), /token/);
  assert.throws(() => new GitHubClient({ token: "t", owner: "", repo: "r" }), /owner/);
  assert.throws(() => new GitHubClient({ token: "t", owner: "o", repo: "" }), /owner/);
});

test("listIssueComments aggregates pagination via Link header rel=next", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("?per_page=100")) {
      return jsonResponse([{ id: 1, body: "first" }], {
        headers: { Link: '<https://api.github.com/repos/o/r/issues/42/comments?per_page=100&page=2>; rel="next"' }
      });
    }
    if (url.includes("page=2")) {
      return jsonResponse([{ id: 2, body: "second" }]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    const comments = await client.listIssueComments(42);
    assert.equal(comments.length, 2);
    assert.deepEqual(comments.map((c) => c.id), [1, 2]);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHubClient refuses to follow Link headers to non-GitHub hosts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return jsonResponse([{ id: 1 }], {
      headers: { Link: '<https://evil.example.com/leak>; rel="next"' }
    });
  };
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    const comments = await client.listIssueComments(1);
    assert.equal(comments.length, 1, "pagination should stop after the cross-host Link header is rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHubClient.request refuses non-api.github.com URLs", async () => {
  const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
  await assert.rejects(() => client.request("GET", "https://evil.example.com/leak"), /Refusing to fetch a non-GitHub URL/);
});

test("GitHubClient.request refuses to follow GitHub redirects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("", { status: 301, headers: { Location: "https://api.github.com/elsewhere" } });
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    await assert.rejects(() => client.request("GET", "https://api.github.com/foo"), /redirect/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createIssueComment POSTs the markdown body and returns the parsed response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  let capturedHeaders = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = init.body;
    capturedHeaders = init.headers;
    return jsonResponse({ id: 99, html_url: "https://github.com/o/r/issues/1#issuecomment-99" }, { status: 201 });
  };
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    const result = await client.createIssueComment(1, "hello");
    assert.equal(result.id, 99);
    assert.equal(JSON.parse(capturedBody).body, "hello");
    assert.equal(capturedHeaders.Authorization, "Bearer t");
    assert.equal(capturedHeaders["X-GitHub-Api-Version"], "2022-11-28");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateIssueComment PATCHes the comment id", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = null;
  let capturedMethod = null;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedMethod = init.method;
    return jsonResponse({ id: 99 });
  };
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    await client.updateIssueComment(99, "updated");
    assert.equal(capturedMethod, "PATCH");
    assert.match(capturedUrl, /issues\/comments\/99$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHubClient surfaces non-OK responses with status + body text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
  try {
    const client = new GitHubClient({ token: "t", owner: "o", repo: "r" });
    await assert.rejects(() => client.createIssueComment(1, "x"), /429/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
