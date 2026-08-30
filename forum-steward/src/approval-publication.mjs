import { approvalHash, approvalMarker } from "./approval-record.mjs";
import { DEFAULT_MODEL } from "./config.mjs";
import { findApprovalMarker, publishDiscussionReply, resolveTarget } from "./github-discussions.mjs";
import { translateApprovedReply } from "./translate.mjs";

export async function executeApprovedReply({
  record,
  approvedPolishReply,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  resolveTargetImpl = resolveTarget,
  translateImpl = translateApprovedReply,
  findMarkerImpl = findApprovalMarker,
  publishImpl = publishDiscussionReply,
}) {
  const repository = String(environment.GITHUB_REPOSITORY ?? "");
  const approved = String(approvedPolishReply ?? "");
  if (!approved.trim() || approved.includes(record.approvalId)) throw new Error("Invalid approved Polish reply");

  const resolvedTarget = await resolveTargetImpl({
    target: record.target,
    repository,
    token: environment.GITHUB_TOKEN,
    fetchImpl,
  });
  const marker = approvalMarker(approvalHash(record.approvalId));
  const existing = await findMarkerImpl({
    discussionId: resolvedTarget.discussionId,
    marker,
    token: environment.GITHUB_TOKEN,
    fetchImpl,
  });
  if (existing.found) {
    return {
      kind: "already_published",
      publication: { discussionUrl: resolvedTarget.discussionUrl, url: existing.url },
    };
  }
  if (String(resolvedTarget.sourceBody ?? "").includes(record.approvalId)) {
    throw new Error("Forum source contained protected approval data");
  }
  const translation = await translateImpl({
    sourceBody: resolvedTarget.sourceBody,
    approvedPolishReply: approved,
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_TRANSLATION_MODEL || environment.OPENAI_MODEL || DEFAULT_MODEL,
    fetchImpl,
  });
  if (translation.publishedReply.includes(record.approvalId)) {
    throw new Error("Translation contained protected approval data");
  }
  const publishedComment = await publishImpl({
    resolvedTarget,
    body: `${translation.publishedReply}\n\n${marker}`,
    token: environment.GITHUB_TOKEN,
    fetchImpl,
  });
  return {
    kind: "published",
    publication: {
      discussionUrl: resolvedTarget.discussionUrl,
      originalLanguage: translation.originalLanguage,
      approvedPolishReply: approved,
      publishedReply: translation.publishedReply,
      url: publishedComment.url,
    },
  };
}
