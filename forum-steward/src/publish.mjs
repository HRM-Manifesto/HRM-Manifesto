import { readFile } from "node:fs/promises";
import { DEFAULT_MODEL, MAX_APPROVED_REPLY_CHARS } from "./config.mjs";
import { parseTarget, publishDiscussionReply, resolveTarget } from "./github-discussions.mjs";
import { translateApprovedReply } from "./translate.mjs";

export async function loadPublishInputs(environment = process.env) {
  if (environment.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw new Error("Publishing is allowed only through workflow_dispatch");
  }
  if (!environment.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is required");
  const payload = JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, "utf8"));
  const inputs = payload.inputs ?? {};
  return {
    target: typeof inputs.target === "string" ? inputs.target : "",
    approvedPolishReply: typeof inputs.approved_polish_reply === "string" ? inputs.approved_polish_reply : "",
    confirmation: typeof inputs.confirmation === "string" ? inputs.confirmation : "",
  };
}

export async function runPublishApprovedReply({
  inputs,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  resolveTargetImpl = resolveTarget,
  translateImpl = translateApprovedReply,
  publishImpl = publishDiscussionReply,
}) {
  if (inputs.confirmation !== "PUBLISH") {
    return {
      published: false,
      reason: "Confirmation must be exactly PUBLISH. No API or publication action was performed.",
      apiCalls: 0,
    };
  }
  const approved = String(inputs.approvedPolishReply ?? "");
  if (!approved.trim() || approved.length > MAX_APPROVED_REPLY_CHARS) {
    throw new Error("Approved Polish reply is empty or too long");
  }
  parseTarget(inputs.target, environment.GITHUB_REPOSITORY);

  const resolvedTarget = await resolveTargetImpl({
    target: inputs.target,
    repository: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN,
    fetchImpl,
  });
  const translation = await translateImpl({
    sourceBody: resolvedTarget.sourceBody,
    approvedPolishReply: approved,
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_TRANSLATION_MODEL || environment.OPENAI_MODEL || DEFAULT_MODEL,
    fetchImpl,
  });
  const publishedComment = await publishImpl({
    resolvedTarget,
    body: translation.publishedReply,
    token: environment.GITHUB_TOKEN,
    fetchImpl,
  });

  return {
    published: true,
    reason: "Published after explicit manual approval.",
    target: resolvedTarget,
    originalLanguage: translation.originalLanguage,
    languageName: translation.languageName,
    translationConfidence: translation.confidence,
    approvedPolishReply: approved,
    publishedReply: translation.publishedReply,
    publishedComment,
    apiCalls: translation.apiCalls,
  };
}
