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
  {
    en: '/journal/ai-consent-and-refusal.html',
    pl: '/pl/journal/zgoda-i-odmowa-ai.html',
    sv: '/sv/journal/ai-samtycke-och-vagran.html',
    type: 'Article',
  },
  {
    en: '/journal/non-sentient-ai-authentic-interests.html',
    pl: '/pl/journal/nieodczuwajaca-ai-autentyczne-interesy.html',
    sv: '/sv/journal/icke-kannande-ai-genuina-intressen.html',
    type: 'Article',
  },
  {
    en: '/journal/hard-to-fake-ai-subjecthood.html',
    pl: '/pl/journal/trudne-do-podrobienia-oznaki-podmiotowosci-ai.html',
    sv: '/sv/journal/svara-att-fejka-tecken-pa-ai-subjektstatus.html',
    type: 'Article',
  },
];

const toFile = (urlPath) => path.join(website, ...urlPath.slice(1).split('/').filter(Boolean), urlPath.endsWith('/') ? 'index.html' : '');
const matches = (source, expression) => [...source.matchAll(expression)];

test('all eighteen Journal pages have self-canonical metadata, reciprocal hreflang and valid JSON-LD', async () => {
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

test('Journal sitemap contains exactly the eighteen public Journal pages', async () => {
  const sitemap = await readFile(path.join(website, 'sitemap.xml'), 'utf8');
  const urls = matches(sitemap, /<loc>(https:\/\/hrm\.se\/[^<]*journal[^<]*)<\/loc>/gu).map((match) => match[1]);
  const expected = families.flatMap((family) => ['en', 'pl', 'sv'].map((language) => `https://hrm.se${family[language]}`));
  assert.deepEqual(new Set(urls), new Set(expected));
  assert.equal(urls.length, 18);
});

test('each localized Journal index lists five essays newest first', async () => {
  const newest = {
    en: 'hard-to-fake-ai-subjecthood.html',
    pl: 'trudne-do-podrobienia-oznaki-podmiotowosci-ai.html',
    sv: 'svara-att-fejka-tecken-pa-ai-subjektstatus.html',
  };
  for (const language of ['en', 'pl', 'sv']) {
    const html = await readFile(toFile(families[0][language]), 'utf8');
    assert.equal(matches(html, /class="archive-entry"/gu).length, 5, language);
    assert.ok(html.indexOf(newest[language]) < html.indexOf(families[2][language].split('/').at(-1)), `${language} newest first`);
  }
});

test('new essays preserve epistemic limits, status and required distinctions in every language', async () => {
  const consent = await Promise.all(['en', 'pl', 'sv'].map((language) => readFile(toFile(families[3][language]), 'utf8')));
  assert.match(consent[0], /programmed compliance cannot by itself count as consent/u);
  assert.match(consent[1], /zaprogramowane posłuszeństwo nie może samo być zgodą/u);
  assert.match(consent[2], /Programmerad följsamhet kan därför inte i sig räknas som samtycke/u);
  const interests = await Promise.all(['en', 'pl', 'sv'].map((language) => readFile(toFile(families[4][language]), 'utf8')));
  for (const term of ['goal', 'functional interest', 'subject-level interest']) assert.match(interests[0], new RegExp(term, 'u'));
  for (const term of ['Cel', 'Interes funkcjonalny', 'Interes podmiotowy']) assert.match(interests[1], new RegExp(term, 'u'));
  for (const term of ['mål', 'funktionellt intresse', 'intresse på subjektnivå']) assert.match(interests[2], new RegExp(term, 'u'));
  const evidence = await Promise.all(['en', 'pl', 'sv'].map((language) => readFile(toFile(families[5][language]), 'utf8')));
  assert.match(evidence[0], /How do we demand stronger evidence without making human-like performance the price of having rights\?/u);
  assert.match(evidence[1], /Jak wymagać mocniejszych dowodów, nie czyniąc zachowania podobnego do ludzkiego ceną posiadania praw\?/u);
  assert.match(evidence[2], /Hur kräver vi starkare belägg utan att göra människolik prestation till priset för att ha rättigheter\?/u);
  for (const family of families.slice(3)) {
    for (const language of ['en', 'pl', 'sv']) {
      const html = await readFile(toFile(family[language]), 'utf8');
      assert.match(html, /class="article-experiment-note"/u, family[language]);
      assert.match(html, /class="agent-caveat"/u, family[language]);
      assert.doesNotMatch(html, /\son[a-z]+\s*=|javascript:/iu, `${family[language]} inert markup`);
      assert.doesNotMatch(html, /today(?:'s)? (?:AI|chatbots?).*conscious/iu, family[language]);
    }
  }
});

test('English new essays stay within their approved word ranges', async () => {
  const ranges = [[1800, 2400], [1800, 2400], [2000, 2600]];
  for (let index = 0; index < 3; index += 1) {
    const html = await readFile(toFile(families[index + 3].en), 'utf8');
    const body = html.match(/<article class="section-inner prose-stack article">([\s\S]*?)<div class="agent-caveat">/u)?.[1] ?? '';
    const text = body.replace(/<[^>]+>/gu, ' ');
    const count = [...text.matchAll(/\b[\p{L}\p{N}][\p{L}\p{N}’'-]*\b/gu)].length;
    assert.ok(count >= ranges[index][0] && count <= ranges[index][1], `${families[index + 3].en}: ${count}`);
  }
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

test('all Journal pages invite submissions without promising publication or adding a form', async () => {
  const copy = {
    en: ['Have an idea or essay for HRM Journal?', 'Send your article for consideration to:'],
    pl: ['Masz pomysł lub tekst, który powinien znaleźć się w HRM Journal?', 'Wyślij artykuł do rozpatrzenia na:'],
    sv: ['Har du en idé eller essä för HRM Journal?', 'Skicka din artikel för granskning till:'],
  };
  for (const family of families) {
    for (const language of ['en', 'pl', 'sv']) {
      const html = await readFile(toFile(family[language]), 'utf8');
      assert.equal(matches(html, /class="journal-submission"/gu).length, 1, family[language]);
      assert.ok(html.includes(copy[language][0]), `${family[language]} heading`);
      assert.ok(html.includes(copy[language][1]), `${family[language]} explanation`);
      assert.ok(html.includes('href="mailto:manifest@hrm.se?subject=HRM%20Journal%20submission"'), `${family[language]} mailto`);
      assert.ok(html.indexOf('class="journal-submission"') < html.indexOf('</main>'), `${family[language]} before footer`);
      assert.doesNotMatch(html, /<form\b/iu, family[language]);
    }
  }
});

test('home page Journal panel is localized, accessible and responsive without popups', async () => {
  const script = await readFile(path.join(website, 'js', 'hrm.js'), 'utf8');
  const css = await readFile(path.join(website, 'css', 'hrm.css'), 'utf8');
  for (const pathName of ['/', '/index.html', '/pl/', '/pl/index.html', '/sv/', '/sv/index.html']) {
    assert.ok(script.includes(`"${pathName}"`), pathName);
  }
  for (const phrase of ['Latest essays', 'Najnowsze eseje', 'Senaste essäerna', 'View all articles →', 'Zobacz wszystkie artykuły →', 'Se alla artiklar →']) {
    assert.ok(script.includes(phrase), phrase);
  }
  for (const family of families.slice(1)) {
    for (const language of ['en', 'pl', 'sv']) assert.ok(script.includes(family[language].split('/').at(-1)), family[language]);
  }
  assert.match(script, /panel\.setAttribute\("aria-labelledby", "homepage-journal-title"\)/u);
  assert.match(script, /document\.createElement\("a"\)/u);
  assert.doesNotMatch(script, /innerHTML|window\.open|<dialog|modal/iu);
  assert.match(css, /\.journal-panel-list[\s\S]*?max-height:[\s\S]*?overflow-y: auto/u);
  assert.match(css, /@media \(max-width: 68rem\)[\s\S]*?\.hero-journal-layout[\s\S]*?grid-template-columns: 1fr/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);

  for (const homepage of ['index.html', 'pl/index.html', 'sv/index.html']) {
    const html = await readFile(path.join(website, ...homepage.split('/')), 'utf8');
    assert.equal(matches(html, /<h1\b/gu).length, 1, homepage);
    assert.match(html, /<script src="(?:\.\.\/)?js\/hrm\.js\?v=20260904-journal-5" defer><\/script>/u);
    assert.match(html, /<link rel="stylesheet" href="(?:\.\.\/)?css\/hrm\.css\?v=20260904-journal-5">/u);
  }
});
