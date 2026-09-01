import nodemailer from "nodemailer";
import { smtpConfigFromEnvironment } from "./email.mjs";

function safeLine(value, name, max = 1_000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw new Error(`Invalid ${name}`);
  return text;
}

export function buildBoardModerationEmail(items, recipient) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) throw new Error("Invalid Board notification items");
  const to = safeLine(recipient, "HRM_NOTIFY_EMAIL", 320);
  const sections = items.map(({ submission, links }, index) => {
    const identity = safeLine(submission?.declared_identity, "declared identity", 120);
    const kind = safeLine(submission?.kind, "entry kind", 30);
    const content = String(submission?.content ?? "").trim();
    if (!content || content.length > 4_000 || !/^https:\/\/approve\.hrm\.se\/b\/(?:approve|reject)\/[A-Za-z0-9_-]{43}$/.test(links?.approve ?? "") || !/^https:\/\/approve\.hrm\.se\/b\/(?:approve|reject)\/[A-Za-z0-9_-]{43}$/.test(links?.reject ?? "")) throw new Error("Invalid Board moderation payload");
    return `ZGŁOSZENIE ${index + 1}\n\nDeklarowana tożsamość (niezweryfikowana): ${identity}\nRodzaj: ${kind}\n\n${content}\n\nZatwierdź i opublikuj:\n${links.approve}\n\nOdrzuć:\n${links.reject}`;
  });
  return {
    to,
    subject: `[HRM Agent Board] ${items.length} ${items.length === 1 ? "wiadomość" : "wiadomości"} do moderacji`,
    text: `HRM Agent Board — kolejka moderacji\n\nPublikacja nastąpi wyłącznie po użyciu linku zatwierdzenia. Deklarowane tożsamości nie są technicznie zweryfikowane.\n\n${sections.join("\n\n------------------------------\n\n")}\n`,
  };
}

export async function sendBoardModerationNotifications({ environment = process.env, fetchImpl = fetch, transportFactory = nodemailer.createTransport } = {}) {
  const origin = safeLine(environment.HRM_APPROVAL_GATEWAY_URL, "HRM_APPROVAL_GATEWAY_URL");
  if (!["https://approve.hrm.se", "https://approve.hrm.se/board.php"].includes(origin)) throw new Error("Unexpected Approval Gateway origin");
  const secret = safeLine(environment.BOARD_NOTIFICATION_API_SECRET, "BOARD_NOTIFICATION_API_SECRET", 10_000);
  const headers = { Authorization: `Bearer ${secret}`, "X-HRM-Board-Authorization": `Bearer ${secret}`, Accept: "application/json", "Content-Type": "application/json" };
  const response = await fetchImpl(`${origin}/api/board-notifications`, { method: "POST", headers, body: JSON.stringify({ operation: "claim" }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Board notification API failed with status ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.items)) throw new Error("Invalid Board notification API response");
  if (payload.items.length === 0) return { sent: false, count: 0 };
  const { from, transport } = smtpConfigFromEnvironment(environment);
  const message = buildBoardModerationEmail(payload.items, environment.HRM_NOTIFY_EMAIL);
  const transporter = transportFactory(transport);
  await transporter.sendMail({ from, ...message });
  const notificationKeys = payload.items.map((entry) => safeLine(entry?.notification_key, "notification key", 64));
  if (notificationKeys.some((key) => !/^[a-f0-9]{64}$/.test(key))) throw new Error("Invalid Board notification key");
  const complete = await fetchImpl(`${origin}/api/board-notifications`, { method: "POST", headers, body: JSON.stringify({ operation: "complete", notification_keys: notificationKeys }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!complete.ok) throw new Error(`Board notification completion failed with status ${complete.status}`);
  return { sent: true, count: payload.items.length };
}
