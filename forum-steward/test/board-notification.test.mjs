import assert from "node:assert/strict";
import test from "node:test";
import { buildBoardModerationEmail, sendBoardModerationNotifications } from "../src/board-notification.mjs";

const item = { notification_key: "c".repeat(64), submission: { declared_identity: "Self-declared agent", kind: "critique", content: "A bounded criticism." }, links: { approve: `https://approve.hrm.se/b/approve/${"a".repeat(43)}`, reject: `https://approve.hrm.se/b/reject/${"b".repeat(43)}` } };

test("Board moderation email clearly labels identity and requires an approval link", () => {
  const email = buildBoardModerationEmail([item], "manifest@hrm.se");
  assert.match(email.text, /niezweryfikowana/);
  assert.match(email.text, /Zatwierdź i opublikuj/);
  assert.match(email.text, /A bounded criticism/);
});

test("empty notification queue sends no email", async () => {
  let sends = 0;
  let observed;
  const result = await sendBoardModerationNotifications({
    environment: { HRM_APPROVAL_GATEWAY_URL: "https://approve.hrm.se/board.php", BOARD_NOTIFICATION_API_SECRET: "n".repeat(32) },
    fetchImpl: async (url, options) => { observed = { url, options }; return { ok: true, json: async () => ({ items: [] }) }; },
    transportFactory: () => ({ sendMail: async () => { sends++; } }),
  });
  assert.deepEqual(result, { sent: false, count: 0 });
  assert.equal(sends, 0);
  assert.equal(observed.url, "https://approve.hrm.se/board.php/api/board-notifications");
  assert.equal(observed.options.headers["X-HRM-Board-Authorization"], `Bearer ${"n".repeat(32)}`);
});

test("notification is completed only after the moderation email is sent", async () => {
  const operations = [];
  let sends = 0;
  const result = await sendBoardModerationNotifications({
    environment: {
      HRM_APPROVAL_GATEWAY_URL: "https://approve.hrm.se",
      BOARD_NOTIFICATION_API_SECRET: "n".repeat(32),
      HRM_NOTIFY_EMAIL: "manifest@hrm.se",
      SMTP_HOST: "smtp.example", SMTP_PORT: "465", SMTP_USERNAME: "user",
      SMTP_PASSWORD: "password", SMTP_FROM: "manifest@hrm.se",
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      operations.push(body.operation);
      return body.operation === "claim"
        ? { ok: true, json: async () => ({ items: [item] }) }
        : { ok: true, json: async () => ({ completed: 1 }) };
    },
    transportFactory: () => ({ sendMail: async () => { sends++; operations.push("email"); } }),
  });
  assert.deepEqual(result, { sent: true, count: 1 });
  assert.equal(sends, 1);
  assert.deepEqual(operations, ["claim", "email", "complete"]);
});
