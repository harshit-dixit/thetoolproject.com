// Only reviewed, activated URL changes belong here. Naming candidates stay in docs.
// Keys are kind / stable item.id / locale, never dictionary or registry keys.
// Each change must retain its baseline path and every subsequently public alias:
// tool: { 'word-counter': { de: { path: '/de/woerterzaehler/',
//   previousPaths: ['/de/word-counter/'] } } }
// When renaming again, append the outgoing canonical to previousPaths; keep all
// older aliases. The generator sends each alias directly to the latest path.
/** @typedef {{ path: string, previousPaths: string[] }} LocalizedPathChange */
/** @typedef {Record<string, Record<string, LocalizedPathChange>>} KindPaths */
/** @typedef {{ tool: KindPaths, page: KindPaths }} LocalizedPathMap */

/** @type {LocalizedPathMap} */
export const localizedPaths = {
  tool: {
    'compress-pdf': {
      de: { path: '/de/pdf-komprimieren/', previousPaths: ['/de/compress-pdf/'] },
      es: { path: '/es/comprimir-pdf/', previousPaths: ['/es/compress-pdf/'] },
      pt: { path: '/pt/comprimir-pdf/', previousPaths: ['/pt/compress-pdf/'] },
      fr: { path: '/fr/compresser-pdf/', previousPaths: ['/fr/compress-pdf/'] },
    },
    'compress-pdf-to-100kb': {
      de: { path: '/de/pdf-komprimieren-auf-100kb/', previousPaths: ['/de/compress-pdf-to-100kb/'] },
      es: { path: '/es/comprimir-pdf-a-100kb/', previousPaths: ['/es/compress-pdf-to-100kb/'] },
      pt: { path: '/pt/comprimir-pdf-para-100kb/', previousPaths: ['/pt/compress-pdf-to-100kb/'] },
      fr: { path: '/fr/compresser-pdf-a-100kb/', previousPaths: ['/fr/compress-pdf-to-100kb/'] },
    },
    'compress-pdf-to-200kb': {
      de: { path: '/de/pdf-komprimieren-auf-200kb/', previousPaths: ['/de/compress-pdf-to-200kb/'] },
      es: { path: '/es/comprimir-pdf-a-200kb/', previousPaths: ['/es/compress-pdf-to-200kb/'] },
      pt: { path: '/pt/comprimir-pdf-para-200kb/', previousPaths: ['/pt/compress-pdf-to-200kb/'] },
      fr: { path: '/fr/compresser-pdf-a-200kb/', previousPaths: ['/fr/compress-pdf-to-200kb/'] },
    },
    'compress-pdf-to-500kb': {
      de: { path: '/de/pdf-komprimieren-auf-500kb/', previousPaths: ['/de/compress-pdf-to-500kb/'] },
      es: { path: '/es/comprimir-pdf-a-500kb/', previousPaths: ['/es/compress-pdf-to-500kb/'] },
      pt: { path: '/pt/comprimir-pdf-para-500kb/', previousPaths: ['/pt/compress-pdf-to-500kb/'] },
      fr: { path: '/fr/compresser-pdf-a-500kb/', previousPaths: ['/fr/compress-pdf-to-500kb/'] },
    },
    'image-resizer': {
      de: { path: '/de/bildgroesse-aendern/', previousPaths: ['/de/image-resizer/'] },
      es: { path: '/es/redimensionar-imagenes/', previousPaths: ['/es/image-resizer/'] },
      pt: { path: '/pt/redimensionar-imagens/', previousPaths: ['/pt/image-resizer/'] },
      fr: { path: '/fr/redimensionner-images/', previousPaths: ['/fr/image-resizer/'] },
    },
    'compress-jpg-to-100kb': {
      de: { path: '/de/jpg-komprimieren-auf-100kb/', previousPaths: ['/de/compress-jpg-to-100kb/'] },
      es: { path: '/es/comprimir-jpg-a-100kb/', previousPaths: ['/es/compress-jpg-to-100kb/'] },
      pt: { path: '/pt/comprimir-jpg-para-100kb/', previousPaths: ['/pt/compress-jpg-to-100kb/'] },
      fr: { path: '/fr/compresser-jpg-a-100kb/', previousPaths: ['/fr/compress-jpg-to-100kb/'] },
    },
    'compress-jpg-to-50kb': {
      de: { path: '/de/jpg-komprimieren-auf-50kb/', previousPaths: ['/de/compress-jpg-to-50kb/'] },
      es: { path: '/es/comprimir-jpg-a-50kb/', previousPaths: ['/es/compress-jpg-to-50kb/'] },
      pt: { path: '/pt/comprimir-jpg-para-50kb/', previousPaths: ['/pt/compress-jpg-to-50kb/'] },
      fr: { path: '/fr/compresser-jpg-a-50kb/', previousPaths: ['/fr/compress-jpg-to-50kb/'] },
    },
    'webp-converter': {
      de: { path: '/de/webp-konverter/', previousPaths: ['/de/webp-converter/'] },
      es: { path: '/es/convertidor-webp/', previousPaths: ['/es/webp-converter/'] },
      pt: { path: '/pt/conversor-webp/', previousPaths: ['/pt/webp-converter/'] },
      fr: { path: '/fr/convertisseur-webp/', previousPaths: ['/fr/webp-converter/'] },
    },
    'webp-to-png': {
      de: { path: '/de/webp-in-png/', previousPaths: ['/de/webp-to-png/'] },
      es: { path: '/es/webp-a-png/', previousPaths: ['/es/webp-to-png/'] },
      pt: { path: '/pt/webp-para-png/', previousPaths: ['/pt/webp-to-png/'] },
      fr: { path: '/fr/webp-en-png/', previousPaths: ['/fr/webp-to-png/'] },
    },
    'webp-to-jpg': {
      de: { path: '/de/webp-in-jpg/', previousPaths: ['/de/webp-to-jpg/'] },
      es: { path: '/es/webp-a-jpg/', previousPaths: ['/es/webp-to-jpg/'] },
      pt: { path: '/pt/webp-para-jpg/', previousPaths: ['/pt/webp-to-jpg/'] },
      fr: { path: '/fr/webp-en-jpg/', previousPaths: ['/fr/webp-to-jpg/'] },
    },
    'webp-to-gif': {
      de: { path: '/de/webp-in-gif/', previousPaths: ['/de/webp-to-gif/'] },
      es: { path: '/es/webp-a-gif/', previousPaths: ['/es/webp-to-gif/'] },
      pt: { path: '/pt/webp-para-gif/', previousPaths: ['/pt/webp-to-gif/'] },
      fr: { path: '/fr/webp-en-gif/', previousPaths: ['/fr/webp-to-gif/'] },
    },
    'webp-to-svg': {
      de: { path: '/de/webp-in-svg/', previousPaths: ['/de/webp-to-svg/'] },
      es: { path: '/es/webp-a-svg/', previousPaths: ['/es/webp-to-svg/'] },
      pt: { path: '/pt/webp-para-svg/', previousPaths: ['/pt/webp-to-svg/'] },
      fr: { path: '/fr/webp-en-svg/', previousPaths: ['/fr/webp-to-svg/'] },
    },
    'video-to-gif': {
      de: { path: '/de/video-in-gif/', previousPaths: ['/de/video-to-gif/'] },
      es: { path: '/es/video-a-gif/', previousPaths: ['/es/video-to-gif/'] },
      pt: { path: '/pt/video-para-gif/', previousPaths: ['/pt/video-to-gif/'] },
      fr: { path: '/fr/video-en-gif/', previousPaths: ['/fr/video-to-gif/'] },
    },
    'csv-to-json': {
      de: { path: '/de/csv-zu-json/', previousPaths: ['/de/csv-to-json/'] },
      es: { path: '/es/csv-a-json/', previousPaths: ['/es/csv-to-json/'] },
      pt: { path: '/pt/csv-para-json/', previousPaths: ['/pt/csv-to-json/'] },
      fr: { path: '/fr/csv-en-json/', previousPaths: ['/fr/csv-to-json/'] },
    },
    'csv-viewer': {
      de: { path: '/de/csv-betrachter/', previousPaths: ['/de/csv-viewer/'] },
      es: { path: '/es/visor-csv/', previousPaths: ['/es/csv-viewer/'] },
      pt: { path: '/pt/visualizador-csv/', previousPaths: ['/pt/csv-viewer/'] },
      fr: { path: '/fr/visionneuse-csv/', previousPaths: ['/fr/csv-viewer/'] },
    },
    'har-analyzer': {
      de: { path: '/de/har-analysator/', previousPaths: ['/de/har-analyzer/'] },
      es: { path: '/es/analizador-har/', previousPaths: ['/es/har-analyzer/'] },
      pt: { path: '/pt/analisador-har/', previousPaths: ['/pt/har-analyzer/'] },
      fr: { path: '/fr/analyseur-har/', previousPaths: ['/fr/har-analyzer/'] },
    },
    'json-beautifier': {
      de: { path: '/de/json-formatieren/', previousPaths: ['/de/json-beautifier/'] },
      es: { path: '/es/formatear-json/', previousPaths: ['/es/json-beautifier/'] },
      pt: { path: '/pt/formatar-json/', previousPaths: ['/pt/json-beautifier/'] },
      fr: { path: '/fr/formater-json/', previousPaths: ['/fr/json-beautifier/'] },
    },
    'word-counter': {
      de: { path: '/de/woerterzaehler/', previousPaths: ['/de/word-counter/'] },
      es: { path: '/es/contador-de-palabras/', previousPaths: ['/es/word-counter/'] },
      pt: { path: '/pt/contador-de-palavras/', previousPaths: ['/pt/word-counter/'] },
      fr: { path: '/fr/compteur-de-mots/', previousPaths: ['/fr/word-counter/'] },
    },
    'tip-calculator': {
      de: { path: '/de/trinkgeldrechner/', previousPaths: ['/de/tip-calculator/'] },
      es: { path: '/es/calculadora-de-propinas/', previousPaths: ['/es/tip-calculator/'] },
      pt: { path: '/pt/calculadora-de-gorjeta/', previousPaths: ['/pt/tip-calculator/'] },
      fr: { path: '/fr/calculateur-de-pourboire/', previousPaths: ['/fr/tip-calculator/'] },
    },
    'high-school-gpa-calculator': {
      de: { path: '/de/high-school-gpa-rechner/', previousPaths: ['/de/high-school-gpa-calculator/'] },
      es: { path: '/es/calculadora-gpa-high-school/', previousPaths: ['/es/high-school-gpa-calculator/'] },
      pt: { path: '/pt/calculadora-gpa-high-school/', previousPaths: ['/pt/high-school-gpa-calculator/'] },
      fr: { path: '/fr/calculateur-gpa-high-school/', previousPaths: ['/fr/high-school-gpa-calculator/'] },
    },
    'gpa-calculator': {
      de: { path: '/de/gpa-rechner/', previousPaths: ['/de/gpa-calculator/'] },
      es: { path: '/es/calculadora-gpa/', previousPaths: ['/es/gpa-calculator/'] },
      pt: { path: '/pt/calculadora-gpa/', previousPaths: ['/pt/gpa-calculator/'] },
      fr: { path: '/fr/calculateur-gpa/', previousPaths: ['/fr/gpa-calculator/'] },
    },
    'auto-loan-calculator': {
      de: { path: '/de/autokreditrechner/', previousPaths: ['/de/auto-loan-calculator/'] },
      es: { path: '/es/calculadora-de-prestamo-de-auto/', previousPaths: ['/es/auto-loan-calculator/'] },
      pt: { path: '/pt/simulador-de-financiamento-de-veiculo/', previousPaths: ['/pt/auto-loan-calculator/'] },
      fr: { path: '/fr/calculateur-credit-auto/', previousPaths: ['/fr/auto-loan-calculator/'] },
    },
    'age-calculator': {
      de: { path: '/de/altersrechner/', previousPaths: ['/de/age-calculator/'] },
      es: { path: '/es/calculadora-de-edad/', previousPaths: ['/es/age-calculator/'] },
      pt: { path: '/pt/calculadora-de-idade/', previousPaths: ['/pt/age-calculator/'] },
      fr: { path: '/fr/calculateur-age/', previousPaths: ['/fr/age-calculator/'] },
    },
    'dice-roller': {
      de: { path: '/de/wuerfel-werfen/', previousPaths: ['/de/dice-roller/'] },
      es: { path: '/es/lanzar-dados/', previousPaths: ['/es/dice-roller/'] },
      pt: { path: '/pt/rolar-dados/', previousPaths: ['/pt/dice-roller/'] },
      fr: { path: '/fr/lancer-des/', previousPaths: ['/fr/dice-roller/'] },
    },
    'volume-calculator': {
      de: { path: '/de/volumenrechner/', previousPaths: ['/de/volume-calculator/'] },
      es: { path: '/es/calculadora-de-volumen/', previousPaths: ['/es/volume-calculator/'] },
      pt: { path: '/pt/calculadora-de-volume/', previousPaths: ['/pt/volume-calculator/'] },
      fr: { path: '/fr/calculateur-volume/', previousPaths: ['/fr/volume-calculator/'] },
    },
    'area-calculator': {
      de: { path: '/de/flaechenrechner/', previousPaths: ['/de/area-calculator/'] },
      es: { path: '/es/calculadora-de-area/', previousPaths: ['/es/area-calculator/'] },
      pt: { path: '/pt/calculadora-de-area/', previousPaths: ['/pt/area-calculator/'] },
      fr: { path: '/fr/calculateur-surface/', previousPaths: ['/fr/area-calculator/'] },
    },
    'csv-to-sql': {
      de: { path: '/de/csv-zu-sql/', previousPaths: ['/de/csv-to-sql/'] },
      es: { path: '/es/csv-a-sql/', previousPaths: ['/es/csv-to-sql/'] },
      pt: { path: '/pt/csv-para-sql/', previousPaths: ['/pt/csv-to-sql/'] },
      fr: { path: '/fr/csv-en-sql/', previousPaths: ['/fr/csv-to-sql/'] },
    },
    'json-to-html': {
      de: { path: '/de/json-zu-html/', previousPaths: ['/de/json-to-html/'] },
      es: { path: '/es/json-a-html/', previousPaths: ['/es/json-to-html/'] },
      pt: { path: '/pt/json-para-html/', previousPaths: ['/pt/json-to-html/'] },
      fr: { path: '/fr/json-en-html/', previousPaths: ['/fr/json-to-html/'] },
    },
    'json-to-excel': {
      de: { path: '/de/json-zu-excel/', previousPaths: ['/de/json-to-excel/'] },
      es: { path: '/es/json-a-excel/', previousPaths: ['/es/json-to-excel/'] },
      pt: { path: '/pt/json-para-excel/', previousPaths: ['/pt/json-to-excel/'] },
      fr: { path: '/fr/json-en-excel/', previousPaths: ['/fr/json-to-excel/'] },
    },
    'json-to-csv': {
      de: { path: '/de/json-zu-csv/', previousPaths: ['/de/json-to-csv/'] },
      es: { path: '/es/json-a-csv/', previousPaths: ['/es/json-to-csv/'] },
      pt: { path: '/pt/json-para-csv/', previousPaths: ['/pt/json-to-csv/'] },
      fr: { path: '/fr/json-en-csv/', previousPaths: ['/fr/json-to-csv/'] },
    },
    'xml-to-csv': {
      de: { path: '/de/xml-zu-csv/', previousPaths: ['/de/xml-to-csv/'] },
      es: { path: '/es/xml-a-csv/', previousPaths: ['/es/xml-to-csv/'] },
      pt: { path: '/pt/xml-para-csv/', previousPaths: ['/pt/xml-to-csv/'] },
      fr: { path: '/fr/xml-en-csv/', previousPaths: ['/fr/xml-to-csv/'] },
    },
    'xml-to-json': {
      de: { path: '/de/xml-zu-json/', previousPaths: ['/de/xml-to-json/'] },
      es: { path: '/es/xml-a-json/', previousPaths: ['/es/xml-to-json/'] },
      pt: { path: '/pt/xml-para-json/', previousPaths: ['/pt/xml-to-json/'] },
      fr: { path: '/fr/xml-en-json/', previousPaths: ['/fr/xml-to-json/'] },
    },
    'excel-to-csv': {
      de: { path: '/de/excel-zu-csv/', previousPaths: ['/de/excel-to-csv/'] },
      es: { path: '/es/excel-a-csv/', previousPaths: ['/es/excel-to-csv/'] },
      pt: { path: '/pt/excel-para-csv/', previousPaths: ['/pt/excel-to-csv/'] },
      fr: { path: '/fr/excel-en-csv/', previousPaths: ['/fr/excel-to-csv/'] },
    },
    'dbf-to-excel': {
      de: { path: '/de/dbf-zu-excel/', previousPaths: ['/de/dbf-to-excel/'] },
      es: { path: '/es/dbf-a-excel/', previousPaths: ['/es/dbf-to-excel/'] },
      pt: { path: '/pt/dbf-para-excel/', previousPaths: ['/pt/dbf-to-excel/'] },
      fr: { path: '/fr/dbf-en-excel/', previousPaths: ['/fr/dbf-to-excel/'] },
    },
    'eml-to-pdf': {
      de: { path: '/de/eml-in-pdf/', previousPaths: ['/de/eml-to-pdf/'] },
      es: { path: '/es/eml-a-pdf/', previousPaths: ['/es/eml-to-pdf/'] },
      pt: { path: '/pt/eml-para-pdf/', previousPaths: ['/pt/eml-to-pdf/'] },
      fr: { path: '/fr/eml-en-pdf/', previousPaths: ['/fr/eml-to-pdf/'] },
    },
    'mht-to-pdf': {
      de: { path: '/de/mht-in-pdf/', previousPaths: ['/de/mht-to-pdf/'] },
      es: { path: '/es/mht-a-pdf/', previousPaths: ['/es/mht-to-pdf/'] },
      pt: { path: '/pt/mht-para-pdf/', previousPaths: ['/pt/mht-to-pdf/'] },
      fr: { path: '/fr/mht-en-pdf/', previousPaths: ['/fr/mht-to-pdf/'] },
    },
    'qr-code-scanner': {
      es: { path: '/es/escaner-de-codigos-qr/', previousPaths: ['/es/qr-code-scanner/'] },
      pt: { path: '/pt/leitor-de-codigo-qr/', previousPaths: ['/pt/qr-code-scanner/'] },
      fr: { path: '/fr/scanner-code-qr/', previousPaths: ['/fr/qr-code-scanner/'] },
    },
  },
  page: {
    'about': {
      de: { path: '/de/ueber-uns/', previousPaths: ['/de/about/'] },
      es: { path: '/es/acerca-de/', previousPaths: ['/es/about/'] },
      pt: { path: '/pt/sobre/', previousPaths: ['/pt/about/'] },
      fr: { path: '/fr/a-propos/', previousPaths: ['/fr/about/'] },
    },
    'contact': {
      de: { path: '/de/kontakt/', previousPaths: ['/de/contact/'] },
      es: { path: '/es/contacto/', previousPaths: ['/es/contact/'] },
      pt: { path: '/pt/contato/', previousPaths: ['/pt/contact/'] },
    },
    'privacy': {
      de: { path: '/de/datenschutzerklaerung/', previousPaths: ['/de/privacy/'] },
      es: { path: '/es/politica-de-privacidad/', previousPaths: ['/es/privacy/'] },
      pt: { path: '/pt/politica-de-privacidade/', previousPaths: ['/pt/privacy/'] },
      fr: { path: '/fr/politique-de-confidentialite/', previousPaths: ['/fr/privacy/'] },
    },
    'terms': {
      de: { path: '/de/nutzungsbedingungen/', previousPaths: ['/de/terms/'] },
      es: { path: '/es/terminos-de-uso/', previousPaths: ['/es/terms/'] },
      pt: { path: '/pt/termos-de-uso/', previousPaths: ['/pt/terms/'] },
      fr: { path: '/fr/conditions-utilisation/', previousPaths: ['/fr/terms/'] },
    },
  },
};

/** Explicit factory overrides take precedence over this shared default. */
export function getLocalizedPath(kind, id, locale, defaultPath, mapping = localizedPaths) {
  return mapping[kind]?.[id]?.[locale]?.path ?? defaultPath;
}
