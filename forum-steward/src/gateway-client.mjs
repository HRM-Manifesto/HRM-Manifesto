import { notificationKeyForEntry } from "./notification.mjs";
import { REQUEST_TIMEOUT_MS } from "./config.mjs";

function gatewayConfig(environment) {
  const rawUrl = String(environment.HRM_APPROVAL_GATEWAY_URL ?? "").trim();
  if (!rawUrl) return null;
  let baseUrl;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid HRM_APPROVAL_GATEWAY_URL");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("HRM_APPROVAL_GATEWAY_URL must be a clean HTTPS URL");
  }
  if (baseUrl.pathname !== "/") throw new Error("HRM_APPROVAL_GATEWAY_URL must use the origin root");
  const secret = String(environment.HRM_GATEWAY_SHARED_SECRET ?? "");
  if (secret.length < 32 || secret.length > 10_000 || /[\r\n\0]/.test(secret)) {
    throw new Error("HRM_GATEWAY_SHARED_SECRET is missing or invalid");
  }
  return { baseUrl, secret };
}

function safeActionUrl(value, baseUrl, action) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Approval Gateway returned an invalid action URL");
  }
  const expectedPath = new RegExp(`^/a/${action}/[A-Za-z0-9_-]{43}$`);
  if (url.origin !== baseUrl.origin || url.protocol !== "https:" || url.search || url.hash || !expectedPath.test(url.pathname)) {
    throw new Error("Approval Gateway returned an unsafe action URL");
  }
  return url.href;
}

export function gatewayIsConfigured(environment = process.env) {
  return Boolean(String(environment.HRM_APPROVAL_GATEWAY_URL ?? "").trim());
}

export async function registerGatewayCase({
  entry,
  approval,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const config = gatewayConfig(environment);
  if (!config) return null;
  const notificationKey = notificationKeyForEntry(entry, environment.GITHUB_REPOSITORY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(new URL("/api/cases", config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
        "User-Agent": "HRM-Forum-Steward",
      },
      body: JSON.stringify({
        notification_key: notificationKey,
        approval_record: Buffer.from(approval.block, "utf8").toString("base64url"),
      }),
      signal: controller.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Approval Gateway registration failed with status ${response.status}`);
  const payload = await response.json();
  if (payload?.created === false) return { created: false, notificationKey };
  if (payload?.created !== true || !payload.links) throw new Error("Approval Gateway returned an invalid registration result");
  return {
    created: true,
    notificationKey,
    links: {
      approve: safeActionUrl(payload.links.approve, config.baseUrl, "approve"),
      edit: safeActionUrl(payload.links.edit, config.baseUrl, "edit"),
      reject: safeActionUrl(payload.links.reject, config.baseUrl, "reject"),
    },
  };
}
