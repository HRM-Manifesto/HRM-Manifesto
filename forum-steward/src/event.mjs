import { readFile } from "node:fs/promises";

function text(value) {
  return typeof value === "string" ? value : "";
}

export function entryFromEvent(eventName, payload) {
  if (eventName === "discussion") {
    return {
      eventType: "discussion",
      title: text(payload.discussion?.title),
      body: text(payload.discussion?.body),
      author: text(payload.discussion?.user?.login),
      url: text(payload.discussion?.html_url),
      nodeId: text(payload.discussion?.node_id),
      discussionNodeId: text(payload.discussion?.node_id),
      discussionNumber: Number.isInteger(payload.discussion?.number) ? payload.discussion.number : null,
      discussionUrl: text(payload.discussion?.html_url),
      category: text(payload.discussion?.category?.name),
    };
  }

  if (eventName === "discussion_comment") {
    return {
      eventType: "discussion_comment",
      title: text(payload.discussion?.title),
      body: text(payload.comment?.body),
      author: text(payload.comment?.user?.login),
      url: text(payload.comment?.html_url),
      nodeId: text(payload.comment?.node_id),
      discussionNodeId: text(payload.discussion?.node_id),
      discussionNumber: Number.isInteger(payload.discussion?.number) ? payload.discussion.number : null,
      discussionUrl: text(payload.discussion?.html_url),
      category: text(payload.discussion?.category?.name),
    };
  }

  if (eventName === "workflow_dispatch") {
    const inputs = payload.inputs ?? {};
    return {
      eventType: "workflow_dispatch",
      title: text(inputs.title) || "Manual test",
      body: text(inputs.content),
      author: text(inputs.author) || "workflow_dispatch",
      url: "",
      nodeId: "",
      discussionNodeId: "",
      discussionNumber: null,
      discussionUrl: "",
      category: "manual test",
    };
  }

  throw new Error(`Unsupported event: ${eventName || "(empty)"}`);
}

export async function loadEntryFromEnvironment(environment = process.env) {
  const eventPath = environment.GITHUB_EVENT_PATH;
  const eventName = environment.GITHUB_EVENT_NAME;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  const payload = JSON.parse(await readFile(eventPath, "utf8"));
  return entryFromEvent(eventName, payload);
}
