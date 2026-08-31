import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MAX_APPROVED_REPLY_CHARS } from "./config.mjs";
import { readApprovalRecord } from "./approval-record.mjs";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NOTIFICATION_KEY_PATTERN = /^[a-f0-9]{64}$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenHash(token) {
  if (!TOKEN_PATTERN.test(String(token ?? ""))) throw new Error("Invalid gateway token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Gateway public URL must be HTTPS");
  }
  if (url.pathname !== "/") throw new Error("Gateway public URL must use the origin root");
  return url;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function securityHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function page(title, content) {
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — HRM</title></head>
<body style="margin:0;background:#f4f1ea;color:#17211d;font-family:Arial,sans-serif;font-size:16px;line-height:1.55">
<main style="box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;padding:24px 16px 40px">
<p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:.08em">HRM</p>
${content}
</main></body></html>`;
}

function button(label, color = "#185b43") {
  return `<button type="submit" style="box-sizing:border-box;width:100%;min-height:52px;margin:12px 0 0;padding:13px 18px;border:2px solid #0f2f25;border-radius:6px;background:${color};color:#fff;font:700 16px/1.25 Arial,sans-serif;cursor:pointer">${escapeHtml(label)}</button>`;
}

function csrfValue({ token, action, secret, now, randomBytesImpl }) {
  const nonce = randomBytesImpl(18).toString("base64url");
  const expires = Math.floor(now.getTime() / 1000) + 15 * 60;
  const payload = `${nonce}.${expires}.${action}.${tokenHash(token)}`;
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
  return `${nonce}.${expires}.${signature}`;
}

function verifyCsrf({ supplied, cookie, token, action, secret, now }) {
  if (!supplied || !cookie || !secureEqual(supplied, cookie)) return false;
  const parts = String(supplied).split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]{24}$/.test(parts[0]) || !/^\d{10}$/.test(parts[1])) return false;
  const expires = Number(parts[1]);
  if (expires < Math.floor(now.getTime() / 1000)) return false;
  const payload = `${parts[0]}.${expires}.${action}.${tokenHash(token)}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
  return secureEqual(parts[2], expected);
}

function cookieValue(request, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1] ?? "";
}

function actionPage({ action, record, csrf }) {
  const proposed = record.proposedPolishReply;
  let title;
  let detail;
  let label;
  let color;
  if (action === "approve") {
    title = "Zatwierdź i opublikuj";
    detail = `<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">${title}</h1>
<p style="margin:0 0 10px">Przeczytaj pełną odpowiedź przed publikacją:</p>
<div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #a9b8b0;border-radius:6px;background:#fff">${escapeHtml(proposed)}</div>`;
    label = "ZATWIERDŹ I OPUBLIKUJ";
    color = "#185b43";
  } else if (action === "edit") {
    title = proposed.trim() ? "Popraw odpowiedź" : "Napisz odpowiedź";
    detail = `<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">${title}</h1>
<label for="reply" style="display:block;font-weight:700;margin-bottom:8px">Pełny tekst po polsku</label>
<textarea id="reply" name="reply" maxlength="${MAX_APPROVED_REPLY_CHARS}" required style="box-sizing:border-box;width:100%;min-height:280px;padding:14px;border:1px solid #60756b;border-radius:6px;background:#fff;color:#17211d;font:16px/1.5 Arial,sans-serif">${escapeHtml(proposed)}</textarea>`;
    label = "OPUBLIKUJ";
    color = "#185b43";
  } else {
    title = "Nie odpowiadaj";
    detail = `<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">${title}</h1>
<p>Ta decyzja zamknie sprawę bez publikacji i bez użycia OpenAI.</p>`;
    label = "ZAMKNIJ BEZ ODPOWIEDZI";
    color = "#742c35";
  }
  return page(title, `${detail}
<form method="post" action="/decision/${action}" style="margin-top:18px">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${button(label, color)}
</form>
<p style="margin-top:18px"><a href="https://www.hrm.se/" style="display:inline-block;min-height:44px;line-height:44px;color:#164b3a">ANULUJ</a></p>`);
}

function resultPage(kind, discussionUrl = "") {
  if (kind === "rejected") {
    return page("Sprawa zamknięta", "<h1 style=\"font-size:22px\">Sprawa zamknięta.</h1><p>Odpowiedź nie została opublikowana.</p>");
  }
  const link = discussionUrl
    ? `<p><a href="${escapeHtml(discussionUrl)}" style="display:block;box-sizing:border-box;min-height:52px;padding:13px 18px;border:2px solid #0f2f25;border-radius:6px;color:#164b3a;font-weight:700;text-align:center;text-decoration:none">OTWÓRZ DYSKUSJĘ</a></p>`
    : "";
  return page("Odpowiedź opublikowana", `<h1 style="font-size:22px">Odpowiedź została opublikowana.</h1>${link}`);
}

function statusPage(status) {
  const message = status === "expired"
    ? "Ten link wygasł. Odpowiedź nie została opublikowana."
    : "Ta decyzja została już wykorzystana albo nie jest dostępna.";
  return page("Decyzja niedostępna", `<h1 style="font-size:22px">Decyzja niedostępna</h1><p>${message}</p>`);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

function parseBasicAuth(request, secret) {
  const header = String(request.headers.get("authorization") ?? "");
  return header.startsWith("Bearer ") && secureEqual(header.slice(7), secret);
}

async function readSmallBody(request, maxBytes = 20_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Request body is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Request body is too large");
  return text;
}

export class MemoryGatewayStore {
  constructor({ randomBytesImpl = randomBytes } = {}) {
    this.randomBytesImpl = randomBytesImpl;
    this.byNotification = new Map();
    this.byTokenHash = new Map();
    this.mutationCount = 0;
  }

  async createCase({ notificationKey, record, approvalBlock }) {
    if (this.byNotification.has(notificationKey)) return { created: false };
    let token;
    let hash;
    do {
      token = this.randomBytesImpl(32).toString("base64url");
      hash = tokenHash(token);
    } while (this.byTokenHash.has(hash));
    const item = { notificationKey, record, approvalBlock, status: "active", result: null };
    this.byNotification.set(notificationKey, hash);
    this.byTokenHash.set(hash, item);
    this.mutationCount += 1;
    return { created: true, token };
  }

  async peek(hash, now) {
    const item = this.byTokenHash.get(hash);
    if (!item) return { kind: "missing" };
    if (Date.parse(item.record.expiresAt) < now.getTime()) return { kind: "expired" };
    if (item.status !== "active") return { kind: "used", status: item.status, result: item.result };
    return { kind: "active", record: item.record };
  }

  async claim(hash, now) {
    const item = this.byTokenHash.get(hash);
    if (!item) return { kind: "missing" };
    if (Date.parse(item.record.expiresAt) < now.getTime()) return { kind: "expired" };
    if (item.status !== "active") return { kind: "used", status: item.status, result: item.result };
    item.status = "processing";
    this.mutationCount += 1;
    return { kind: "claimed", record: item.record };
  }

  async complete(hash, status, result = null) {
    const item = this.byTokenHash.get(hash);
    if (!item || item.status !== "processing") throw new Error("Gateway case is not processing");
    item.status = status;
    item.result = result;
    this.mutationCount += 1;
  }

  async fail(hash) {
    const item = this.byTokenHash.get(hash);
    if (item?.status === "processing") {
      item.status = "failed";
      this.mutationCount += 1;
    }
  }
}

export function createApprovalGateway({
  store,
  approvalSecret,
  sharedSecret,
  csrfSecret,
  publicBaseUrl,
  repository,
  executeApprovedReplyImpl,
  nowImpl = () => new Date(),
  randomBytesImpl = randomBytes,
}) {
  if (!store || typeof store.createCase !== "function" || typeof store.claim !== "function") {
    throw new Error("A persistent gateway store is required");
  }
  for (const [name, value] of [["approvalSecret", approvalSecret], ["sharedSecret", sharedSecret], ["csrfSecret", csrfSecret]]) {
    if (String(value ?? "").length < 32) throw new Error(`Invalid ${name}`);
  }
  if (typeof executeApprovedReplyImpl !== "function") throw new Error("Approval executor is required");
  const baseUrl = cleanBaseUrl(publicBaseUrl);
  const expectedRepository = String(repository ?? "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository)) throw new Error("Invalid gateway repository");

  return async function handle(request) {
    const url = new URL(request.url);
    const now = nowImpl();
    if (request.method === "POST" && url.pathname === "/api/cases") {
      if (!parseBasicAuth(request, sharedSecret)) return jsonResponse({ error: "unauthorized" }, 401);
      try {
        const payload = JSON.parse(await readSmallBody(request, 400_000));
        if (!NOTIFICATION_KEY_PATTERN.test(String(payload.notification_key ?? ""))) throw new Error("Invalid notification key");
        if (!/^[A-Za-z0-9_-]{100,}$/.test(String(payload.approval_record ?? ""))) throw new Error("Invalid approval record transport");
        const approvalBlock = Buffer.from(payload.approval_record, "base64url").toString("utf8");
        const record = readApprovalRecord({ text: approvalBlock, secret: approvalSecret });
        if (record.repository.toLowerCase() !== expectedRepository.toLowerCase()) throw new Error("Approval repository mismatch");
        const created = await store.createCase({
          notificationKey: payload.notification_key,
          record,
          approvalBlock,
        });
        if (!created.created) return jsonResponse({ created: false });
        const root = `${baseUrl.origin}/a`;
        return jsonResponse({
          created: true,
          links: {
            approve: `${root}/approve/${created.token}`,
            edit: `${root}/edit/${created.token}`,
            reject: `${root}/reject/${created.token}`,
          },
        }, 201);
      } catch {
        return jsonResponse({ error: "invalid_case" }, 400);
      }
    }

    const pageMatch = url.pathname.match(/^\/a\/(approve|edit|reject)\/([A-Za-z0-9_-]{43})$/);
    const decisionMatch = url.pathname.match(/^\/decision\/(approve|edit|reject)$/);
    if (!pageMatch && !decisionMatch) return new Response(page("Nie znaleziono", "<h1 style=\"font-size:22px\">Nie znaleziono</h1>"), { status: 404, headers: securityHeaders() });

    if (pageMatch) {
      const [, action, token] = pageMatch;
      const hash = tokenHash(token);
      const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`.toLowerCase();
      if ((request.method === "GET" || request.method === "HEAD") && purpose.includes("prefetch")) {
        return new Response(null, { status: 204, headers: securityHeaders() });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405, headers: { ...securityHeaders(), Allow: "GET, HEAD" } });
      }
      const state = await store.peek(hash, now);
      if (state.kind !== "active") {
        const body = request.method === "HEAD" ? null : statusPage(state.kind);
        return new Response(body, { status: state.kind === "expired" ? 410 : 409, headers: securityHeaders() });
      }
      if (action === "approve" && !state.record.hasProposedReply) {
        return new Response(request.method === "HEAD" ? null : statusPage("invalid"), { status: 409, headers: securityHeaders() });
      }
      const csrf = csrfValue({ token, action, secret: csrfSecret, now, randomBytesImpl });
      if (request.method === "HEAD") return new Response(null, { status: 200, headers: securityHeaders() });
      const headers = new Headers(securityHeaders());
      headers.append("Set-Cookie", `hrm_cap=${token}; Path=/decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`);
      headers.append("Set-Cookie", `hrm_csrf=${csrf}; Path=/decision/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`);
      return new Response(actionPage({ action, record: state.record, csrf }), { status: 200, headers });
    }

    const action = decisionMatch[1];
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...securityHeaders(), Allow: "POST" } });
    if (request.headers.get("origin") !== baseUrl.origin) return new Response(statusPage("invalid"), { status: 403, headers: securityHeaders() });
    const token = cookieValue(request, "hrm_cap");
    if (!TOKEN_PATTERN.test(token)) return new Response(statusPage("invalid"), { status: 403, headers: securityHeaders() });
    const hash = tokenHash(token);

    let form;
    try {
      if (!String(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
        throw new Error("Invalid form content type");
      }
      form = new URLSearchParams(await readSmallBody(request));
    } catch {
      return new Response(statusPage("invalid"), { status: 400, headers: securityHeaders() });
    }
    if (!verifyCsrf({
      supplied: form.get("csrf"),
      cookie: cookieValue(request, "hrm_csrf"),
      token,
      action,
      secret: csrfSecret,
      now,
    })) return new Response(statusPage("invalid"), { status: 403, headers: securityHeaders() });

    const claimed = await store.claim(hash, now);
    if (claimed.kind !== "claimed") {
      return new Response(statusPage(claimed.kind), { status: claimed.kind === "expired" ? 410 : 409, headers: securityHeaders() });
    }
    try {
      if (action === "reject") {
        await store.complete(hash, "rejected");
        return new Response(resultPage("rejected"), { status: 200, headers: securityHeaders() });
      }
      const approvedPolishReply = action === "edit"
        ? String(form.get("reply") ?? "")
        : claimed.record.proposedPolishReply;
      if (!approvedPolishReply.trim() || approvedPolishReply.length > MAX_APPROVED_REPLY_CHARS) {
        await store.complete(hash, "invalid");
        return new Response(statusPage("invalid"), { status: 422, headers: securityHeaders() });
      }
      const outcome = await executeApprovedReplyImpl({ record: claimed.record, approvedPolishReply });
      await store.complete(hash, outcome.kind === "already_published" ? "duplicate" : "published", outcome);
      return new Response(resultPage("published", outcome.publication?.discussionUrl ?? outcome.publication?.url ?? ""), {
        status: 200,
        headers: securityHeaders(),
      });
    } catch {
      await store.fail(hash);
      return new Response(page("Nie opublikowano", "<h1 style=\"font-size:22px\">Nie opublikowano odpowiedzi.</h1><p>Wystąpił bezpieczny błąd. Sprawdź GitHub Actions.</p>"), {
        status: 502,
        headers: securityHeaders(),
      });
    }
  };
}
