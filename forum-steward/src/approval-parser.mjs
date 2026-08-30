import { MAX_APPROVED_REPLY_CHARS } from "./config.mjs";

const SUBJECT_PATTERN = /^HRM (APPROVE|REJECT|EDIT) ([a-f0-9]{64})$/;

function canonicalAddress(value) {
  const address = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error("Invalid authorized email address");
  return address;
}

function normalizeBody(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function looksLikeDecisionSubject(subject) {
  return /^HRM (?:APPROVE|REJECT|EDIT)(?:\s|$)/.test(String(subject ?? ""));
}

export function parseDecisionMessage({ subject, text, fromAddresses, authorizedEmail }) {
  const match = String(subject ?? "").match(SUBJECT_PATTERN);
  if (!match) throw new Error("Invalid approval decision subject");
  const authorized = canonicalAddress(authorizedEmail);
  const senders = Array.isArray(fromAddresses)
    ? fromAddresses.map((value) => canonicalAddress(value))
    : [];
  if (senders.length !== 1 || senders[0] !== authorized) {
    throw new Error("Decision sender is not authorized");
  }

  const [, command, approvalId] = match;
  const body = normalizeBody(text);
  if (command === "APPROVE") {
    if (body !== "ZATWIERDZAM") throw new Error("Invalid approval command body");
    return { kind: "approve", approvalId };
  }
  if (command === "REJECT") {
    if (body !== "NIE ODPOWIADAJ") throw new Error("Invalid rejection command body");
    return { kind: "reject", approvalId };
  }

  const edit = body.match(/^POPRAWIAM\n---ODPOWIEDŹ---\n([\s\S]+)\n---KONIEC---$/);
  if (!edit) throw new Error("Invalid edited-reply format");
  const approvedPolishReply = edit[1];
  if (!approvedPolishReply.trim() || approvedPolishReply.length > MAX_APPROVED_REPLY_CHARS) {
    throw new Error("Edited reply is empty or too long");
  }
  return { kind: "edit", approvalId, approvedPolishReply };
}
