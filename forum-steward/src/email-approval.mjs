import { approvalIsExpired, readApprovalRecord } from "./approval-record.mjs";
import { looksLikeDecisionSubject, parseDecisionMessage } from "./approval-parser.mjs";
import { executeApprovedReply } from "./approval-publication.mjs";
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
  executeApprovedReplyImpl = executeApprovedReply,
  sendConfirmationImpl = sendDecisionConfirmation,
}) {
  const { repository, notifyEmail } = safeEnvironment(environment);
  const folders = mailbox.folders ?? IMAP_FOLDERS;
  const confirmationEmails = String(environment.HRM_CONFIRMATION_EMAILS ?? "false").toLowerCase() === "true";
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
    if (!message.subject.startsWith("[HRM Forum] Review required")
      && !message.subject.startsWith("[HRM] Odpowiedź do zatwierdzenia")
      && !message.subject.startsWith("[HRM] Potrzebna Twoja decyzja")) continue;
    try {
      const record = readApprovalRecord({
        text: message.approvalRecord || message.text,
        secret: environment.HRM_APPROVAL_SECRET,
      });
      if (record.repository.toLowerCase() !== repository.toLowerCase()) throw new Error("Approval repository mismatch");
      if (pending.has(record.approvalId)) {
        const prior = pending.get(record.approvalId);
        await mailbox.move(prior.message.uid, folders.invalid);
        await mailbox.move(message.uid, folders.invalid);
        report.invalid += 2;
        ambiguousIds.add(record.approvalId);
        pending.delete(record.approvalId);
      } else if (!ambiguousIds.has(record.approvalId)) {
        pending.set(record.approvalId, { message, record });
      }
    } catch {
      await mailbox.move(message.uid, folders.invalid);
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
      await mailbox.move(message.uid, folders.invalid);
      report.invalid += 1;
      continue;
    }

    const item = pending.get(decision.approvalId);
    if (!item || ambiguousIds.has(decision.approvalId)) {
      await mailbox.move(message.uid, folders.invalid);
      report.invalid += 1;
      continue;
    }
    pending.delete(decision.approvalId);

    if (approvalIsExpired(item.record, now)) {
      await movePair(mailbox, item.message.uid, message.uid, folders.rejected);
      report.expired += 1;
      if (confirmationEmails) {
        try {
          await sendConfirmationImpl({ outcome: { kind: "expired" }, environment });
        } catch {
          report.confirmationFailures += 1;
        }
      }
      continue;
    }

    if (decision.kind === "reject") {
      await movePair(mailbox, item.message.uid, message.uid, folders.rejected);
      report.rejected += 1;
      if (confirmationEmails) {
        try {
          await sendConfirmationImpl({ outcome: { kind: "rejected" }, environment });
        } catch {
          report.confirmationFailures += 1;
        }
      }
      continue;
    }

    if (decision.kind === "approve" && !item.record.hasProposedReply) {
      await movePair(mailbox, item.message.uid, message.uid, folders.invalid);
      report.invalid += 1;
      continue;
    }

    const approvedPolishReply = decision.kind === "edit"
      ? decision.approvedPolishReply
      : item.record.proposedPolishReply;
    if (!approvedPolishReply.trim() || approvedPolishReply.includes(item.record.approvalId)) {
      await mailbox.move(message.uid, folders.invalid);
      report.invalid += 1;
      continue;
    }

    try {
      const outcome = await executeApprovedReplyImpl({
        record: item.record,
        approvedPolishReply,
        environment,
        fetchImpl,
        resolveTargetImpl,
        translateImpl,
        findMarkerImpl,
        publishImpl,
      });
      if (outcome.kind === "already_published") {
        await movePair(mailbox, item.message.uid, message.uid, folders.processed);
        report.duplicates += 1;
        continue;
      }
      await movePair(mailbox, item.message.uid, message.uid, folders.processed);
      report.published += 1;
      if (confirmationEmails) {
        try {
          await sendConfirmationImpl({ outcome, environment });
        } catch {
          report.confirmationFailures += 1;
        }
      }
    } catch (error) {
      if (error?.category === "MOVE") throw error;
      try {
        await movePair(mailbox, item.message.uid, message.uid, folders.failed);
      } catch (moveError) {
        if (moveError?.category === "MOVE") throw moveError;
        // The public idempotency marker still prevents a duplicate if publication succeeded before a network failure.
      }
      report.failures += 1;
    }
  }

  return report;
}
