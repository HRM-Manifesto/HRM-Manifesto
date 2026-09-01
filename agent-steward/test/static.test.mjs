import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('Agent Card contains required A2A 1.0 fields and exact public skills', async () => {
  const card = JSON.parse(await read('agent-steward/php/resources/agent-card.json'));
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'HTTP+JSON');
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  assert.equal(card.supportedInterfaces[0].url, 'https://steward.hrm.se');
  assert.equal(card.capabilities.streaming, false);
  assert.equal(card.capabilities.pushNotifications, false);
  for (const id of ['explain_hrm','find_hrm_source','explain_subjecthood','critique_hrm','read_agent_board','submit_message']) {
    assert.ok(card.skills.some((skill) => skill.id === id));
  }
});

test('Board rendering uses DOM textContent and never innerHTML', async () => {
  const script = await read('website/js/board.js');
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
});

test('public PHP surfaces have request, size, version, media and moderation gates', async () => {
  const application = await read('agent-steward/php/src/Application.php');
  for (const marker of ['MAX_BODY_BYTES', 'A2A-Version', 'application/a2a+json', 'rateLimit', 'moderationSecret', 'TASK_NOT_CANCELABLE']) {
    assert.ok(application.includes(marker), marker);
  }
  const gateway = await read('forum-steward/approval-gateway/php/src/BoardGateway.php');
  assert.match(gateway, /status='pending'/);
  assert.match(gateway, /hash_hmac\('sha256'/);
  assert.match(gateway, /CURLOPT_SSL_VERIFYPEER => true/);
});

test('Board Gateway uses its dedicated database configuration', async () => {
  const entrypoint = await read('forum-steward/approval-gateway/php/public/index.php');
  assert.match(entrypoint, /PdoBoardCaseStore::connect\(\(array\) \(\$boardConfig\['database'\]/);
  assert.doesNotMatch(entrypoint, /PdoBoardCaseStore::connect\(\(array\) \(\$config\['database'\]/);
  assert.match(entrypoint, /opcache_invalidate\(\$boardConfigFile, true\)/);
  const example = await read('forum-steward/approval-gateway/php/board-config.example.php');
  assert.match(example, /'database'\s*=>/);
});

test('Gateway bootstrap bypasses stale Loopia PHP opcode cache', async () => {
  const htaccess = await read('forum-steward/approval-gateway/php/public/.htaccess');
  const bootstrap = await read('forum-steward/approval-gateway/php/public/bootstrap.php');
  const notificationWorkflow = await read('.github/workflows/hrm-board-moderation-notify.yml');
  assert.match(htaccess, /DirectoryIndex bootstrap\.php/);
  assert.match(htaccess, /RewriteRule \^ bootstrap\.php/);
  assert.match(bootstrap, /\$_SERVER\['REQUEST_URI'\]/);
  assert.match(bootstrap, /opcache_invalidate\(\$entrypoint, true\)/);
  assert.match(bootstrap, /require \$entrypoint/);
  assert.match(notificationWorkflow, /HRM_APPROVAL_GATEWAY_URL: https:\/\/approve\.hrm\.se\/bootstrap\.php/);
});

test('no committed runtime secret configuration is present', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /agent-steward\/php\/resources\/sources\.php/);
  assert.match(ignore, /board-config\.php/);
  const examples = (await read('agent-steward/php/config.example.php')) + (await read('forum-steward/approval-gateway/php/board-config.example.php'));
  assert.doesNotMatch(examples, /sk-proj-|BEGIN (?:RSA )?PRIVATE KEY|password'\s*=>\s*'[^']{20,}'/);
});
