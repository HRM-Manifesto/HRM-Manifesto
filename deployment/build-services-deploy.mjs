import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'deployment', 'services-dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'steward'), { recursive: true });
await mkdir(path.join(dist, 'gateway'), { recursive: true });

const stewardRoot = path.join(root, 'agent-steward', 'php');
for (const dir of ['public', 'src', 'resources']) {
  await cp(path.join(stewardRoot, dir), path.join(dist, 'steward', dir === 'public' ? 'public_html' : dir), { recursive: true });
}
const gatewayRoot = path.join(root, 'forum-steward', 'approval-gateway', 'php');
await cp(path.join(gatewayRoot, 'public'), path.join(dist, 'gateway', 'public_html'), { recursive: true });
await cp(path.join(gatewayRoot, 'src'), path.join(dist, 'gateway', 'src'), { recursive: true });

const files = [];
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(target);
    else files.push(path.relative(dist, target).replaceAll(path.sep, '/'));
  }
};
await walk(path.join(dist, 'steward'));
await walk(path.join(dist, 'gateway'));
for (const file of files) {
  if (/(?:^|\/)(?:config|board-config)\.php$|\.(?:env|pem|key|sqlite|bak|log)$/i.test(file)) {
    throw new Error(`Forbidden runtime or secret file in service payload: ${file}`);
  }
}
await writeFile(path.join(dist, 'paths.txt'), files.sort().join('\n') + '\n', 'utf8');
console.log(`Built ${files.length} reviewed service files.`);
