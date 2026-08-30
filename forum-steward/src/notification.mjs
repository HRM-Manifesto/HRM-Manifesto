import { createHash } from "node:crypto";

const AUTOMATION_MARKER = /<!--\s*hrm-approval:[a-f0-9]{64}\s*-->/i;

export function hasProposedReply(analysis) {
  return Boolean(String(analysis?.result?.proposed_reply_pl ?? "").trim());
}

export function isOwnAutomationEntry(entry, environment = process.env) {
  const author = String(entry?.author ?? "").trim().toLowerCase();
  const configured = String(environment.HRM_AUTOMATION_LOGIN ?? "").trim().toLowerCase();
  return author === "github-actions[bot]"
    || Boolean(configured && author === configured)
    || AUTOMATION_MARKER.test(String(entry?.body ?? ""));
}

export function reviewEmailDecision({ entry, analysis, environment = process.env }) {
  const result = analysis?.result;
  if (!result) return { send: false, reason: "missing_analysis", kind: "none" };
  if (isOwnAutomationEntry(entry, environment)) {
    return { send: false, reason: "own_automation", kind: "none" };
  }
  if (entry?.eventType === "workflow_dispatch" || String(entry?.category ?? "").toLowerCase() === "manual test") {
    return { send: false, reason: "test_event", kind: "none" };
  }
  if (result.entry_type === "spam") return { send: false, reason: "spam", kind: "none" };

  const proposed = hasProposedReply(analysis);
  const important = ["high", "urgent"].includes(result.priority);
  const needsAleksander = result.requires_aleksander_response === true;
  if (!proposed && !needsAleksander && !important) {
    return { send: false, reason: "no_decision_needed", kind: "none" };
  }
  return {
    send: true,
    reason: "review_required",
    kind: proposed ? "proposal" : "aleksander_decision",
  };
}

export function notificationKeyForEntry(entry, repository) {
  const repo = String(repository ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo)) throw new Error("Invalid notification repository");
  const eventType = String(entry?.eventType ?? "");
  const nodeId = String(entry?.nodeId ?? "");
  if (!["discussion", "discussion_comment"].includes(eventType) || !/^[A-Za-z0-9_-]{8,200}$/.test(nodeId)) {
    throw new Error("A persistent notification key requires a GitHub Discussion node ID");
  }
  return createHash("sha256").update(`${repo}\n${eventType}\n${nodeId}`, "utf8").digest("hex");
}
