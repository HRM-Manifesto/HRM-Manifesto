import { approvalHash, approvalIsExpired, approvalMarker, readApprovalRecord } from "./approval-record.mjs";
import { looksLikeDecisionSubject, parseDecisionMessage } from "./approval-parser.mjs";
import { DEFAULT_MODEL } from "./config.mjs";
import { sendDecisionConfirmation } from "./email.mjs";
import { findApprovalMarker, publishDiscussionReply, resolveTarget } from "./github-discussions.mjs";
import { IMAP_FOLDERS } from "./imap-mailbox.mjs";
import { translateApprovedReply } from "./translate.mjs";

function safeEnvironment(environment) {
  const repository = String(environment.GITHUB_REPOSITORY ?? "");
  const notifyEmail = String(environment.HRM_NOTIFY_EMAIL ?? "").trim().toLowerCase();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GITHUB_REPOSITORY");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(notifyEmail)) throw new Error("Invalid HRM_NOTIFY_EMAIL");
  if (!environment.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");
  if (!environment.HRM_APPROVAL_SECRET) throw new Error("HRM_APPROVAL_SECRET is not configured");
  return { repository, notifyEmail };
}

async function movePair(mailbox, pendingUid, decisionUid, folder) {
  await mailbox.move(pendingUid, folder);
  await mailbox.move(decisionUid, folder);
}

export async function processApprovalMailbox({
  mailbox,
  environment = process.env,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  resolveTargetImpl = resolveTarget,
  translateImpl = translateApprovedReply,
  findMarkerImpl = findApprovalMarker,
  publishImpl = publishDiscussionReply,
  sendConfirmationImpl = sendDecisionConfirmation,
}) {
  const { repository, notifyEmail } = safeEnvironment(environment);
  const report = {
    published: 0,
    rejected: 0,
    expired: 0,
    duplicates: 0,
    invalid: 0,
    failures: 0,
    confirmationFailures: 0,
  };
  const pending = new Map();
  const ambiguousIds = new Set();

  for (const message of mailbox.messages) {
    if (!message.subject.startsWith("[HRM Forum] Review required")) continue;
    try {
      const record = readApprovalRecord({ text: message.text, secret: environment.HRM_APPROVAL_SECRET });
      if (record.repository.toLowerCase() !== repository.toLowerCase()) throw new Error("Approval repository mismatch");
      if (pending.has(record.approvalId)) {
        const prior = pending.get(record.approvalId);
        await mailbox.move(prior.message.uid, IMAP_FOLDERS.invalid);
        await mailbox.move(message.uid, IMAP_FOLDERS.invalid);
        report.invalid += 2;
        ambiguousIds.add(record.approvalId);
        pending.delete(record.approvalId);
      } else if (!ambiguousIds.has(record.approvalId)) {
        pending.set(record.approvalId, { message, record });
      }
    } catch {
      await mailbox.move(message.uid, IMAP_FOLDERS.invalid);
      report.invalid += 1;
    }
  }

  for (const message of mailbox.messages) {
    if (!looksLikeDecisionSubject(message.subject)) continue;
    let decision;
    try {
      decision = parseDecisionMessage({
        subject: message.subject,
        text: message.text,
        fromAddresses: message.fromAddresses,
        authorizedEmail: notifyEmail,
      });
    } catch {
      await mailbox.move(message.uid, IMAP_FOLDERS.invalid);
      report.invalid += 1;
      continue;
    }

    const item = pending.get(decision.approvalId);
    if (!item || ambiguousIds.has(decision.approvalId)) {
      await mailbox.move(message.uid, IMAP_FOLDERS.invalid);
      report.invalid += 1;
      continue;
    }
    pending.delete(decision.approvalId);

    if (approvalIsExpired(item.record, now)) {
      await movePair(mailbox, item.message.uid, message.uid, IMAP_FOLDERS.rejected);
      report.expired += 1;
      try {
        await sendConfirmationImpl({ outcome: { kind: "expired" }, environment });
      } catch {
        report.confirmationFailures += 1;
      }
      continue;
    }

    if (decision.kind === "reject") {
      await movePair(mailbox, item.message.uid, message.uid, IMAP_FOLDERS.rejected);
      report.rejected += 1;
      try {
        await sendConfirmationImpl({ outcome: { kind: "rejected" }, environment });
      } catch {
        report.confirmationFailures += 1;
      }
      continue;
    }

    const approvedPolishReply = decision.kind === "edit"
      ? decision.approvedPolishReply
      : item.record.proposedPolishReply;
    if (!approvedPolishReply.trim() || approvedPolishReply.includes(item.record.approvalId)) {
      await mailbox.move(message.uid, IMAP_FOLDERS.invalid);
      report.invalid += 1;
      continue;
    }

    try {
      const resolvedTarget = await resolveTargetImpl({
        target: item.record.target,
        repository,
        token: environment.GITHUB_TOKEN,
        fetchImpl,
      });
      const marker = approvalMarker(approvalHash(item.record.approvalId));
      const existing = await findMarkerImpl({
        discussionId: resolvedTarget.discussionId,
        marker,
        token: environment.GITHUB_TOKEN,
        fetchImpl,
      });
      if (existing.found) {
        await movePair(mailbox, item.message.uid, message.uid, IMAP_FOLDERS.processed);
        report.duplicates += 1;
        continue;
      }

      if (String(resolvedTarget.sourceBody ?? "").includes(item.record.approvalId)) {
        throw new Error("Forum source contained protected approval data");
      }

      const translation = await translateImpl({
        sourceBody: resolvedTarget.sourceBody,
        approvedPolishReply,
        apiKey: environment.OPENAI_API_KEY,
        model: environment.OPENAI_TRANSLATION_MODEL || environment.OPENAI_MODEL || DEFAULT_MODEL,
        fetchImpl,
      });
      if (translation.publishedReply.includes(item.record.approvalId)) {
        throw new Error("Translation contained protected approval data");
      }
      const publishedComment = await publishImpl({
        resolvedTarget,
        body: `${translation.publishedReply}\n\n${marker}`,
        token: environment.GITHUB_TOKEN,
        fetchImpl,
      });
      await movePair(mailbox, item.message.uid, message.uid, IMAP_FOLDERS.processed);
      report.published += 1;
      try {
        await sendConfirmationImpl({
          outcome: {
            kind: "published",
            publication: {
              discussionUrl: resolvedTarget.discussionUrl,
              originalLanguage: translation.originalLanguage,
              approvedPolishReply,
              publishedReply: translation.publishedReply,
              url: publishedComment.url,
            },
          },
          environment,
        });
      } catch {
        report.confirmationFailures += 1;
      }
    } catch {
      try {
        await movePair(mailbox, item.message.uid, message.uid, IMAP_FOLDERS.failed);
      } catch {
        // The public idempotency marker still prevents a duplicate if publication succeeded before a network failure.
      }
      report.failures += 1;
    }
  }

  return report;
}
