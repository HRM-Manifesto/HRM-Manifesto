import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalRecord } from "../src/approval-record.mjs";
import { createApprovalGateway, MemoryGatewayStore } from "../src/approval-gateway.mjs";
import { sendAnalysisEmail } from "../src/email.mjs";
import { registerGatewayCase } from "../src/gateway-client.mjs";

const approvalSecret = "gateway-test-approval-secret-32-characters";
const sharedSecret = "gateway-test-shared-secret-32-characters";
const csrfSecret = "gateway-test-csrf-secret-at-least-32-chars";
const baseUrl = "https://approve.hrm.se";
const now = new Date("2026-08-30T12:00:00Z");

function approval({ proposed = "Zatwierdzona odpowiedź po polsku.", createdAt = now, repository = "HRM-Manifesto/HRM-Manifesto" } = {}) {
  return createApprovalRecord({
    entry: { nodeId: "DC_kwGATEWAYTARGET123", discussionNumber: 12 },
    analysis: { result: { proposed_reply_pl: proposed } },
    repository,
    secret: approvalSecret,
    now: createdAt,
    randomBytesImpl: () => Buffer.alloc(32, 3),
  });
}

function setup({ created = approval(), executor } = {}) {
  const store = new MemoryGatewayStore({ randomBytesImpl: () => Buffer.alloc(32, 9) });
  const calls = { execute: 0, approved: [] };
  const executeApprovedReplyImpl = executor ?? (async ({ approvedPolishReply }) => {
    calls.execute += 1;
    calls.approved.push(approvedPolishReply);
    return {
      kind: "published",
      publication: {
        discussionUrl: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12",
        url: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12#discussioncomment-1",
      },
    };
  });
  const handle = createApprovalGateway({
    store,
    approvalSecret,
    sharedSecret,
    csrfSecret,
    publicBaseUrl: baseUrl,
    repository: "HRM-Manifesto/HRM-Manifesto",
    executeApprovedReplyImpl,
    nowImpl: () => now,
    randomBytesImpl: () => Buffer.alloc(18, 4),
  });
  return { store, calls, handle, created };
}

async function register(handle, created = approval(), key = "a".repeat(64)) {
  const response = await handle(new Request(`${baseUrl}/api/cases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sharedSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notification_key: key,
      approval_record: Buffer.from(created.block, "utf8").toString("base64url"),
    }),
  }));
  return { response, payload: await response.json() };
}

async function confirmation(handle, actionUrl) {
  const page = await handle(new Request(actionUrl));
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  const setCookies = typeof page.headers.getSetCookie === "function"
    ? page.headers.getSetCookie()
    : [page.headers.get("set-cookie")];
  const cookie = setCookies.filter(Boolean).map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(csrf);
  assert.ok(cookie);
  return { csrf, cookie, html };
}

async function decide(handle, actionUrl, { csrf, cookie, reply } = {}) {
  const action = new URL(actionUrl).pathname.split("/")[2];
  const body = new URLSearchParams({ csrf });
  if (reply !== undefined) body.set("reply", reply);
  return handle(new Request(`${baseUrl}/decision/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Origin: baseUrl,
    },
    body,
  }));
}

test("gateway creates a separate 256-bit capability token and deduplicates notification keys", async () => {
  const { handle, created } = setup();
  const first = await register(handle, created);
  assert.equal(first.response.status, 201);
  const token = new URL(first.payload.links.approve).pathname.split("/").at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, created.approvalId);
  const duplicate = await register(handle, created);
  assert.deepEqual(duplicate.payload, { created: false });
});

test("gateway rejects a signed case for another repository", async () => {
  const foreign = approval({ repository: "Other/Repository" });
  const { handle } = setup({ created: foreign });
  const result = await register(handle, foreign);
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.payload, { error: "invalid_case" });
});

test("scanner GET, HEAD and prefetch perform zero persistent state changes", async () => {
  const { handle, store, created } = setup();
  const registered = await register(handle, created);
  const mutations = store.mutationCount;
  assert.equal((await handle(new Request(registered.payload.links.approve))).status, 200);
  assert.equal((await handle(new Request(registered.payload.links.approve, { method: "HEAD" }))).status, 200);
  assert.equal((await handle(new Request(registered.payload.links.approve, { headers: { Purpose: "prefetch" } }))).status, 204);
  assert.equal(store.mutationCount, mutations);
});

test("approve requires a POST and the capability token is single-use", async () => {
  const { handle, calls, created } = setup();
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.approve);
  const first = await decide(handle, registered.payload.links.approve, form);
  assert.equal(first.status, 200);
  assert.equal(calls.execute, 1);
  const replay = await decide(handle, registered.payload.links.approve, form);
  assert.equal(replay.status, 409);
  assert.equal(calls.execute, 1);
});

test("concurrent double POST has exactly one winner", async () => {
  const { handle, calls, created } = setup();
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.approve);
  const [first, second] = await Promise.all([
    decide(handle, registered.payload.links.approve, form),
    decide(handle, registered.payload.links.approve, form),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(calls.execute, 1);
});

test("expired gateway token is denied without publication", async () => {
  const expired = approval({ createdAt: new Date("2026-08-01T00:00:00Z") });
  const { handle, calls } = setup({ created: expired });
  const registered = await register(handle, expired);
  const response = await handle(new Request(registered.payload.links.approve));
  assert.equal(response.status, 410);
  assert.equal(calls.execute, 0);
});

test("edit preserves Aleksander's exact Polish text", async () => {
  const { handle, calls, created } = setup();
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.edit);
  const exact = "Pierwszy wiersz.\n\nDrugi wiersz — dokładnie tak.";
  const response = await decide(handle, registered.payload.links.edit, { ...form, reply: exact });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.approved, [exact]);
});

test("reject closes the case without OpenAI or publication", async () => {
  const { handle, calls, created } = setup();
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.reject);
  const response = await decide(handle, registered.payload.links.reject, form);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Odpowiedź nie została opublikowana/);
  assert.equal(calls.execute, 0);
});

test("gateway executor failure fails closed and cannot be replayed", async () => {
  let calls = 0;
  const { handle, created } = setup({ executor: async () => { calls += 1; throw new Error("GitHub unavailable"); } });
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.approve);
  assert.equal((await decide(handle, registered.payload.links.approve, form)).status, 502);
  assert.equal((await decide(handle, registered.payload.links.approve, form)).status, 409);
  assert.equal(calls, 1);
});

test("missing proposal has no usable approve page", async () => {
  const created = approval({ proposed: "" });
  const { handle, calls } = setup({ created });
  const registered = await register(handle, created);
  assert.equal((await handle(new Request(registered.payload.links.approve))).status, 409);
  assert.equal(calls.execute, 0);
});

test("approval page displays the complete long proposal before POST", async () => {
  const proposed = `${"Długi fragment odpowiedzi. ".repeat(90)}KONIEC PEŁNEJ ODPOWIEDZI`;
  const created = approval({ proposed });
  const { handle } = setup({ created });
  const registered = await register(handle, created);
  const form = await confirmation(handle, registered.payload.links.approve);
  assert.match(form.html, /KONIEC PEŁNEJ ODPOWIEDZI/);
  const token = new URL(registered.payload.links.approve).pathname.split("/").at(-1);
  assert.doesNotMatch(form.html, new RegExp(token));
  assert.doesNotMatch(form.html, /Approval ID|node ID|SHA|workflow/i);
});

test("quiet mailbox full scenario leaves exactly one human email", async () => {
  const { handle, calls } = setup();
  const entry = {
    eventType: "discussion_comment",
    title: "Question",
    body: "Does HRM consider every AI a subject?",
    author: "alice",
    url: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12#discussioncomment-1",
    nodeId: "DC_kwQUIETMAILBOX123",
    discussionNumber: 12,
    discussionUrl: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12",
    category: "Q&A",
  };
  const analysis = {
    bodyInfo: { body: entry.body, originalLength: entry.body.length, truncated: false },
    result: {
      original_language: "en",
      polish_translation: "Czy HRM uznaje każdą AI za podmiot?",
      summary_pl: "Pytanie o podmiotowość.",
      entry_type: "question",
      priority: "normal",
      requires_aleksander_response: false,
      relevant_sources: [{ path: "README.md", section: "What is HRM?", relevance: "Bezpośrednio." }],
      support_level: "direct",
      requires_new_position: false,
      proposed_reply_pl: "Nie. HRM nie uznaje automatycznie każdej AI za podmiot.",
      confidence: 0.98,
      interpretation_warning: false,
      interpretation_warning_reason: "",
    },
  };
  const gatewayEnvironment = {
    GITHUB_REPOSITORY: "HRM-Manifesto/HRM-Manifesto",
    HRM_APPROVAL_GATEWAY_URL: baseUrl,
    HRM_GATEWAY_SHARED_SECRET: sharedSecret,
    HRM_APPROVAL_SECRET: approvalSecret,
    HRM_NOTIFY_EMAIL: "manifest@example.com",
    HRM_EMAIL_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USERNAME: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "HRM <forum@example.com>",
  };
  let humanEmails = 0;
  let reviewMessage;
  await sendAnalysisEmail({
    entry,
    analysis,
    environment: gatewayEnvironment,
    transportFactory: () => ({ async sendMail(message) { humanEmails += 1; reviewMessage = message; } }),
    registerGatewayImpl: (args) => registerGatewayCase({
      ...args,
      fetchImpl: (url, options) => handle(new Request(url, options)),
    }),
    randomBytesImpl: () => Buffer.alloc(32, 2),
  });
  const approveUrl = reviewMessage.html.match(/href="(https:\/\/approve\.hrm\.se\/a\/approve\/[A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(approveUrl);
  const form = await confirmation(handle, approveUrl);
  assert.equal((await decide(handle, approveUrl, form)).status, 200);
  assert.equal(calls.execute, 1);
  assert.equal(humanEmails, 1);
});
