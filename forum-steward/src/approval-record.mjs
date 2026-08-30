import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APPROVAL_TTL_MS, MAX_APPROVED_REPLY_CHARS, MAX_TARGET_CHARS } from "./config.mjs";

export const APPROVAL_RECORD_BEGIN = "-----BEGIN HRM APPROVAL RECORD-----";
export const APPROVAL_RECORD_END = "-----END HRM APPROVAL RECORD-----";

function signingKey(secret) {
  const value = String(secret ?? "");
  if (value.length < 32 || value.length > 10_000 || /[\r\n\0]/.test(value)) {
    throw new Error("HRM_APPROVAL_SECRET is missing or too short");
  }
  return value;
}

function canonicalRepository(value) {
  const repository = String(value ?? "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid approval repository");
  }
  return repository;
}

function approvalTarget(entry) {
  const target = entry?.nodeId || (entry?.discussionNumber ? String(entry.discussionNumber) : "manual-test");
  if (!target || target.length > MAX_TARGET_CHARS || /[\r\n\0]/.test(target)) {
    throw new Error("Invalid approval target");
  }
  return target;
}

function signPayload(payload, secret) {
  return createHmac("sha256", signingKey(secret)).update(payload, "utf8").digest("hex");
}

function encodeRecord(record) {
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || ![1, 2].includes(record.v)) {
    throw new Error("Invalid approval record");
  }
  const expected = [
    "approvalId", "createdAt", "expiresAt", "proposedPolishReply", "repository", "target", "v",
  ];
  if (record.v === 2) expected.push("hasProposedReply");
  if (Object.keys(record).sort().join("|") !== expected.sort().join("|")) {
    throw new Error("Invalid approval record fields");
  }
  if (!/^[a-f0-9]{64}$/.test(record.approvalId)) throw new Error("Invalid approval identifier");
  canonicalRepository(record.repository);
  if (typeof record.target !== "string" || !record.target || record.target.length > MAX_TARGET_CHARS || /[\r\n\0]/.test(record.target)) {
    throw new Error("Invalid approval target");
  }
  if (
    typeof record.proposedPolishReply !== "string"
    || record.proposedPolishReply.length > MAX_APPROVED_REPLY_CHARS
  ) {
    throw new Error("Invalid proposed Polish reply");
  }
  const hasProposedReply = Boolean(record.proposedPolishReply.trim());
  if (record.v === 2 && (
    typeof record.hasProposedReply !== "boolean"
    || record.hasProposedReply !== hasProposedReply
  )) {
    throw new Error("Invalid proposed reply availability");
  }
  const createdAt = Date.parse(record.createdAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt || expiresAt - createdAt !== APPROVAL_TTL_MS) {
    throw new Error("Invalid approval validity period");
  }
  // Version 1 records remain usable; their flag is derived only from the signed reply field.
  return record.v === 1 ? { ...record, hasProposedReply } : record;
}

export function createApprovalRecord({
  entry,
  analysis,
  repository,
  secret,
  now = new Date(),
  randomBytesImpl = randomBytes,
}) {
  const entropy = randomBytesImpl(32);
  if (!Buffer.isBuffer(entropy) || entropy.length < 16) throw new Error("Approval entropy generation failed");
  const approvalId = entropy.toString("hex");
  const createdAt = new Date(now);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid approval creation time");
  const proposedPolishReply = String(analysis?.result?.proposed_reply_pl ?? "");
  const record = validateRecord({
    v: 2,
    approvalId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + APPROVAL_TTL_MS).toISOString(),
    repository: canonicalRepository(repository),
    target: approvalTarget(entry),
    proposedPolishReply,
    hasProposedReply: Boolean(proposedPolishReply.trim()),
  });
  const payload = encodeRecord(record);
  const signature = signPayload(payload, secret);
  const block = `${APPROVAL_RECORD_BEGIN}\n${payload}\n${signature}\n${APPROVAL_RECORD_END}`;
  return { approvalId, shortId: approvalId.slice(0, 12), record, block };
}

export function readApprovalRecord({ text, secret }) {
  const escapedBegin = APPROVAL_RECORD_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = APPROVAL_RECORD_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...String(text ?? "").matchAll(new RegExp(`${escapedBegin}\\r?\\n([A-Za-z0-9_-]+)\\r?\\n([a-f0-9]{64})\\r?\\n${escapedEnd}`, "g"))];
  if (matches.length !== 1) throw new Error("Missing or ambiguous signed approval record");
  const [, payload, suppliedSignature] = matches[0];
  const expectedSignature = signPayload(payload, secret);
  const supplied = Buffer.from(suppliedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid approval record signature");
  }
  let record;
  try {
    record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid approval record encoding");
  }
  return validateRecord(record);
}

export function approvalIsExpired(record, now = new Date()) {
  return new Date(now).getTime() > Date.parse(record.expiresAt);
}

export function approvalHash(approvalId) {
  if (!/^[a-f0-9]{64}$/.test(String(approvalId ?? ""))) throw new Error("Invalid approval identifier");
  return createHash("sha256").update(approvalId, "utf8").digest("hex");
}

export function approvalMarker(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash ?? ""))) throw new Error("Invalid approval hash");
  return `<!-- hrm-approval:${hash} -->`;
}
