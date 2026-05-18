// Minimal GitHub REST client built on Node's built-in `fetch`. We
// intentionally avoid pulling in @octokit/* — the surface we need is
// tiny (list, create, update PR issue comments) and adding a heavy
// dependency tree at install time would slow every CI run.

const API_ROOT = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;

export class GitHubClient {
  constructor({ token, owner, repo, userAgent = "repograph-intelligence-action" }) {
    if (!token) {
      throw new Error("GitHubClient requires a token.");
    }
    if (!owner || !repo) {
      throw new Error("GitHubClient requires owner and repo.");
    }
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.userAgent = userAgent;
  }

  async listIssueComments(issueNumber) {
    const collected = [];
    let url = `${API_ROOT}/repos/${enc(this.owner)}/${enc(this.repo)}/issues/${enc(issueNumber)}/comments?per_page=100`;
    // Cap pagination at 10 pages (1000 comments) so a runaway PR
    // history can never produce an unbounded loop.
    for (let page = 0; page < 10 && url; page += 1) {
      const response = await this.request("GET", url);
      const body = await response.json();
      if (!Array.isArray(body)) {
        break;
      }
      collected.push(...body);
      url = this.parseNextLink(response.headers.get("link"));
    }
    return collected;
  }

  createIssueComment(issueNumber, markdown) {
    const url = `${API_ROOT}/repos/${enc(this.owner)}/${enc(this.repo)}/issues/${enc(issueNumber)}/comments`;
    return this.requestJson("POST", url, { body: markdown });
  }

  updateIssueComment(commentId, markdown) {
    const url = `${API_ROOT}/repos/${enc(this.owner)}/${enc(this.repo)}/issues/comments/${enc(commentId)}`;
    return this.requestJson("PATCH", url, { body: markdown });
  }

  async requestJson(method, url, payload) {
    const response = await this.request(method, url, JSON.stringify(payload));
    return response.json();
  }

  async request(method, url, body) {
    if (!url.startsWith(API_ROOT + "/")) {
      // Defence-in-depth: we accept `Link` headers that point inside
      // the GitHub API root only. A redirect to a different host
      // would otherwise leak the token.
      throw new Error(`Refusing to fetch a non-GitHub URL: ${url}`);
    }
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${this.token}`,
      "User-Agent": this.userAgent,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "manual" });
      if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
        throw new Error(`GitHub API returned a redirect (${response.status}); refusing to follow.`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`GitHub API ${method} ${url} failed: ${response.status} ${response.statusText} — ${detail.slice(0, 500)}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  parseNextLink(linkHeader) {
    if (!linkHeader) {
      return null;
    }
    // RFC 5988 Link header: `<url>; rel="next", <url>; rel="last"`.
    for (const entry of linkHeader.split(",")) {
      const match = entry.trim().match(/^<([^>]+)>;\s*rel="next"/i);
      if (match && match[1].startsWith(API_ROOT + "/")) {
        return match[1];
      }
    }
    return null;
  }
}

function enc(segment) {
  return encodeURIComponent(String(segment));
}
