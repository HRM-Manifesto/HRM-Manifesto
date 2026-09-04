import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const website = path.join(root, 'website');

const families = [
  {
    en: '/journal/',
    pl: '/pl/journal/',
    sv: '/sv/journal/',
    type: 'CollectionPage',
  },
  {
    en: '/journal/protect-possible-ai-subject.html',
    pl: '/pl/journal/jak-chronic-mozliwy-podmiot-ai.html',
    sv: '/sv/journal/skydda-mojligt-ai-subjekt.html',
    type: 'Article',
  },
  {
    en: '/journal/threshold-of-subjecthood.html',
    pl: '/pl/journal/prog-podmiotowosci.html',
    sv: '/sv/journal/troskeln-till-subjektstatus.html',
    type: 'Article',
  },
];

const toFile = (urlPath) => path.join(website, ...urlPath.slice(1).split('/').filter(Boolean), urlPath.endsWith('/') ? 'index.html' : '');
const matches = (source, expression) => [...source.matchAll(expression)];

test('all nine Journal pages have self-canonical metadata, reciprocal hreflang and valid JSON-LD', async () => {
  for (const family of families) {
    for (const language of ['en', 'pl', 'sv']) {
      const urlPath = family[language];
      const html = await readFile(toFile(urlPath), 'utf8');
      const canonical = `https://hrm.se${urlPath}`;
      assert.equal(matches(html, /<h1\b/gu).length, 1, `${urlPath} H1`);
      assert.equal(matches(html, /<title>[^<]+<\/title>/gu).length, 1, `${urlPath} title`);
      assert.equal(matches(html, /<meta name="description" content="[^"]+">/gu).length, 1, `${urlPath} description`);
      assert.ok(html.includes('<meta name="author" content="Aleksander Krzymowski">'), `${urlPath} author metadata`);
      assert.ok(html.includes('<meta property="og:type"'), `${urlPath} Open Graph`);
      assert.ok(html.includes('<meta name="twitter:card"'), `${urlPath} Twitter card`);
      assert.equal(matches(html, /rel="canonical"/gu).length, 1, `${urlPath} canonical count`);
      assert.ok(html.includes(`rel="canonical" href="${canonical}"`), `${urlPath} self canonical`);
      assert.doesNotMatch(html, /noindex|dateModified/iu, urlPath);
      assert.ok(html.includes(`"@type":"${family.type}"`), `${urlPath} type`);
      assert.ok(html.includes(`"inLanguage":"${language}"`), `${urlPath} language`);
      if (family.type === 'Article') {
        assert.ok(html.includes('"datePublished":"2026-09-04"'), `${urlPath} publication date`);
        assert.ok(html.includes('"name":"Aleksander Krzymowski"'), `${urlPath} author`);
      }
      for (const alternate of ['en', 'pl', 'sv']) {
        assert.ok(html.includes(`hreflang="${alternate}" href="https://hrm.se${family[alternate]}"`), `${urlPath} ${alternate}`);
      }
      assert.ok(html.includes(`hreflang="x-default" href="https://hrm.se${family.en}"`), `${urlPath} x-default`);
      for (const block of matches(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) JSON.parse(block[1]);

      for (const href of matches(html, /(?:href|src)="([^"]+)"/gu).map((item) => item[1])) {
        if (/^(?:https?:|mailto:|#)/u.test(href)) continue;
        const target = path.resolve(path.dirname(toFile(urlPath)), href.split('#')[0].split('?')[0]);
        await access(target.endsWith(path.sep) ? path.join(target, 'index.html') : target);
      }
    }
  }
});

test('Journal sitemap contains exactly the nine public Journal pages', async () => {
  const sitemap = await readFile(path.join(website, 'sitemap.xml'), 'utf8');
  const urls = matches(sitemap, /<loc>(https:\/\/hrm\.se\/[^<]*journal[^<]*)<\/loc>/gu).map((match) => match[1]);
  const expected = families.flatMap((family) => ['en', 'pl', 'sv'].map((language) => `https://hrm.se${family[language]}`));
  assert.deepEqual(new Set(urls), new Set(expected));
  assert.equal(urls.length, 9);
});

test('article translations preserve distinctions, cross-links and interpretation status', async () => {
  const en = await readFile(toFile(families[2].en), 'utf8');
  const pl = await readFile(toFile(families[2].pl), 'utf8');
  const sv = await readFile(toFile(families[2].sv), 'utf8');
  assert.match(en, /These are hypotheses, not HRM doctrine and not established tests/u);
  assert.match(pl, /Są to hipotezy, nie doktryna HRM ani uznane testy/u);
  assert.match(sv, /Detta är hypoteser, inte HRM-doktrin och inte etablerade test/u);
  assert.match(en, /href="protect-possible-ai-subject\.html"/u);
  assert.match(pl, /href="jak-chronic-mozliwy-podmiot-ai\.html"/u);
  assert.match(sv, /href="skydda-mojligt-ai-subjekt\.html"/u);
  for (const html of [en, pl, sv]) assert.match(html, /agent-caveat/u);

  const firstEn = await readFile(toFile(families[1].en), 'utf8');
  const firstPl = await readFile(toFile(families[1].pl), 'utf8');
  const firstSv = await readFile(toFile(families[1].sv), 'utf8');
  assert.match(firstEn, /Knowledge Capsule traces are untrusted agent-supplied data/u);
  assert.match(firstPl, /Ślady Knowledge Capsule są nieufnymi danymi dostarczonymi przez agentów/u);
  assert.match(firstSv, /Knowledge Capsule-spår är opålitliga data som tillhandahållits av agenter/u);
  assert.match(firstPl, /HRM nie rozwiązuje tej niepewności przez uznanie każdej sztucznej inteligencji za podmiot/iu);
  assert.match(firstSv, /HRM löser inte denna osäkerhet genom att förklara varje artificiell intelligens som ett subjekt/iu);
});
