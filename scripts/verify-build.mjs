import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const read = path => readFileSync(new URL(`../dist/${path}`, import.meta.url), 'utf8');
const tool = read('json-to-html/index.html');
const excel = read('excel-to-csv/index.html');
const dbfExcel = read('dbf-to-excel/index.html');
const jsonExcel = read('json-to-excel/index.html');
const jsonCsv = read('json-to-csv/index.html');
const xmlCsv = read('xml-to-csv/index.html');
const xmlJson = read('xml-to-json/index.html');
const csvSql = read('csv-to-sql/index.html');
const csvViewer = read('csv-viewer/index.html');
const csvJson = read('csv-to-json/index.html');
const jsonBeautifier = read('json-beautifier/index.html');
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
const sitemap = read('sitemap-0.xml');
assert.match(tool, /<title>JSON to HTML converter \| thetoolproject<\/title>/);
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
assert.match(excel, /<title>Excel to CSV converter for XLSX and XLS \| thetoolproject<\/title>/);
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
assert.match(jsonExcel, /<title>JSON to Excel converter: JSON to XLSX \| thetoolproject<\/title>/);
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
assert.match(jsonCsv, /<title>JSON to CSV converter: convert JSON files online \| thetoolproject<\/title>/);
assert.match(jsonCsv, /rel="canonical" href="https:\/\/thetoolproject\.com\/json-to-csv\/"/);
assert.match(jsonCsv, /hreflang="x-default" href="https:\/\/thetoolproject\.com\/json-to-csv\/"/);
assert.match(jsonCsv, /href="\/guides\/json-to-csv\/"/);
assert.match(home, /href="\/xml-to-csv\/"/);
assert.match(xmlCsv, /<title>XML to CSV converter: convert XML files online \| thetoolproject<\/title>/);
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
assert.match(qrScanner, /<title>QR code scanner free online: camera or image \| thetoolproject<\/title>/);
assert.match(qrScanner, /rel="canonical" href="https:\/\/thetoolproject\.com\/qr-code-scanner\/"/);
assert.match(qrScanner, /<h1 class="page-title">QR code scanner<\/h1>/);
assert.match(home, /href="\/image-resizer\/"/);
assert.match(home, /href="\/compress-jpg-to-100kb\/"/);
assert.match(home, /href="\/compress-jpg-to-50kb\/"/);
assert.match(imageResizer, /<h1 class="page-title">Image resizer<\/h1>/);
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
assert.match(xmlJson, /<title>XML to JSON converter: convert XML online \| thetoolproject<\/title>/);
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
// Only one language is published, so no page shows a language picker.
assert.doesNotMatch(home, /id="language-select"/);
assert.ok(existsSync(new URL('../dist/404.html', import.meta.url)));
assert.ok(!existsSync(new URL('../dist/404/index.html', import.meta.url)));
for (const draft of ['es', 'pt', 'de', 'fr', 'ja']) {
  assert.ok(!existsSync(new URL(`../dist/${draft}/404.html`, import.meta.url)), `Draft ${draft} must not have 404.html`);
  assert.ok(!existsSync(new URL(`../dist/${draft}/404/index.html`, import.meta.url)), `Draft ${draft} must not have /404/ directory`);
  assert.doesNotMatch(notFound, new RegExp(`hreflang="${draft}"`));
}
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort();
const expectedUrls = [
  'https://thetoolproject.com/',
  'https://thetoolproject.com/about/',
  'https://thetoolproject.com/contact/',
  'https://thetoolproject.com/json-to-html/',
  'https://thetoolproject.com/json-to-excel/',
  'https://thetoolproject.com/json-to-csv/',
  'https://thetoolproject.com/json-beautifier/',
  'https://thetoolproject.com/xml-to-csv/',
  'https://thetoolproject.com/xml-to-json/',
  'https://thetoolproject.com/excel-to-csv/',
  'https://thetoolproject.com/dbf-to-excel/',
  'https://thetoolproject.com/csv-to-sql/',
  'https://thetoolproject.com/csv-viewer/',
  'https://thetoolproject.com/csv-to-json/',
  'https://thetoolproject.com/qr-code-scanner/',
  'https://thetoolproject.com/image-resizer/',
  'https://thetoolproject.com/compress-jpg-to-100kb/',
  'https://thetoolproject.com/compress-jpg-to-50kb/',
  'https://thetoolproject.com/compress-pdf/',
  'https://thetoolproject.com/compress-pdf-to-100kb/',
  'https://thetoolproject.com/compress-pdf-to-200kb/',
  'https://thetoolproject.com/compress-pdf-to-500kb/',
  'https://thetoolproject.com/privacy/',
  'https://thetoolproject.com/terms/',
  ...(hasGuides ? ['https://thetoolproject.com/guides/json-syntax-square-brackets/', 'https://thetoolproject.com/guides/json-to-csv/', 'https://thetoolproject.com/guides/json/'] : []),
].sort();
assert.deepEqual(sitemapUrls, expectedUrls);
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
const sizes = Object.fromEntries(['json-to-html', 'json-to-excel', 'json-to-csv', 'json-beautifier', 'xml-to-csv', 'xml-to-json', 'excel-to-csv', 'dbf-to-excel', 'csv-to-sql', 'csv-viewer', 'csv-to-json', 'qr-code-scanner', 'image-resizer', 'compress-jpg-to-100kb', 'compress-jpg-to-50kb', 'compress-pdf', 'compress-pdf-to-100kb', 'compress-pdf-to-200kb', 'compress-pdf-to-500kb'].map(page => [page, firstLoad(`${page}/index.html`)]));
// The DBF script shares the translation helper chunk, so Astro references it as an external module.
assert.match(dbfExcel, /<script type="module" src="\/_astro\/[^"]+"/);
for (const [page, size] of Object.entries(sizes)) assert.ok(size.gzip < 10000, `First-load JavaScript for ${page} is ${size.gzip} bytes gzipped`);
assert.ok(readdirSync(jsDir).some(name => name.startsWith('cpexcel.') && name.endsWith('.js')), 'Legacy .xls code pages are a separate chunk');
console.log(`Built output checks passed. First-load JS: ${Object.entries(sizes).map(([page, size]) => `${page} ${size.gzip} bytes gzip (${size.raw} raw)`).join(', ')}.`);
