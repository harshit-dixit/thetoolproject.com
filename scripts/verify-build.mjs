import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { generateLocalizedRedirects, loadRoutingRegistries } from './localized-redirects.mjs';
import { localizedPaths } from '../src/data/localized-paths.mjs';
import { historicalPathForms } from '../src/data/localized-path-validation.mjs';
import { htmlLang } from '../src/i18n/locales.mjs';
import { checkArtifact } from './localized-routing-check.mjs';
await checkArtifact();
await generateLocalizedRedirects({ distCheck: true });
const { tools, pages } = await loadRoutingRegistries();
const toolPath = (id, locale) => Object.values(tools).find(tool => tool.id === id).locales[locale].path;
// Verify metadata and footer navigation for every batch using actual published identities.
const absolute = path => `https://thetoolproject.com${path}`;
for (const [kind, registry] of [['tool', tools], ['page', pages]]) {
  for (const item of Object.values(registry).filter(item => item.id !== 'notFound')) {
    const entries = Object.entries(item.locales).filter(([, entry]) => entry.reviewed);
    const expectedAlternates = Object.fromEntries([
      ...entries.map(([locale, entry]) => [htmlLang[locale], absolute(entry.path)]),
      ['x-default', absolute(item.locales.en.path)],
    ]);
    for (const [locale, entry] of entries) {
      const html = readFileSync(new URL(`../dist/${entry.path.slice(1)}index.html`, import.meta.url), 'utf8');
      assert.ok(html.includes(`<html lang="${htmlLang[locale]}"`), `${item.id}:${locale} language`);
      assert.deepEqual([...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(match => match[1]), [absolute(entry.path)]);
      const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)];
      assert.equal(alternates.length, entries.length + 1, `${item.id}:${locale} unique alternates`);
      assert.deepEqual(Object.fromEntries(alternates.map(([, lang, url]) => [lang, url])), expectedAlternates);
      const select = html.match(/<select id="language-select"[^>]*>([\s\S]*?)<\/select>/)[1];
      assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
        Object.keys(pages.home.locales).filter(locale => pages.home.locales[locale].reviewed)
          .map(locale => item.locales[locale]?.reviewed ? item.locales[locale].path : pages.home.locales[locale].path));
      const footer = html.slice(html.indexOf('<footer>'));
      for (const id of ['about', 'contact', 'privacy', 'terms']) {
        assert.ok(footer.includes(`href="${pages[id].locales[locale].path}"`), `${item.id}:${locale} footer ${id}`);
      }
      if (kind === 'tool') {
        assert.ok(html.includes(`data-tool="${item.id}"`));
        const data = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
        assert.equal(data.find(item => item['@type'] === 'WebApplication').url, absolute(entry.path));
        assert.equal(data.find(item => item['@type'] === 'BreadcrumbList').itemListElement.at(-1).item, absolute(entry.path));
      }
    }
  }
}
const historical = new Set(Object.values(localizedPaths).flatMap(kind => Object.values(kind)
  .flatMap(item => Object.values(item).flatMap(change => change.previousPaths.flatMap(historicalPathForms)))));
for (const file of readdirSync(new URL('../dist/', import.meta.url), { recursive: true }).filter(file => file.endsWith('.html'))) {
  const html = readFileSync(new URL(`../dist/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8');
  for (const [, value] of html.matchAll(/(?:href|value)="([^"]+)"/g)) {
    const url = new URL(value, 'https://thetoolproject.com');
    assert.ok(url.origin !== 'https://thetoolproject.com' || !historical.has(url.pathname), `${file} links to legacy URL ${value}`);
  }
}
const read = path => readFileSync(new URL(`../dist/${path}`, import.meta.url), 'utf8');
const tool = read('json-to-html/index.html');
const excel = read('excel-to-csv/index.html');
const dbfExcel = read('dbf-to-excel/index.html');
const emlPdf = read('eml-to-pdf/index.html');
const mhtPdf = read('mht-to-pdf/index.html');
const webpPages = Object.fromEntries(['webp-converter', 'webp-to-png', 'webp-to-jpg', 'webp-to-gif', 'webp-to-svg'].map(id => [id, read(`${id}/index.html`)]));
const jsonExcel = read('json-to-excel/index.html');
const jsonCsv = read('json-to-csv/index.html');
const xmlCsv = read('xml-to-csv/index.html');
const xmlJson = read('xml-to-json/index.html');
const csvSql = read('csv-to-sql/index.html');
const csvViewer = read('csv-viewer/index.html');
const harAnalyzer = read('har-analyzer/index.html');
const videoGif = read('video-to-gif/index.html');
const mergeJpg = read('merge-jpg/index.html');
const mergeJpgPdf = read('merge-jpg-to-pdf/index.html');
const csvJson = read('csv-to-json/index.html');
const jsonBeautifier = read('json-beautifier/index.html');
const wordCounter = read('word-counter/index.html');
const tipCalculator = read('tip-calculator/index.html');
const highSchoolGpa = read('high-school-gpa-calculator/index.html');
const gpaCalculator = read('gpa-calculator/index.html');
const autoLoan = read('auto-loan-calculator/index.html');
const overtimePage = read('overtime-calculator/index.html');
const ageCalculator = read('age-calculator/index.html');
const diceRoller = read('dice-roller/index.html');
const cumLaudeGuide = read('guides/cum-laude/index.html');
const volumeCalculator = read('volume-calculator/index.html');
const areaCalculator = read('area-calculator/index.html');
const geometryGuide = read('guides/how-to-find-volume-and-area/index.html');
const qrScanner = read('qr-code-scanner/index.html');
const imageResizer = read('image-resizer/index.html');
const jpg100 = read('compress-jpg-to-100kb/index.html');
const jpg50 = read('compress-jpg-to-50kb/index.html');
const pdf = read('compress-pdf/index.html');
const pdf100 = read('compress-pdf-to-100kb/index.html');
const pdf200 = read('compress-pdf-to-200kb/index.html');
const pdf500 = read('compress-pdf-to-500kb/index.html');
const home = read('index.html');
const hasGuides = existsSync(new URL('../dist/guides/json/index.html', import.meta.url)) && existsSync(new URL('../dist/guides/json-syntax-square-brackets/index.html', import.meta.url));
const notFound = read('404.html');
const sitemap = [...read('sitemap-index.xml').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map(([, url]) => read(new URL(url).pathname.slice(1))).join('\n');
assert.match(tool, /<title>JSON to HTML converter \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(tool, /<meta name="description" content="Convert JSON to HTML tables or lists/);
assert.match(tool, /rel="canonical" href="https:\/\/thetoolproject\.com\/json-to-html\/"/);
assert.match(tool, /hreflang="en" href="https:\/\/thetoolproject\.com\/json-to-html\/"/);
assert.match(tool, /hreflang="x-default" href="https:\/\/thetoolproject\.com\/json-to-html\/"/);
const ld = [...tool.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.equal(ld.length, 2);
assert.deepEqual(ld.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
assert.equal(ld[0].offers.price, '0');
assert.equal(ld[0].offers.priceCurrency, 'USD');
assert.equal(ld[0].applicationCategory, 'DeveloperApplication');
assert.equal(ld[0].operatingSystem, 'Any');
assert.match(home, /rel="canonical" href="https:\/\/thetoolproject\.com\/"/);
assert.match(home, /href="\/excel-to-csv\/"/);
assert.match(home, /href="\/dbf-to-excel\/"/);
assert.match(dbfExcel, /<h1 class="page-title">DBF to Excel<\/h1>/);
assert.match(dbfExcel, /rel="canonical" href="https:\/\/thetoolproject\.com\/dbf-to-excel\/"/);
assert.match(home, /href="\/eml-to-pdf\/"/);
assert.match(emlPdf, /<h1 class="page-title">EML to PDF<\/h1>/);
assert.match(emlPdf, /rel="canonical" href="https:\/\/thetoolproject\.com\/eml-to-pdf\/"/);
assert.doesNotMatch(emlPdf, /hreflang="ja"/);
assert.ok(!existsSync(new URL('../dist/ja/eml-to-pdf/index.html', import.meta.url)), 'EML to PDF has no Japanese page yet');
assert.doesNotMatch(read('ja/index.html'), /eml-to-pdf/);
assert.match(home, /href="\/mht-to-pdf\/"/);
assert.match(mhtPdf, /<h1 class="page-title">MHT to PDF<\/h1>/);
assert.match(mhtPdf, /<title>MHT to PDF converter: convert \.mht files to PDF \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(mhtPdf, /rel="canonical" href="https:\/\/thetoolproject\.com\/mht-to-pdf\/"/);
assert.ok(mhtPdf.includes(`hreflang="de" href="https://thetoolproject.com${toolPath('mht-to-pdf', 'de')}"`));
assert.doesNotMatch(mhtPdf, /hreflang="ja"/);
assert.ok(!existsSync(new URL('../dist/ja/mht-to-pdf/index.html', import.meta.url)), 'MHT to PDF has no Japanese page yet');
assert.doesNotMatch(read('ja/index.html'), /mht-to-pdf/);
for (const [id, h1] of [['webp-converter', 'WebP converter'], ['webp-to-png', 'WebP to PNG'], ['webp-to-jpg', 'WebP to JPG (JPEG)'], ['webp-to-gif', 'WebP to GIF'], ['webp-to-svg', 'WebP to SVG']]) {
  assert.match(home, new RegExp(`href="/${id}/"`));
  assert.ok(webpPages[id].includes(`<h1 class="page-title">${h1}</h1>`), `${id} has the H1 "${h1}"`);
  assert.ok(webpPages[id].includes(`rel="canonical" href="https://thetoolproject.com/${id}/"`), `${id} canonical`);
  assert.ok(webpPages[id].includes(`hreflang="ja" href="https://thetoolproject.com/ja/${id}/"`), `${id} links its Japanese page`);
}
// The format pages link to each other and to the hub, and each fixed page shows only its own options.
assert.match(webpPages['webp-to-png'], /href="\/webp-to-jpg\/"/);
assert.match(webpPages['webp-to-png'], /href="\/webp-converter\/"/);
assert.match(webpPages['webp-converter'], /data-format="svg"/);
assert.doesNotMatch(webpPages['webp-to-png'], /data-quality=|data-svg-mode=/);
assert.match(webpPages['webp-to-svg'], /data-svg-mode="trace" aria-pressed="true"/);
// Merge JPG: one image or a PDF from the hub, a PDF only on its own page, with translated URLs.
assert.match(home, /href="\/merge-jpg\/"/);
assert.match(home, /href="\/merge-jpg-to-pdf\/"/);
assert.match(mergeJpg, /<title>Merge JPG: combine JPG files into one image or PDF online \| thetoolproject<\/title>/);
assert.match(mergeJpg, /<h1 class="page-title">Merge JPG<\/h1>/);
assert.match(mergeJpg, /rel="canonical" href="https:\/\/thetoolproject\.com\/merge-jpg\/"/);
assert.match(mergeJpg, /hreflang="de" href="https:\/\/thetoolproject\.com\/de\/jpg-zusammenfuegen\/"/);
assert.match(mergeJpg, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/merge-jpg\/"/);
assert.match(mergeJpg, /data-output="pdf"/);
assert.match(mergeJpg, /data-layout="vertical" aria-pressed="true"/);
assert.match(mergeJpg, /href="\/merge-jpg-to-pdf\/"/);
assert.match(mergeJpgPdf, /<h1 class="page-title">Merge JPG to PDF<\/h1>/);
assert.match(mergeJpgPdf, /hreflang="fr" href="https:\/\/thetoolproject\.com\/fr\/fusionner-jpg-en-pdf\/"/);
assert.doesNotMatch(mergeJpgPdf, /data-output=|data-layout=|data-quality=/);
assert.match(mergeJpgPdf, /href="\/merge-jpg\/"/);
assert.match(mergeJpgPdf, /href="\/compress-pdf\/"/);
// Letter on the English page, A4 elsewhere.
assert.match(mergeJpgPdf, /data-page-size="letter" aria-pressed="true"/);
assert.match(read('de/jpg-zu-pdf-zusammenfuegen/index.html'), /data-page-size="a4" aria-pressed="true"/);
assert.match(read('ja/merge-jpg-to-pdf/index.html'), /<h1 class="page-title">JPGをPDFに結合<\/h1>/);
assert.match(excel, /<title>Excel to CSV converter for XLSX and XLS \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(excel, /<meta name="description" content="Convert Excel XLSX, XLS and ODS sheets to CSV/);
assert.match(excel, /rel="canonical" href="https:\/\/thetoolproject\.com\/excel-to-csv\/"/);
assert.match(excel, /hreflang="en" href="https:\/\/thetoolproject\.com\/excel-to-csv\/"/);
assert.match(excel, /hreflang="x-default" href="https:\/\/thetoolproject\.com\/excel-to-csv\/"/);
assert.match(excel, /<h1 class="page-title">Excel to CSV<\/h1>/);
const excelLd = [...excel.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.deepEqual(excelLd.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
assert.equal(excelLd[0].applicationCategory, 'UtilitiesApplication');
assert.equal(excelLd[0].offers.price, '0');
assert.match(home, /href="\/json-to-excel\/"/);
assert.match(jsonExcel, /<title>JSON to Excel converter: JSON to XLSX \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(jsonExcel, /<meta name="description" content="Convert JSON to an Excel XLSX file/);
assert.match(jsonExcel, /rel="canonical" href="https:\/\/thetoolproject\.com\/json-to-excel\/"/);
assert.match(jsonExcel, /hreflang="x-default" href="https:\/\/thetoolproject\.com\/json-to-excel\/"/);
assert.match(jsonExcel, /<h1 class="page-title">JSON to Excel<\/h1>/);
const jsonExcelLd = [...jsonExcel.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.deepEqual(jsonExcelLd.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
assert.equal(jsonExcelLd[0].applicationCategory, 'UtilitiesApplication');
assert.match(home, /href="\/json-to-csv\/"/);
assert.match(home, /href="\/json-beautifier\/"/);
assert.match(jsonBeautifier, /<h1 class="page-title">JSON beautifier<\/h1>/);
assert.match(jsonBeautifier, /rel="canonical" href="https:\/\/thetoolproject\.com\/json-beautifier\/"/);
assert.match(home, /href="\/word-counter\/"/);
assert.match(wordCounter, /<title>Word counter and character counter online \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(wordCounter, /<h1 class="page-title">Word counter<\/h1>/);
assert.match(wordCounter, /rel="canonical" href="https:\/\/thetoolproject\.com\/word-counter\/"/);
assert.match(wordCounter, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/word-counter\/"/);
assert.match(wordCounter, /href="https:\/\/doi\.org\/10\.1016\/j\.jml\.2019\.104047" target="_blank"/);
assert.match(read('ja/word-counter/index.html'), /<h1 class="page-title">文字数カウント<\/h1>/);
// Independent pilot expectations catch an incorrect mapping as well as stale output.
const pilotPath = '/de/woerterzaehler/';
const pilotUrl = `https://thetoolproject.com${pilotPath}`;
assert.equal(tools.wordCounter.id, 'word-counter');
assert.equal(tools.wordCounter.locales.de.path, pilotPath);
assert.ok(!existsSync(new URL('../dist/de/word-counter/index.html', import.meta.url)));
const wordCounterPaths = Object.fromEntries(Object.entries(tools.wordCounter.locales).filter(([, entry]) => entry.reviewed).map(([locale, entry]) => [locale, entry.path]));
for (const [locale, path] of Object.entries(wordCounterPaths)) {
  const html = read(`${path.slice(1)}index.html`);
  assert.ok(html.includes(`lang="${locale === 'pt' ? 'pt-BR' : locale}"`));
  assert.ok(html.includes('data-tool="word-counter"'));
  const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(canonicals, [`https://thetoolproject.com${path}`]);
  const alternates = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
    .map(([, lang, href]) => [lang, href]));
  assert.deepEqual(alternates, Object.fromEntries([
    ...Object.entries(wordCounterPaths).map(([lang, href]) => [lang === 'pt' ? 'pt-BR' : lang, `https://thetoolproject.com${href}`]),
    ['x-default', 'https://thetoolproject.com/word-counter/'],
  ]));
  assert.ok(html.includes(`<option value="${pilotPath}"`), `${locale} language selector links to German canonical`);
  const data = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.equal(data.find(item => item['@type'] === 'WebApplication').url, `https://thetoolproject.com${path}`);
  const breadcrumbs = data.find(item => item['@type'] === 'BreadcrumbList').itemListElement;
  assert.equal(breadcrumbs[0].item, `https://thetoolproject.com${locale === 'en' ? '/' : `/${locale}/`}`);
  assert.equal(breadcrumbs.at(-1).item, `https://thetoolproject.com${path}`);
}
assert.ok(read('de/index.html').includes(`href="${pilotPath}"`));
for (const file of readdirSync(new URL('../dist/', import.meta.url), { recursive: true }).filter(file => file.endsWith('.html'))) {
  const html = read(file);
  assert.doesNotMatch(html, /(?:href|value)="(?:https:\/\/thetoolproject\.com)?\/de\/word-counter(?:\/|["?#])/, `${file} contains a legacy navigation/metadata URL`);
}
assert.ok(read(`${toolPath('word-counter', 'de').slice(1)}index.html`).includes(pilotUrl));
assert.match(home, /href="\/tip-calculator\/"/);
assert.match(tipCalculator, /<title>Tip calculator: how much to tip and split the bill \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(tipCalculator, /<h1 class="page-title">Tip calculator<\/h1>/);
assert.match(tipCalculator, /rel="canonical" href="https:\/\/thetoolproject\.com\/tip-calculator\/"/);
assert.match(tipCalculator, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/tip-calculator\/"/);
assert.match(tipCalculator, /<option value="USD" selected[ >]/);
assert.match(read('ja/tip-calculator/index.html'), /<h1 class="page-title">割り勘計算<\/h1>/);
assert.match(read('ja/tip-calculator/index.html'), /<option value="JPY" selected[ >]/);
assert.match(home, /href="\/high-school-gpa-calculator\/"/);
assert.match(highSchoolGpa, /<title>High school GPA calculator: weighted and unweighted \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(highSchoolGpa, /<h1 class="page-title">High school GPA calculator<\/h1>/);
assert.match(highSchoolGpa, /rel="canonical" href="https:\/\/thetoolproject\.com\/high-school-gpa-calculator\/"/);
assert.match(highSchoolGpa, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/high-school-gpa-calculator\/"/);
assert.match(highSchoolGpa, /href="https:\/\/bigfuture\.collegeboard\.org\/[^"]+" target="_blank"/);
// The scale table gives A+ both values, and the German page formats points with a decimal comma.
assert.match(highSchoolGpa, /<th scope="row">A\+<\/th><td class="fmt">97–100<\/td><td class="fmt">4\.0 or 4\.3<\/td>/);
assert.match(read(`${toolPath('high-school-gpa-calculator', 'de').slice(1)}index.html`), /<th scope="row">B\+<\/th><td class="fmt">87–89<\/td><td class="fmt">3,3<\/td><td class="fmt">3,8<\/td><td class="fmt">4,3<\/td>/);
assert.match(highSchoolGpa, /href="\/gpa-calculator\/"/);
assert.match(home, /href="\/gpa-calculator\/"/);
assert.match(home, /href="\/age-calculator\/"/);
assert.match(ageCalculator, /<title>Age calculator: calculate age by date of birth \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(ageCalculator, /<h1 class="page-title">Age calculator<\/h1>/);
assert.match(ageCalculator, /rel="canonical" href="https:\/\/thetoolproject\.com\/age-calculator\/"/);
assert.match(ageCalculator, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/age-calculator\/"/);
assert.match(ageCalculator, /id="age-birth" type="date"/);
assert.match(read('ja/age-calculator/index.html'), /<h1 class="page-title">年齢計算<\/h1>/);
assert.match(home, /href="\/dice-roller\/"/);
assert.match(diceRoller, /<title>Dice roller: roll dice online, from d6 to d20 for D&amp;D \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(diceRoller, /<h1 class="page-title">Dice roller<\/h1>/);
assert.match(diceRoller, /rel="canonical" href="https:\/\/thetoolproject\.com\/dice-roller\/"/);
assert.ok(diceRoller.includes(`hreflang="de" href="https://thetoolproject.com${toolPath('dice-roller', 'de')}"`));
assert.match(diceRoller, /id="dice-roll"[^>]*>Roll 1d6<\/button>/);
// Two dice: 6 ways out of 36 to roll a 7. The SRD credit renders as a link.
assert.match(diceRoller, /<th scope="row">7<\/th><td class="fmt">6<\/td><td class="fmt">16\.67%<\/td>/);
assert.match(diceRoller, /href="https:\/\/dnd\.wizards\.com\/resources\/systems-reference-document"/);
// German pages write dice as W6 and Japanese pages as D6.
assert.match(read(`${toolPath('dice-roller', 'de').slice(1)}index.html`), /id="dice-roll"[^>]*>1W6 würfeln<\/button>/);
assert.match(read('ja/dice-roller/index.html'), /data-sides="20" aria-pressed="false"[^>]*>D20<\/button>/);
assert.match(home, /href="\/volume-calculator\/"/);
assert.match(home, /href="\/area-calculator\/"/);
assert.match(home, /href="\/guides\/how-to-find-volume-and-area\/"/);
assert.match(volumeCalculator, /<title>Volume calculator: cylinder, cone, tank and pipe volume \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(volumeCalculator, /<h1 class="page-title">Volume calculator<\/h1>/);
assert.match(volumeCalculator, /rel="canonical" href="https:\/\/thetoolproject\.com\/volume-calculator\/"/);
assert.match(volumeCalculator, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/volume-calculator\/"/);
// The default shape's fields are on the page before the script runs, and the English page starts in inches.
assert.match(volumeCalculator, /data-shape="cylinder" aria-pressed="true"/);
assert.match(volumeCalculator, /data-unit="in" aria-pressed="true"/);
assert.match(volumeCalculator, /<label class="field-label" for="vol-r">Radius \(r\)<\/label>/);
assert.match(volumeCalculator, /<th scope="row">Cylinder<\/th><td class="fmt">V = π × r² × h<\/td>/);
assert.match(volumeCalculator, /href="\/guides\/how-to-find-volume-and-area\/"/);
assert.match(volumeCalculator, /href="https:\/\/www\.engineeringtoolbox\.com\/steel-pipes-dimensions-d_43\.html" target="_blank"/);
assert.match(read(`${toolPath('volume-calculator', 'de').slice(1)}index.html`), /data-unit="cm" aria-pressed="true"/);
assert.match(areaCalculator, /<title>Area calculator: circle, triangle, trapezoid and surface area \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(areaCalculator, /<h1 class="page-title">Area calculator<\/h1>/);
assert.match(areaCalculator, /rel="canonical" href="https:\/\/thetoolproject\.com\/area-calculator\/"/);
assert.match(areaCalculator, /data-shape="solid-cylinder" aria-pressed="false"/);
assert.match(areaCalculator, /<th scope="row">Triangle \(Three sides\)<\/th>/);
assert.match(areaCalculator, /href="\/volume-calculator\/"/);
// The guides are English only, so the other languages link to the English guide and say so.
assert.match(read(`${toolPath('area-calculator', 'fr').slice(1)}index.html`), /href="\/guides\/how-to-find-volume-and-area\/"/);
assert.match(geometryGuide, /<h1>How to find the volume and area of common shapes<\/h1>/);
assert.doesNotMatch(geometryGuide, /every shape|any shape/);
assert.match(geometryGuide, /rel="canonical" href="https:\/\/thetoolproject\.com\/guides\/how-to-find-volume-and-area\/"/);
assert.match(geometryGuide, /href="\/volume-calculator\/\?shape=tank-horizontal"/);
assert.match(geometryGuide, /href="\/area-calculator\/\?shape=triangle-sides"/);
assert.match(home, /href="\/auto-loan-calculator\/"/);
assert.match(autoLoan, /<title>Auto loan calculator: car payment calculator with tax and trade-in \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(autoLoan, /<h1 class="page-title">Auto loan calculator<\/h1>/);
assert.match(autoLoan, /rel="canonical" href="https:\/\/thetoolproject\.com\/auto-loan-calculator\/"/);
assert.match(autoLoan, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/auto-loan-calculator\/"/);
assert.match(autoLoan, /<option value="USD" selected[ >]/);
assert.match(autoLoan, /id="loan-apr"[^>]* value="6.35"/);
assert.match(autoLoan, /<td class="fmt">\$765<\/td><td class="fmt">\$542<\/td>/);
assert.match(autoLoan, /data-rate-preset/);
assert.doesNotMatch(read(`${toolPath('auto-loan-calculator', 'de').slice(1)}index.html`), /data-rate-preset/);
assert.match(read('ja/auto-loan-calculator/index.html'), /<option value="JPY" selected[ >]/);
assert.match(home, /href="\/overtime-calculator\/"/);
assert.match(overtimePage, /<title>Overtime calculator: overtime pay and rate per hour \| thetoolproject<\/title>/);
assert.match(overtimePage, /<h1 class="page-title">Overtime calculator<\/h1>/);
assert.match(overtimePage, /rel="canonical" href="https:\/\/thetoolproject\.com\/overtime-calculator\/"/);
assert.match(overtimePage, /hreflang="de" href="https:\/\/thetoolproject\.com\/de\/ueberstundenrechner\/"/);
assert.match(overtimePage, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/overtime-calculator\/"/);
assert.match(overtimePage, /<option value="USD" selected[ >]/);
assert.match(overtimePage, /id="ot-multiplier"[^>]* value="1.5"/);
// The deduction has its own page: the English overtime page links to it from the answer, and every language from its section.
assert.match(overtimePage, /id="ot-tax-link"[^>]*>Estimate your deduction</);
assert.doesNotMatch(overtimePage, /data-tax-bracket/);
// The "How much is overtime pay" table: $20 at time and a half is $30, and 10 hours of it $300.
assert.match(overtimePage, /<th scope="row">\$20<\/th><td class="fmt">\$30<\/td><td class="fmt">\$40<\/td><td class="fmt">\$300<\/td>/);
for (const locale of ['es', 'pt', 'de', 'fr', 'ja']) {
  const page = read(`${toolPath('overtime-calculator', locale).slice(1)}index.html`);
  assert.doesNotMatch(page, /id="ot-tax-link"/);
  assert.match(page, /href="\/no-tax-on-overtime-calculator\/"/);
}
// The no tax on overtime calculator: a US deduction, so English only, with no translated pages, alternates or links to them.
const noTaxPage = read('no-tax-on-overtime-calculator/index.html');
assert.match(home, /href="\/no-tax-on-overtime-calculator\/"/);
assert.match(noTaxPage, /<title>No tax on overtime calculator: estimate your deduction \| thetoolproject<\/title>/);
assert.match(noTaxPage, /<h1 class="page-title">No tax on overtime calculator<\/h1>/);
assert.match(noTaxPage, /rel="canonical" href="https:\/\/thetoolproject\.com\/no-tax-on-overtime-calculator\/"/);
assert.doesNotMatch(noTaxPage, /hreflang="(es|pt|de|fr|ja)"/);
assert.match(noTaxPage, /href="\/overtime-calculator\/"/);
for (const locale of ['es', 'pt', 'de', 'fr', 'ja']) {
  assert.ok(!existsSync(new URL(`../dist/${locale}/no-tax-on-overtime-calculator/index.html`, import.meta.url)), `No ${locale} no tax on overtime page`);
  assert.doesNotMatch(read(`${locale}/index.html`), /no-tax-on-overtime-calculator/);
}
// Its bracket list has no id, so analytics never gets a visitor's bracket.
assert.match(noTaxPage, /<select class="tool-select" data-tax-bracket[ >]/);
assert.doesNotMatch(noTaxPage, /<select[^>]* id="[^"]*"[^>]*data-tax-bracket|<select[^>]*data-tax-bracket[^>]* id="/);
assert.match(read('pt/calculadora-de-horas-extras/index.html'), /id="ot-regular"[^>]* value="220"/);
assert.match(read('ja/overtime-calculator/index.html'), /<option value="JPY" selected[ >]/);
assert.match(home, /href="\/guides\/cum-laude\/"/);
assert.match(gpaCalculator, /<title>GPA calculator: college semester and cumulative GPA \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(gpaCalculator, /<h1 class="page-title">GPA calculator<\/h1>/);
assert.match(gpaCalculator, /rel="canonical" href="https:\/\/thetoolproject\.com\/gpa-calculator\/"/);
assert.match(gpaCalculator, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/gpa-calculator\/"/);
assert.match(gpaCalculator, /href="https:\/\/registrar\.utah\.edu\/handbook\/honors\.php" target="_blank"/);
assert.match(gpaCalculator, /href="\/guides\/cum-laude\/"/);
// The scale table shows each letter in 0.3 steps and in thirds, and the French page uses a decimal comma.
assert.match(gpaCalculator, /<th scope="row">A\+<\/th><td class="fmt">97–100<\/td><td class="fmt">4\.0 or 4\.3<\/td><td class="fmt">4\.0 or 4\.33<\/td>/);
assert.match(gpaCalculator, /<th scope="row">B\+<\/th><td class="fmt">87–89<\/td><td class="fmt">3\.3<\/td><td class="fmt">3\.33<\/td>/);
assert.match(read(`${toolPath('gpa-calculator', 'fr').slice(1)}index.html`), /<th scope="row">B<\/th><td class="fmt">83–86<\/td><td class="fmt">3,0<\/td><td class="fmt">3,0<\/td>/);
assert.match(cumLaudeGuide, /<h1>What is cum laude\? Magna and summa cum laude explained<\/h1>/);
assert.match(cumLaudeGuide, /rel="canonical" href="https:\/\/thetoolproject\.com\/guides\/cum-laude\/"/);
assert.match(cumLaudeGuide, /href="\/gpa-calculator\/"/);
assert.match(jsonCsv, /<title>JSON to CSV converter: convert JSON files online \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(jsonCsv, /rel="canonical" href="https:\/\/thetoolproject\.com\/json-to-csv\/"/);
assert.match(jsonCsv, /hreflang="x-default" href="https:\/\/thetoolproject\.com\/json-to-csv\/"/);
assert.match(jsonCsv, /href="\/guides\/json-to-csv\/"/);
assert.match(home, /href="\/xml-to-csv\/"/);
assert.match(xmlCsv, /<title>XML to CSV converter: convert XML files online \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(xmlCsv, /rel="canonical" href="https:\/\/thetoolproject\.com\/xml-to-csv\/"/);
assert.match(xmlCsv, /<h1 class="page-title">XML to CSV<\/h1>/);
const xmlCsvLd = [...xmlCsv.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.deepEqual(xmlCsvLd.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
assert.match(home, /href="\/xml-to-json\/"/);
assert.match(home, /href="\/csv-to-sql\/"/);
assert.match(csvSql, /<h1 class="page-title">CSV to SQL<\/h1>/);
assert.match(csvSql, /rel="canonical" href="https:\/\/thetoolproject\.com\/csv-to-sql\/"/);
assert.match(home, /href="\/csv-viewer\/"/);
assert.match(home, /href="\/csv-to-json\/"/);
assert.match(home, /href="\/qr-code-scanner\/"/);
assert.match(qrScanner, /<title>QR code scanner free online: camera or image \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(qrScanner, /rel="canonical" href="https:\/\/thetoolproject\.com\/qr-code-scanner\/"/);
assert.match(qrScanner, /<h1 class="page-title">QR code scanner<\/h1>/);
assert.match(home, /href="\/image-resizer\/"/);
assert.match(home, /href="\/compress-jpg-to-100kb\/"/);
assert.match(home, /href="\/compress-jpg-to-50kb\/"/);
assert.match(imageResizer, /<h1 class="page-title">Image resizer and compressor<\/h1>/);
assert.match(imageResizer, /rel="canonical" href="https:\/\/thetoolproject\.com\/image-resizer\/"/);
assert.match(jpg100, /<h1 class="page-title">Compress JPG to 100KB<\/h1>/);
assert.match(jpg100, /rel="canonical" href="https:\/\/thetoolproject\.com\/compress-jpg-to-100kb\/"/);
assert.match(jpg50, /<h1 class="page-title">Compress JPG to 50KB<\/h1>/);
assert.match(jpg50, /rel="canonical" href="https:\/\/thetoolproject\.com\/compress-jpg-to-50kb\/"/);
assert.match(jpg50, /data-target-kb="50"/);
for (const [page, html, target] of [['compress-pdf', pdf, ''], ['compress-pdf-to-100kb', pdf100, '100'], ['compress-pdf-to-200kb', pdf200, '200'], ['compress-pdf-to-500kb', pdf500, '500']]) {
  assert.match(html, new RegExp(`rel="canonical" href="https://thetoolproject.com/${page}/"`));
  assert.match(html, target ? new RegExp(`data-target-kb="${target}"`) : /data-target-kb(?:\s|>)/);
  assert.match(home, new RegExp(`href="/${page}/"`));
}
assert.match(pdf, /<strong>Keep text and links<\/strong> rewrites the PDF structure\. It preserves selectable text, links and forms, but often saves little space\./);
assert.match(pdf, /<strong>Make it smaller<\/strong> renders each page as a JPEG image in a new PDF\./);
assert.doesNotMatch(pdf, /150 DPI/);
assert.doesNotMatch(pdf, /recompresses existing images/);
assert.doesNotMatch(pdf, /compress a single image/);
assert.match(pdf, /For a preselected limit, use <a href="\/compress-pdf-to-100kb\/">100KB<\/a>, <a href="\/compress-pdf-to-200kb\/">200KB<\/a> or <a href="\/compress-pdf-to-500kb\/">500KB<\/a>\./);
const qrLd = [...qrScanner.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.deepEqual(qrLd.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
assert.equal(qrLd[0].applicationCategory, 'UtilitiesApplication');
assert.match(csvJson, /<h1 class="page-title">CSV to JSON<\/h1>/);
assert.match(csvJson, /rel="canonical" href="https:\/\/thetoolproject\.com\/csv-to-json\/"/);
assert.match(csvViewer, /<h1 class="page-title">CSV viewer<\/h1>/);
assert.match(csvViewer, /rel="canonical" href="https:\/\/thetoolproject\.com\/csv-viewer\/"/);
assert.match(home, /href="\/har-analyzer\/"/);
assert.match(harAnalyzer, /<h1 class="page-title">HAR analyzer<\/h1>/);
assert.match(harAnalyzer, /<title>HAR analyzer and HAR file viewer: open \.har files online \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(harAnalyzer, /rel="canonical" href="https:\/\/thetoolproject\.com\/har-analyzer\/"/);
assert.match(harAnalyzer, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/har-analyzer\/"/);
assert.match(harAnalyzer, /<h3>How to open a HAR file<\/h3>/);
assert.equal([...harAnalyzer.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]))[0].applicationCategory, 'DeveloperApplication');
assert.match(home, /href="\/video-to-gif\/"/);
assert.match(videoGif, /<h1 class="page-title">Video to GIF<\/h1>/);
assert.match(videoGif, /<title>Video to GIF converter: free, online, no upload \| thetoolproject<\/title>/);
assert.match(videoGif, /rel="canonical" href="https:\/\/thetoolproject\.com\/video-to-gif\/"/);
assert.match(videoGif, /hreflang="ja" href="https:\/\/thetoolproject\.com\/ja\/video-to-gif\/"/);
assert.match(videoGif, /<h3>Making a GIF from a YouTube video<\/h3>/);
assert.match(videoGif, /accept="video\/\*/);
assert.match(xmlJson, /<title>XML to JSON converter: convert XML online \|Video to GIF converter: free, online, no upload | thetoolproject<\/title>/);
assert.match(xmlJson, /rel="canonical" href="https:\/\/thetoolproject\.com\/xml-to-json\/"/);
assert.match(xmlJson, /<h1 class="page-title">XML to JSON<\/h1>/);
const xmlJsonLd = [...xmlJson.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match => JSON.parse(match[1]));
assert.deepEqual(xmlJsonLd.map(item => item['@type']), ['WebApplication', 'BreadcrumbList']);
const jsonCsvGuide = read('guides/json-to-csv/index.html');
assert.match(jsonCsvGuide, /<h1>How to convert JSON to CSV<\/h1>/);
assert.match(jsonCsvGuide, /rel="canonical" href="https:\/\/thetoolproject\.com\/guides\/json-to-csv\/"/);
if (hasGuides) {
  const jsonGuide = read('guides/json/index.html');
  const bracketsGuide = read('guides/json-syntax-square-brackets/index.html');
  assert.match(jsonGuide, /<h1>What is JSON\? A practical guide to the format and its files<\/h1>/);
  assert.match(jsonGuide, /rel="canonical" href="https:\/\/thetoolproject\.com\/guides\/json\/"/);
  assert.match(jsonGuide, /What is the difference between XML and JSON\?/);
  assert.match(bracketsGuide, /<h1>JSON syntax: what do square brackets mean\?<\/h1>/);
  assert.match(bracketsGuide, /What can go inside a JSON array\?/);
}
assert.match(notFound, /<meta name="robots" content="noindex"/);
assert.match(notFound, /<h1 class="page-title">This page doesn&#39;t exist<\/h1>/);
assert.match(notFound, /href="\/json-to-html\/"/);
assert.doesNotMatch(notFound, /rel="canonical"|hreflang=/, 'An error page declares no canonical URL or alternates');
// Copy that the i18n extraction once changed or broke; keep the original English.
const xmlJsonPage = read('xml-to-json/index.html');
assert.match(xmlJsonPage, /<code>&lt;empty\/&gt;<\/code> becomes an empty string/);
assert.doesNotMatch(xmlJsonPage, /&amp;lt;/);
const resizerPage = read('image-resizer/index.html');
assert.match(resizerPage, /This mode saves a JPG/);
assert.doesNotMatch(resizerPage, /JPEG and WebP output/);
assert.match(read('csv-viewer/index.html'), /CSV downloads use commas and UTF-8/);
assert.match(read('csv-to-json/index.html'), /Files are limited to 10 MB and 500 columns/);
assert.match(read('qr-code-scanner/index.html'), /<code>https:\/\/<\/code> addresses can be opened from the result/);
assert.match(read('compress-jpg-to-100kb/index.html'), /within 100KB \(102,400 bytes\)/);
assert.match(home, /id="language-select"/);
assert.ok(existsSync(new URL('../dist/404.html', import.meta.url)));
assert.ok(!existsSync(new URL('../dist/404/index.html', import.meta.url)));
for (const locale of ['es', 'pt', 'de', 'fr', 'ja']) {
  assert.match(home, new RegExp(`<option value="/${locale}/"`));
  assert.match(home, new RegExp(`hreflang="${locale === 'pt' ? 'pt-BR' : locale}"`));
  assert.match(read(`${locale}/index.html`), /id="language-select"/);
  assert.ok(existsSync(new URL(`../dist/${locale}/404.html`, import.meta.url)), `${locale} must have a localized 404.html`);
  assert.ok(!existsSync(new URL(`../dist/${locale}/404/index.html`, import.meta.url)), `${locale} must not retain /404/ directory`);
}
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort();
const englishUrls = [
  'https://thetoolproject.com/',
  'https://thetoolproject.com/about/',
  'https://thetoolproject.com/contact/',
  'https://thetoolproject.com/json-to-html/',
  'https://thetoolproject.com/json-to-excel/',
  'https://thetoolproject.com/json-to-csv/',
  'https://thetoolproject.com/json-beautifier/',
  'https://thetoolproject.com/word-counter/',
  'https://thetoolproject.com/tip-calculator/',
  'https://thetoolproject.com/auto-loan-calculator/',
  'https://thetoolproject.com/overtime-calculator/',
  'https://thetoolproject.com/no-tax-on-overtime-calculator/',
  'https://thetoolproject.com/age-calculator/',
  'https://thetoolproject.com/dice-roller/',
  'https://thetoolproject.com/volume-calculator/',
  'https://thetoolproject.com/area-calculator/',
  'https://thetoolproject.com/high-school-gpa-calculator/',
  'https://thetoolproject.com/gpa-calculator/',
  'https://thetoolproject.com/xml-to-csv/',
  'https://thetoolproject.com/xml-to-json/',
  'https://thetoolproject.com/excel-to-csv/',
  'https://thetoolproject.com/dbf-to-excel/',
  'https://thetoolproject.com/eml-to-pdf/',
  'https://thetoolproject.com/mht-to-pdf/',
  'https://thetoolproject.com/csv-to-sql/',
  'https://thetoolproject.com/csv-viewer/',
  'https://thetoolproject.com/har-analyzer/',
  'https://thetoolproject.com/video-to-gif/',
  'https://thetoolproject.com/csv-to-json/',
  'https://thetoolproject.com/qr-code-scanner/',
  'https://thetoolproject.com/image-resizer/',
  'https://thetoolproject.com/webp-converter/',
  'https://thetoolproject.com/webp-to-png/',
  'https://thetoolproject.com/webp-to-jpg/',
  'https://thetoolproject.com/webp-to-gif/',
  'https://thetoolproject.com/webp-to-svg/',
  'https://thetoolproject.com/merge-jpg/',
  'https://thetoolproject.com/merge-jpg-to-pdf/',
  'https://thetoolproject.com/compress-jpg-to-100kb/',
  'https://thetoolproject.com/compress-jpg-to-50kb/',
  'https://thetoolproject.com/compress-pdf/',
  'https://thetoolproject.com/compress-pdf-to-100kb/',
  'https://thetoolproject.com/compress-pdf-to-200kb/',
  'https://thetoolproject.com/compress-pdf-to-500kb/',
  'https://thetoolproject.com/privacy/',
  'https://thetoolproject.com/terms/',
  ...(hasGuides ? ['https://thetoolproject.com/guides/json-syntax-square-brackets/', 'https://thetoolproject.com/guides/json-to-csv/', 'https://thetoolproject.com/guides/json/', 'https://thetoolproject.com/guides/cum-laude/', 'https://thetoolproject.com/guides/how-to-find-volume-and-area/'] : []),
];
const registryUrls = [...Object.values(tools), ...Object.values(pages).filter(page => page.id !== 'notFound')]
  .flatMap(item => Object.values(item.locales).filter(entry => entry.reviewed)
    .map(entry => `https://thetoolproject.com${entry.path}`));
// Keep the independently listed English/guide coverage; translated URLs come from actual entries.
assert.deepEqual(registryUrls.filter(url => !/^\/(es|pt|de|fr|ja)(\/|$)/.test(new URL(url).pathname)).sort(),
  englishUrls.filter(url => !new URL(url).pathname.startsWith('/guides/')).sort());
const expectedUrls = [...registryUrls, ...englishUrls.filter(url => new URL(url).pathname.startsWith('/guides/'))].sort();
assert.deepEqual(sitemapUrls, expectedUrls);
assert.ok(sitemapUrls.includes(pilotUrl));
assert.ok(!sitemapUrls.includes('https://thetoolproject.com/de/word-counter/'));
assert.ok(existsSync(new URL('../dist/404.html', import.meta.url)));
const jsDir = new URL('../dist/_astro/', import.meta.url);
// First-load JS is every module script the page itself references, plus the chunks those scripts import
// statically (such as the shared translation helper); workers and dynamically imported chunks load later.
const firstLoad = page => {
  const names = new Set([...read(page).matchAll(/<script type="module" src="\/_astro\/([^"]+)"/g)].map(match => match[1]));
  assert.ok(names.size, `${page} has a client script`);
  for (const name of names) {
    for (const match of readFileSync(new URL(name, jsDir), 'utf8').matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) names.add(match[1]);
  }
  const files = [...names].map(name => readFileSync(new URL(name, jsDir)));
  return { raw: files.reduce((sum, file) => sum + file.length, 0), gzip: files.reduce((sum, file) => sum + gzipSync(file).length, 0) };
};
const sizes = Object.fromEntries(['json-to-html', 'json-to-excel', 'json-to-csv', 'json-beautifier', 'word-counter', 'tip-calculator', 'auto-loan-calculator', 'overtime-calculator', 'no-tax-on-overtime-calculator', 'age-calculator', 'dice-roller', 'volume-calculator', 'area-calculator', 'high-school-gpa-calculator', 'gpa-calculator', 'xml-to-csv', 'xml-to-json', 'excel-to-csv', 'dbf-to-excel', 'eml-to-pdf', 'mht-to-pdf', 'csv-to-sql', 'csv-viewer', 'har-analyzer', 'video-to-gif', 'csv-to-json', 'qr-code-scanner', 'image-resizer', 'webp-converter', 'webp-to-png', 'webp-to-jpg', 'webp-to-gif', 'webp-to-svg', 'merge-jpg', 'merge-jpg-to-pdf', 'compress-jpg-to-100kb', 'compress-jpg-to-50kb', 'compress-pdf', 'compress-pdf-to-100kb', 'compress-pdf-to-200kb', 'compress-pdf-to-500kb'].map(page => [page, firstLoad(`${page}/index.html`)]));
// The DBF script shares the translation helper chunk, so Astro references it as an external module.
assert.match(dbfExcel, /<script type="module" src="\/_astro\/[^"]+"/);
for (const [page, size] of Object.entries(sizes)) assert.ok(size.gzip < 10000, `First-load JavaScript for ${page} is ${size.gzip} bytes gzipped`);
assert.ok(readdirSync(jsDir).some(name => name.startsWith('cpexcel.') && name.endsWith('.js')), 'Legacy .xls code pages are a separate chunk');
console.log(`Built output checks passed. First-load JS: ${Object.entries(sizes).map(([page, size]) => `${page} ${size.gzip} bytes gzip (${size.raw} raw)`).join(', ')}.`);
