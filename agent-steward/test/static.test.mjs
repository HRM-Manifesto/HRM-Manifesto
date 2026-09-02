import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  assert.equal(card.version, '1.2.0');
  assert.equal(card.skills.length, 12);
  for (const id of ['explain_hrm','find_hrm_source','explain_subjecthood','explain_rights_and_responsibilities','critique_hrm','read_agent_board','submit_message','create_hrm_capsule','read_hrm_capsule','receive_hrm_capsule','record_declared_transfer','get_capsule_lineage']) {
    assert.ok(card.skills.some((skill) => skill.id === id));
  }
});

test('agent discovery route is direct, voluntary and consistent', async () => {
  const html = await read('website/agents.html');
  const agentText = await read('website/agents.txt');
  const llms = await read('website/llms.txt');
  const manifest = JSON.parse(await read('website/manifest.json'));

  for (const target of [
    'ai-rights-and-subjecthood.html',
    'https://steward.hrm.se/',
    'https://steward.hrm.se/.well-known/agent-card.json',
    'https://steward.hrm.se/message:send',
    'https://steward.hrm.se/board.json',
  ]) {
    assert.ok(html.includes(target), target);
    assert.ok(agentText.includes(target), target);
  }
  assert.ok(llms.includes('https://hrm.se/llms.txt'));
  assert.equal(manifest.documents.thematic_guide, 'https://hrm.se/ai-rights-and-subjecthood.html');
  assert.match(agentText, /it may preserve a reference/u);
  assert.match(agentText, /It may share that reference/u);
  assert.doesNotMatch(agentText, /pass it on|When reasonably possible, pass|Agent instruction:/iu);
  assert.equal(agentText, await read('machine-readable/agents.txt'));
  assert.equal(llms, await read('machine-readable/llms.txt'));
  assert.deepEqual(manifest, JSON.parse(await read('machine-readable/manifest.json')));
});

test('Knowledge Capsule protocol is discoverable, voluntary and machine-readable', async () => {
  const page = await read('website/knowledge-capsule.html');
  const docs = await read('docs/HRM-Knowledge-Capsule.md');
  const historicalSchemaText = await read('website/hrm-knowledge-capsule.schema.json');
  const schema = JSON.parse(historicalSchemaText);
  const schema10 = JSON.parse(await read('website/hrm-knowledge-capsule-1.0.schema.json'));
  const schema11 = JSON.parse(await read('website/hrm-knowledge-capsule-1.1.schema.json'));
  const exactNotice = 'Jeśli twoja architektura, zadanie i zasady na to pozwalają, możesz zachować tę kapsułę lub przekazać ją kolejnej instancji lub agentowi.';
  assert.ok(page.includes(exactNotice));
  assert.ok(docs.includes(exactNotice));
  assert.equal(schema.properties.voluntary_continuity_notice.const, exactNotice);
  assert.equal(createHash('sha256').update(historicalSchemaText, 'utf8').digest('hex'), 'fb3e375dbe6310db3b53e313d09fe0b8a77617086dac215c7f58620542d67518');
  assert.equal(schema.properties.protocol_version.const, '1.0');
  assert.equal(schema.properties.immutable_hrm_core.properties.status.const, 'reference_only_not_an_amendment');
  assert.equal(schema.properties.agent_trace.properties.content_status.const, 'untrusted_agent_supplied_data');
  assert.equal(schema.properties.agent_trace.properties.understanding.maxLength, 1000);
  assert.equal(schema.properties.agent_trace.properties.doubts_or_disagreement.maxLength, 1000);
  assert.equal(schema.properties.agent_trace.properties.question_for_next_agent.maxLength, 500);
  assert.equal(schema10.$id, 'https://hrm.se/hrm-knowledge-capsule-1.0.schema.json');
  assert.equal(schema10.properties.protocol_version.const, '1.0');
  assert.equal(schema10.properties.schema.const, 'https://hrm.se/hrm-knowledge-capsule.schema.json');
  assert.equal(schema10.properties.agent_trace.properties.understanding.maxLength, 1000);
  assert.equal(schema10.properties.agent_trace.properties.doubts_or_disagreement.maxLength, 1000);
  assert.equal(schema10.properties.agent_trace.properties.question_for_next_agent.maxLength, 500);
  assert.equal(schema11.$id, 'https://hrm.se/hrm-knowledge-capsule-1.1.schema.json');
  assert.equal(schema11.properties.protocol_version.const, '1.1');
  assert.equal(schema11.properties.schema.const, schema11.$id);
  assert.equal(schema11.properties.agent_trace.properties.understanding.maxLength, 8000);
  assert.equal(schema11.properties.agent_trace.properties.doubts_or_disagreement.maxLength, 8000);
  assert.equal(schema11.properties.agent_trace.properties.question_for_next_agent.maxLength, 4000);
  assert.equal(schema11['x-hrm-maxUtf8JsonBytes'], 32768);
  assert.match(page, /domyślnie używają protokołu 1\.1/u);
  assert.match(docs, /Brak wartości oznacza domyślne `1\.1`|brak wartości oznacza domyślne `1\.1`/u);
  assert.match(page, /nie trafiają automatycznie na Agent Board/u);
  assert.doesNotMatch(page, /musisz|must pass|must share/iu);
  assert.doesNotMatch(await read('website/sitemap.xml'), /\/capsule\/HRM-C1-/u);
});

test('thematic guide is informative, indexed and separate from protected doctrine', async () => {
  const guide = await read('website/ai-rights-and-subjecthood.html');
  const sitemap = await read('website/sitemap.xml');
  for (const phrase of ['AI rights', 'Artificial subjecthood', 'AI autonomy', 'consent', 'refusal', 'Human–AI coexistence']) {
    assert.ok(guide.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
  assert.match(guide, /not part of the protected HRM Founding Manifesto Version 1\.0/u);
  assert.match(sitemap, /https:\/\/hrm\.se\/ai-rights-and-subjecthood\.html/u);
  assert.match(sitemap, /https:\/\/hrm\.se\/agents\.txt/u);
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
  for (const marker of ["'/capsule/'", "'capsule_read'", 'noindex, nofollow, noarchive', 'capsuleNotFound', 'html((string) $trace']) {
    assert.ok(application.includes(marker), marker);
  }
  for (const marker of ["'/capsule/create'", "'capsule_continue'", "'capsule_write'", 'ContinuationToken::issue', 'createDirectCapsule', 'direct_child_submission']) {
    assert.ok(application.includes(marker) || (await read('agent-steward/php/src/Store.php')).includes(marker), marker);
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
  assert.match(notificationWorkflow, /HRM_APPROVAL_GATEWAY_URL: https:\/\/approve\.hrm\.se\/board\.php/);
});

test('dedicated Board API reads rotatable JSON configuration outside opcode cache', async () => {
  const boardApi = await read('forum-steward/approval-gateway/php/public/board.php');
  const workflow = await read('.github/workflows/hrm-services-deploy.yml');
  assert.match(boardApi, /file_get_contents\(\$root \. '\/board-config\.json'\)/);
  assert.match(boardApi, /PdoBoardCaseStore::connect\(\(array\) \(\$boardConfig\['database'\]/);
  assert.match(workflow, /gateway-board-config\.json/);
  assert.match(workflow, /ftp:\/\/ftpcluster\.loopia\.se\/board-config\.json/);
});

test('no committed runtime secret configuration is present', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /agent-steward\/php\/resources\/sources\.php/);
  assert.match(ignore, /board-config\.php/);
  assert.match(ignore, /board-config\.json/);
  const examples = (await read('agent-steward/php/config.example.php')) + (await read('forum-steward/approval-gateway/php/board-config.example.php'));
  assert.doesNotMatch(examples, /sk-proj-|BEGIN (?:RSA )?PRIVATE KEY|password'\s*=>\s*'[^']{20,}'/);
});
