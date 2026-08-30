import { MAX_TARGET_CHARS, REQUEST_TIMEOUT_MS } from "./config.mjs";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

function repositoryParts(repository) {
  const match = String(repository ?? "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error("Invalid GITHUB_REPOSITORY");
  return { owner: match[1], name: match[2], nameWithOwner: `${match[1]}/${match[2]}` };
}

export function parseTarget(target, repository) {
  const value = String(target ?? "").trim();
  if (!value || value.length > MAX_TARGET_CHARS || /[\r\n\0]/.test(value)) {
    throw new Error("Invalid publication target");
  }
  const repo = repositoryParts(repository);

  if (/^[1-9]\d{0,9}$/.test(value)) {
    return { kind: "discussion_number", number: Number(value), repo };
  }

  if (value.startsWith("https://")) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid publication target URL");
    }
    const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/discussions\/([1-9]\d{0,9})\/?$/);
    if (
      url.hostname !== "github.com"
      || url.username
      || url.password
      || url.port
      || !pathMatch
      || url.search
      || url.hash
      || `${pathMatch[1]}/${pathMatch[2]}`.toLowerCase() !== repo.nameWithOwner.toLowerCase()
    ) {
      throw new Error("Target URL must be a Discussion URL in this repository");
    }
    return { kind: "discussion_number", number: Number(pathMatch[3]), repo };
  }

  if (/^[A-Za-z0-9_-]{8,200}$/.test(value)) {
    return { kind: "node_id", nodeId: value, repo };
  }

  throw new Error("Target must be a Discussion number, Discussion URL, or node ID from the review email");
}

export async function githubGraphql({
  token,
  query,
  variables,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "HRM-Forum-Steward",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const requestId = String(response.headers?.get?.("x-github-request-id") ?? "unavailable")
      .replace(/[^A-Za-z0-9:._-]/g, "").slice(0, 100) || "unavailable";
    throw new Error(`GitHub GraphQL request failed with status ${response.status}; request id: ${requestId}`);
  }
  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error("GitHub GraphQL rejected the request");
  }
  return payload.data;
}

const DISCUSSION_QUERY = `query ResolveDiscussion($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id
      number
      title
      body
      url
      author { login }
      repository { nameWithOwner }
    }
  }
}`;

const NODE_QUERY = `query ResolveDiscussionNode($id: ID!) {
  node(id: $id) {
    __typename
    ... on Discussion {
      id
      number
      title
      body
      url
      author { login }
      repository { nameWithOwner }
    }
    ... on DiscussionComment {
      id
      body
      url
      author { login }
      discussion {
        id
        number
        url
        repository { nameWithOwner }
      }
    }
  }
}`;

function verifyRepository(actual, expected) {
  if (!actual || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Resolved target is outside this repository");
  }
}

export async function resolveTarget({ target, repository, token, fetchImpl = globalThis.fetch }) {
  const parsed = parseTarget(target, repository);
  if (parsed.kind === "discussion_number") {
    const data = await githubGraphql({
      token,
      query: DISCUSSION_QUERY,
      variables: { owner: parsed.repo.owner, name: parsed.repo.name, number: parsed.number },
      fetchImpl,
    });
    const discussion = data?.repository?.discussion;
    if (!discussion) throw new Error("Discussion target was not found");
    verifyRepository(discussion.repository?.nameWithOwner, parsed.repo.nameWithOwner);
    return {
      sourceType: "discussion",
      sourceId: discussion.id,
      sourceBody: `${discussion.title}\n\n${discussion.body}`.trim(),
      sourceAuthor: discussion.author?.login ?? "unknown",
      sourceUrl: discussion.url,
      discussionId: discussion.id,
      discussionNumber: discussion.number,
      discussionUrl: discussion.url,
      replyToId: null,
    };
  }

  const data = await githubGraphql({
    token,
    query: NODE_QUERY,
    variables: { id: parsed.nodeId },
    fetchImpl,
  });
  const node = data?.node;
  if (!node || !["Discussion", "DiscussionComment"].includes(node.__typename)) {
    throw new Error("Node target is not a Discussion or DiscussionComment");
  }
  if (node.__typename === "Discussion") {
    verifyRepository(node.repository?.nameWithOwner, parsed.repo.nameWithOwner);
    return {
      sourceType: "discussion",
      sourceId: node.id,
      sourceBody: `${node.title}\n\n${node.body}`.trim(),
      sourceAuthor: node.author?.login ?? "unknown",
      sourceUrl: node.url,
      discussionId: node.id,
      discussionNumber: node.number,
      discussionUrl: node.url,
      replyToId: null,
    };
  }

  verifyRepository(node.discussion?.repository?.nameWithOwner, parsed.repo.nameWithOwner);
  return {
    sourceType: "discussion_comment",
    sourceId: node.id,
    sourceBody: node.body,
    sourceAuthor: node.author?.login ?? "unknown",
    sourceUrl: node.url,
    discussionId: node.discussion.id,
    discussionNumber: node.discussion.number,
    discussionUrl: node.discussion.url,
    replyToId: node.id,
  };
}

const PUBLISH_MUTATION = `mutation PublishApprovedReply($discussionId: ID!, $replyToId: ID, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId,
    replyToId: $replyToId,
    body: $body
  }) {
    comment { id url }
  }
}`;

export async function publishDiscussionReply({ resolvedTarget, body, token, fetchImpl = globalThis.fetch }) {
  const data = await githubGraphql({
    token,
    query: PUBLISH_MUTATION,
    variables: {
      discussionId: resolvedTarget.discussionId,
      replyToId: resolvedTarget.replyToId,
      body,
    },
    fetchImpl,
  });
  const comment = data?.addDiscussionComment?.comment;
  if (!comment?.id || !comment?.url) throw new Error("GitHub did not confirm publication");
  return { id: comment.id, url: comment.url };
}

const MARKER_SCAN_QUERY = `query FindApprovalMarker($discussionId: ID!, $after: String) {
  node(id: $discussionId) {
    ... on Discussion {
      comments(first: 100, after: $after) {
        nodes {
          id
          body
          url
          replies(first: 100) {
            nodes { body url }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const REPLY_MARKER_SCAN_QUERY = `query FindApprovalMarkerInReplies($commentId: ID!, $after: String) {
  node(id: $commentId) {
    ... on DiscussionComment {
      replies(first: 100, after: $after) {
        nodes { body url }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function markerHit(nodes, marker) {
  const hit = (nodes ?? []).find((node) => typeof node.body === "string" && node.body.includes(marker));
  return hit ? { found: true, url: hit.url } : null;
}

async function scanRemainingReplies({ comment, marker, token, fetchImpl }) {
  let pageInfo = comment.replies?.pageInfo;
  let pages = 0;
  while (pageInfo?.hasNextPage) {
    if (pages++ >= 100) throw new Error("GitHub reply history exceeds the idempotency scan limit");
    const data = await githubGraphql({
      token,
      query: REPLY_MARKER_SCAN_QUERY,
      variables: { commentId: comment.id, after: pageInfo.endCursor },
      fetchImpl,
    });
    const replies = data?.node?.replies;
    const hit = markerHit(replies?.nodes, marker);
    if (hit) return hit;
    pageInfo = replies?.pageInfo;
  }
  return null;
}

export async function findApprovalMarker({ discussionId, marker, token, fetchImpl = globalThis.fetch }) {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(String(discussionId ?? ""))) throw new Error("Invalid Discussion node ID");
  if (!/^<!-- hrm-approval:[a-f0-9]{64} -->$/.test(String(marker ?? ""))) throw new Error("Invalid approval marker");
  let after = null;
  let pages = 0;
  while (true) {
    if (pages++ >= 100) throw new Error("GitHub Discussion history exceeds the idempotency scan limit");
    const data = await githubGraphql({
      token,
      query: MARKER_SCAN_QUERY,
      variables: { discussionId, after },
      fetchImpl,
    });
    const comments = data?.node?.comments;
    if (!comments) throw new Error("GitHub did not return Discussion comments");
    const topLevelHit = markerHit(comments.nodes, marker);
    if (topLevelHit) return topLevelHit;
    for (const comment of comments.nodes ?? []) {
      const initialReplyHit = markerHit(comment.replies?.nodes, marker);
      if (initialReplyHit) return initialReplyHit;
      const laterReplyHit = await scanRemainingReplies({ comment, marker, token, fetchImpl });
      if (laterReplyHit) return laterReplyHit;
    }
    if (!comments.pageInfo?.hasNextPage) return { found: false, url: "" };
    after = comments.pageInfo.endCursor;
  }
}
