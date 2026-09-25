import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const read = path => readFileSync(new URL(`../dist/${path}`, import.meta.url), 'utf8');
const tool = read('json-to-html/index.html');
const excel = read('excel-to-csv/index.html');
const jsonExcel = read('json-to-excel/index.html');
const jsonCsv = read('json-to-csv/index.html');
const xmlCsv = read('xml-to-csv/index.html');
const xmlJson = read('xml-to-json/index.html');
const csvSql = read('csv-to-sql/index.html');
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
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort();
const expectedUrls = [
  'https://thetoolproject.com/',
  'https://thetoolproject.com/about/',
  'https://thetoolproject.com/contact/',
  'https://thetoolproject.com/json-to-html/',
  'https://thetoolproject.com/json-to-excel/',
  'https://thetoolproject.com/json-to-csv/',
  'https://thetoolproject.com/xml-to-csv/',
  'https://thetoolproject.com/xml-to-json/',
  'https://thetoolproject.com/excel-to-csv/',
  'https://thetoolproject.com/csv-to-sql/',
  'https://thetoolproject.com/privacy/',
  'https://thetoolproject.com/terms/',
  ...(hasGuides ? ['https://thetoolproject.com/guides/json-syntax-square-brackets/', 'https://thetoolproject.com/guides/json-to-csv/', 'https://thetoolproject.com/guides/json/'] : []),
].sort();
assert.deepEqual(sitemapUrls, expectedUrls);
assert.ok(existsSync(new URL('../dist/404.html', import.meta.url)));
const jsDir = new URL('../dist/_astro/', import.meta.url);
// First-load JS is every module script the page itself references; workers and their chunks load later.
const firstLoad = page => {
  const files = [...read(page).matchAll(/<script type="module" src="\/_astro\/([^"]+)"/g)].map(match => readFileSync(new URL(match[1], jsDir)));
  assert.ok(files.length, `${page} has a client script`);
  return { raw: files.reduce((sum, file) => sum + file.length, 0), gzip: files.reduce((sum, file) => sum + gzipSync(file).length, 0) };
};
const sizes = Object.fromEntries(['json-to-html', 'json-to-excel', 'json-to-csv', 'xml-to-csv', 'xml-to-json', 'excel-to-csv', 'csv-to-sql'].map(page => [page, firstLoad(`${page}/index.html`)]));
for (const [page, size] of Object.entries(sizes)) assert.ok(size.gzip < 10000, `First-load JavaScript for ${page} is ${size.gzip} bytes gzipped`);
assert.ok(readdirSync(jsDir).some(name => name.startsWith('cpexcel.') && name.endsWith('.js')), 'Legacy .xls code pages are a separate chunk');
console.log(`Built output checks passed. First-load JS: ${Object.entries(sizes).map(([page, size]) => `${page} ${size.gzip} bytes gzip (${size.raw} raw)`).join(', ')}.`);
