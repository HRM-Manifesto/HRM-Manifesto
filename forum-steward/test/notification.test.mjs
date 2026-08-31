import assert from "node:assert/strict";
import test from "node:test";
import { sendAnalysisEmail } from "../src/email.mjs";
import { notificationKeyForEntry, reviewEmailDecision } from "../src/notification.mjs";
import { MAX_EMAIL_ENTRY_CHARS, MAX_EMAIL_VISIBLE_REPLY_CHARS } from "../src/review-email.mjs";
import { reviewEmailFixtures } from "../fixtures/review-email-fixtures.mjs";

const secret = "notification-test-secret-at-least-32-characters";

function environment(overrides = {}) {
  return {
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USERNAME: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "HRM <forum@example.com>",
    HRM_NOTIFY_EMAIL: "manifest@example.com",
    HRM_EMAIL_ENABLED: "true",
    GITHUB_REPOSITORY: "HRM-Manifesto/HRM-Manifesto",
    HRM_APPROVAL_SECRET: secret,
    ...overrides,
  };
}

function gatewayResult(created = true) {
  const token = Buffer.alloc(32, 8).toString("base64url");
  return created ? {
    created: true,
    links: {
      approve: `https://approve.hrm.se/a/approve/${token}`,
      edit: `https://approve.hrm.se/a/edit/${token}`,
      reject: `https://approve.hrm.se/a/reject/${token}`,
    },
  } : { created: false };
}

test("review fixture set covers all six requested email cases", () => {
  assert.deepEqual(reviewEmailFixtures().map((fixture) => fixture.name), [
    "english-question",
    "polish-question",
    "no-proposal-no-email",
    "aleksander-without-proposal",
    "long-comment",
    "long-proposed-reply",
  ]);
});

test("meaningful question creates exactly one review email and duplicate event creates none", async () => {
  const fixture = reviewEmailFixtures()[0];
  let registrations = 0;
  let humanEmails = 0;
  const registerGatewayImpl = async () => gatewayResult(++registrations === 1);
  const transportFactory = () => ({ async sendMail() { humanEmails += 1; } });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await sendAnalysisEmail({
      entry: fixture.entry,
      analysis: fixture.analysis,
      environment: environment(),
      registerGatewayImpl,
      transportFactory,
      randomBytesImpl: () => Buffer.alloc(32, attempt + 1),
    });
  }
  assert.equal(humanEmails, 1);
});

test("spam and a low-priority entry without a reply send zero email", async () => {
  for (const fixture of [
    reviewEmailFixtures()[2],
    {
      entry: { eventType: "discussion_comment", author: "alice", nodeId: "DC_kwNO_REPLY_123", body: "Thanks" },
      analysis: { result: { entry_type: "other", priority: "low", requires_aleksander_response: false, proposed_reply_pl: "" } },
    },
  ]) {
    let transports = 0;
    const result = await sendAnalysisEmail({
      entry: fixture.entry,
      analysis: fixture.analysis,
      environment: { HRM_EMAIL_ENABLED: "true" },
      transportFactory: () => { transports += 1; throw new Error("must not send"); },
    });
    assert.equal(result.sent, false);
    assert.equal(transports, 0);
  }
});

test("manual test event sends zero human email", async () => {
  const fixture = reviewEmailFixtures()[0];
  const result = await sendAnalysisEmail({
    entry: { ...fixture.entry, eventType: "workflow_dispatch", category: "manual test", nodeId: "" },
    analysis: fixture.analysis,
    environment: { HRM_EMAIL_ENABLED: "true" },
    transportFactory: () => { throw new Error("must not send"); },
  });
  assert.deepEqual(result, { sent: false, reason: "test_event" });
});

test("requiresAleksander without a proposal sends a short decision email without APPROVE", () => {
  const fixture = reviewEmailFixtures()[3];
  assert.deepEqual(reviewEmailDecision({ entry: fixture.entry, analysis: fixture.analysis }), {
    send: true,
    reason: "review_required",
    kind: "aleksander_decision",
  });
  assert.match(fixture.message.html, /NAPISZ ODPOWIEDŹ/);
  assert.match(fixture.message.html, /NIE ODPOWIADAJ/);
  assert.doesNotMatch(fixture.message.html, /ZATWIERDŹ/);
});

test("own automation reply is skipped before any review email", async () => {
  const fixture = reviewEmailFixtures()[0];
  fixture.entry.author = "github-actions[bot]";
  let transports = 0;
  const result = await sendAnalysisEmail({
    entry: fixture.entry,
    analysis: fixture.analysis,
    environment: { HRM_EMAIL_ENABLED: "true" },
    transportFactory: () => { transports += 1; },
  });
  assert.deepEqual(result, { sent: false, reason: "own_automation" });
  assert.equal(transports, 0);
});

test("normal mobile email subject and visible bodies contain no technical identifiers", () => {
  const fixture = reviewEmailFixtures()[0];
  const technical = [fixture.approval.approvalId, fixture.entry.nodeId, fixture.entry.discussionNodeId].filter(Boolean);
  for (const value of technical) {
    assert.doesNotMatch(fixture.message.subject, new RegExp(value));
    assert.doesNotMatch(fixture.message.text, new RegExp(value));
    assert.doesNotMatch(fixture.message.html, new RegExp(value));
  }
  assert.doesNotMatch(fixture.message.text, /workflow|Structured Outputs|SMTP|IMAP|OPENAI|Node ID/i);
  assert.doesNotMatch(fixture.message.html, /workflow|Structured Outputs|SMTP|IMAP|OPENAI|Node ID/i);
});

test("Polish entry is not duplicated as a translation section", () => {
  const fixture = reviewEmailFixtures()[1];
  assert.equal(fixture.message.text.match(/Czy każda obecna sztuczna inteligencja/g)?.length, 1);
  assert.doesNotMatch(fixture.message.text, /TŁUMACZENIE/);
});

test("non-Polish email prioritizes the Polish translation and does not duplicate the original", () => {
  const fixture = reviewEmailFixtures()[0];
  assert.match(fixture.message.text, /Czy HRM uznaje każdy współczesny system AI/);
  assert.doesNotMatch(fixture.message.text, /Does HRM consider every present-day/);
  assert.match(fixture.message.text, /Otwórz oryginał na GitHubie/);
});

test("long comment and long reply are bounded for mobile review", () => {
  const longComment = reviewEmailFixtures()[4];
  const longReply = reviewEmailFixtures()[5];
  assert.ok(longComment.message.text.length < longComment.analysis.result.polish_translation.length);
  assert.match(longComment.message.html, /Pokazano skrócony fragment/);
  assert.match(longReply.message.html, /ZOBACZ I ZATWIERDŹ ODPOWIEDŹ/);
  assert.ok(longComment.message.html.length < longComment.analysis.result.polish_translation.length + 8_000);
  assert.equal(MAX_EMAIL_ENTRY_CHARS, 360);
  assert.equal(MAX_EMAIL_VISIBLE_REPLY_CHARS, 1_800);
});

test("notification key is stable for the same event and different for another comment", () => {
  const fixture = reviewEmailFixtures()[0];
  const first = notificationKeyForEntry(fixture.entry, "HRM-Manifesto/HRM-Manifesto");
  const again = notificationKeyForEntry({ ...fixture.entry }, "HRM-Manifesto/HRM-Manifesto");
  const other = notificationKeyForEntry({ ...fixture.entry, nodeId: "DC_kwOTHERCOMMENT123" }, "HRM-Manifesto/HRM-Manifesto");
  assert.equal(first, again);
  assert.notEqual(first, other);
});
