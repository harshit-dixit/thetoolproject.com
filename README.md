# thetoolproject.com

<p align="center">
  <strong>Fast, clean, privacy-first web utilities and developer tools.</strong><br>
  Every tool runs 100% in your browser. No server uploads. No bloat.
</p>

<p align="center">
  <a href="https://thetoolproject.com"><strong>thetoolproject.com</strong></a>
</p>

<p align="center">
  <a href="https://github.com/harshit-dixit/thetoolproject.com/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://astro.build"><img src="https://img.shields.io/badge/built%20with-Astro%20v7-ff5d01.svg?style=flat-square" alt="Built with Astro"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/language-TypeScript-3178c6.svg?style=flat-square" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg?style=flat-square" alt="Node >= 22.12.0">
  <img src="https://img.shields.io/badge/processing-100%25%20client--side-success.svg?style=flat-square" alt="100% Client-Side">
</p>

---

## Highlights

- **100% Client-Side and Private:** Files and data never leave your device. All parsing, conversions, image processing, and QR decoding execute directly in your browser.
- **Blazing Fast:** Powered by Astro static generation with zero unnecessary client JavaScript hydration. Heavy computation is isolated into dedicated Web Workers so the UI remains fluid.
- **Distraction-Free UX:** No ads, no popups, and no multi-step marketing funnels. The tool is the page.
- **Internationalized (i18n):** Multi-locale architecture built for global users (`en`, `es`, `pt`, `de`, `fr`, `ja`).
- **Fully Tested:** Automated test suite with Vitest unit tests, Playwright end-to-end browser tests, translation validation, and production build checks.

---

## Available Tools

### Data and File Converters

| Tool | Description |
|---|---|
| **[CSV to JSON](https://thetoolproject.com/csv-to-json/)** | Convert CSV or TSV to JSON or JSON Lines with delimiter autodetection, data-type inference, and live preview. |
| **[JSON to CSV](https://thetoolproject.com/json-to-csv/)** | Convert JSON arrays or nested objects into clean tabular CSV with custom delimiters and immediate download. |
| **[JSON to Excel](https://thetoolproject.com/json-to-excel/)** | Transform JSON datasets into native `.xlsx` workbooks generated inside a Web Worker. |
| **[Excel to CSV](https://thetoolproject.com/excel-to-csv/)** | Extract sheets from Excel workbooks (`.xlsx`, `.xls`) to clean CSV files locally. |
| **[DBF to Excel](https://thetoolproject.com/dbf-to-excel/)** | Convert dBASE/FoxPro `.dbf` tables to Excel `.xlsx` with record preview and legacy text encoding selection. |
| **[EML to PDF](https://thetoolproject.com/eml-to-pdf/)** | Convert `.eml` emails to PDF with selectable text, sender/recipient header table, inline images, clickable links, and optional embedded attachments. |
| **[MHT to PDF](https://thetoolproject.com/mht-to-pdf/)** | Convert `.mht` and `.mhtml` web archives to PDF with selectable text, links and saved images, or print the page with its original layout. |
| **[XML to JSON](https://thetoolproject.com/xml-to-json/)** | High-performance XML parser converting complex XML tree structures into idiomatic JSON via streaming SAX. |
| **[XML to CSV](https://thetoolproject.com/xml-to-csv/)** | Flatten XML record hierarchies directly into CSV format without memory exhaustion. |
| **[CSV to SQL](https://thetoolproject.com/csv-to-sql/)** | Generate batch SQL `INSERT` statements from CSV data for PostgreSQL, MySQL, SQLite, and SQL Server. |
| **[JSON to HTML](https://thetoolproject.com/json-to-html/)** | Transform JSON payloads into responsive HTML markup and clean data tables. |

### Developer Utilities

| Tool | Description |
|---|---|
| **[JSON Beautifier](https://thetoolproject.com/json-beautifier/)** | Validate, format, and beautify JSON with configurable indentation, error markers, and single-click copy. |
| **[CSV Viewer](https://thetoolproject.com/csv-viewer/)** | Open large CSV/TSV files in browser, search, sort, filter, inline edit, and re-export to CSV or JSON. |
| **[HAR Analyzer](https://thetoolproject.com/har-analyzer/)** | Open a `.har` file from Chrome, Edge, Firefox or Safari: every request with its status, size, timing and a waterfall, filters for errors and request types, headers, payload, response and timing for each request, and a copy without cookies to share. |

### Text Utilities

| Tool | Description |
|---|---|
| **[Word Counter](https://thetoolproject.com/word-counter/)** | Count words and characters (with and without spaces), letters, sentences, paragraphs, reading time and keyword density as you type, with an optional character or word limit. |

### Calculators

| Tool | Description |
|---|---|
| **[Age Calculator](https://thetoolproject.com/age-calculator/)** | Find an exact age from a date of birth in years, months and days, on today or any date, with totals in months, weeks, days, hours and minutes, the weekday of the birth and a countdown to the next birthday. Handles leap-day birthdays and works for babies and children. |
| **[Tip Calculator](https://thetoolproject.com/tip-calculator/)** | Work out the tip and total, tip before or after tax, split the bill between up to 100 people and round up each share, in 27 currencies. The Japanese page is a bill splitter (割り勘). |
| **[High School GPA Calculator](https://thetoolproject.com/high-school-gpa-calculator/)** | Work out your unweighted and weighted GPA from letter or percent grades, with honors and AP/IB classes, with or without credits, and combine it with an earlier GPA. Classes are saved in your browser. |
| **[GPA Calculator](https://thetoolproject.com/gpa-calculator/)** | Work out your college GPA by credit hours for each semester and cumulatively, add your GPA so far, plan the average you need for your final GPA, and see where you stand for cum laude. |
| **[Auto Loan Calculator](https://thetoolproject.com/auto-loan-calculator/)** | Work out your monthly car payment for a new or used car with the down payment, trade-in (including negative equity), sales tax and fees, compare 36 to 84 month terms, see the amortization schedule by year or month, and check whether refinancing saves money. Shows average US car payments and auto loan rates by credit score. |
| **[Dice Roller](https://thetoolproject.com/dice-roller/)** | Roll one die or up to 50: d4, d6, d8, d10, d12, d20, d100 or 2 to 1,000 sides, with a modifier, advantage and disadvantage, 4d6 drop lowest for D&D ability scores, the last 10 rolls and a full screen mode. Uses the browser's secure random numbers, so every face is equally likely. |
| **[Volume Calculator](https://thetoolproject.com/volume-calculator/)** | Find the volume of a cylinder, rectangular box, cube, cone, sphere, hemisphere, pyramid or triangular prism, how much a pipe holds, or how much liquid is in a vertical, horizontal or rectangular tank, with the formula worked out and the answer in cubic units, liters and US or imperial gallons. |
| **[Area Calculator](https://thetoolproject.com/area-calculator/)** | Find the area of a rectangle, square, triangle (from base and height or three sides), circle, trapezoid, parallelogram or ellipse, or the surface area of a cube, box, cylinder, cone, sphere or square pyramid, with the perimeter, the formula worked out and the answer in acres and hectares. |

### PDF Utilities

| Tool | Description |
|---|---|
| **[Compress PDF](https://thetoolproject.com/compress-pdf/)** | Reduce PDF file size with visual compression or a text-preserving mode, and compare exact before/after sizes. |
| **[Compress PDF to 100KB](https://thetoolproject.com/compress-pdf-to-100kb/)** | Target-driven PDF compression aiming for 100 KB or less, with the measured result shown before download. |
| **[Compress PDF to 200KB](https://thetoolproject.com/compress-pdf-to-200kb/)** | Target-driven PDF compression aiming for 200 KB or less, with before and after sizes compared. |
| **[Compress PDF to 500KB](https://thetoolproject.com/compress-pdf-to-500kb/)** | Target-driven PDF compression aiming for 500 KB or less, with the measured output size checked before download. |

### Media and Visual Utilities

| Tool | Description |
|---|---|
| **[Image Resizer](https://thetoolproject.com/image-resizer/)** | Resize single or batch images (up to 20 files) by exact pixels, percentage, or centimeters, with KB target limits. |
| **[WebP converter](https://thetoolproject.com/webp-converter/)** | Convert WebP images to PNG, JPG, GIF or SVG, one at a time, in batches of up to 200, or from a ZIP file, with a ZIP download. |
| **[WebP to PNG](https://thetoolproject.com/webp-to-png/)** | Lossless WebP to PNG conversion that keeps transparency, for single images, batches and ZIP files. |
| **[WebP to JPG (JPEG)](https://thetoolproject.com/webp-to-jpg/)** | WebP to JPG with a quality choice and a white or black fill for transparent areas. |
| **[WebP to GIF](https://thetoolproject.com/webp-to-gif/)** | Animated WebP to animated GIF with every frame, its timing and the loop setting (ImageDecoder + gifenc). |
| **[WebP to SVG](https://thetoolproject.com/webp-to-svg/)** | Trace WebP logos and icons into real vector paths (imagetracerjs), or embed the exact pixels in an SVG. |
| **[Video to GIF](https://thetoolproject.com/video-to-gif/)** | Turn an MP4, MOV or WebM clip into an animated GIF: pick the start and end from the player, the width, frame rate (5–25 fps), speed and loop. Frames are read with the browser's own video player and encoded with gifenc in a Web Worker, so nothing is uploaded. |
| **[Compress JPG to 100KB](https://thetoolproject.com/compress-jpg-to-100kb/)** | Target-driven canvas compression reducing JPG files to under 100 KB with real-time size readout. |
| **[Compress JPG to 50KB](https://thetoolproject.com/compress-jpg-to-50kb/)** | Target-driven canvas compression reducing JPG files to 50 KB or less with exact file size shown before download. |
| **[QR Code Scanner](https://thetoolproject.com/qr-code-scanner/)** | Scan QR codes via live webcam stream or decode from screenshots and image files using WebAssembly (`zxing-wasm`). |

---

## Architecture and Tech Stack

```
thetoolproject.com
├── Astro v7            Static site generation, zero-JS baseline, directory routing
├── TypeScript          Type-safe models, tools catalog, and worker communications
├── Web Workers         Dedicated thread isolation for CPU-intensive data transformations
├── Squeeze Design      Direct, flat aesthetic with Archivo variable typography & pure CSS tokens
├── Core Engines
│   ├── SheetJS (xlsx)  Native Excel workbook parsing & generation
│   ├── saxes           Streaming event-driven XML SAX parser
│   ├── pdf-lib         PDF building for EML to PDF, MHT to PDF and Compress PDF (Noto Sans, SIL OFL, via fontkit)
│   ├── gifenc          GIF encoding for WebP to GIF (per-frame 256-color palettes)
│   ├── imagetracerjs   Bitmap-to-vector tracing for WebP to SVG
│   └── zxing-wasm      WebAssembly-powered barcode & QR computer vision
└── Quality Assurance
    ├── Vitest          Unit tests for core parsing algorithms
    └── Playwright      Headless browser automation & cross-tool verification
```

### Privacy by Design

Unlike traditional online converters that upload files to third-party cloud servers:
1. **Zero Uploads:** Sensitive CSVs, financial sheets, images, and credentials never touch a remote backend.
2. **Zero Storage:** Files are read into browser memory (`ArrayBuffer` / `Blob`), transformed in-place, and downloaded directly via `URL.createObjectURL`.
3. **Minimal Analytics:** Google Analytics records page views and tool usage (button clicks, whether a conversion succeeded, a file's type and size range). File names, file contents, pasted text, and results never leave the browser. No advertising telemetry.

---

## Local Development

### Prerequisites

- **Node.js:** `>=22.12.0`
- **Package Manager:** `npm` (included with Node)

### 1. Clone the repository

```bash
git clone https://github.com/harshit-dixit/thetoolproject.com.git
cd thetoolproject.com
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start development server

```bash
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser to view the site.

---

## Testing and Validation

```bash
# Run unit tests
npm test

# Verify translations consistency across locales
node scripts/check-translations.mjs

# Test build verification
npm run test:build

# Build production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## Project Structure

```
thetoolproject.com/
├── public/                 # Static assets, fonts, icons, sitemap
├── scripts/                # Browser automation, build checks, and translation validators
├── src/
│   ├── components/         # Astro tool components (CSV, JSON, XML, DBF, PDF, Image, QR)
│   ├── data/
│   │   └── tools.ts        # Canonical tool registry, metadata & i18n route mapping
│   ├── i18n/               # Localization strings (en, es, pt, de, fr, ja)
│   ├── layouts/            # Base HTML & semantic page shell layouts
│   ├── lib/                # Shared utilities, stream helpers, type definitions
│   ├── pages/              # Astro file-based routes and dynamic tool router
│   ├── styles/             # Global design tokens, typography, and utility CSS
│   └── workers/            # Dedicated Web Worker scripts for background execution
├── astro.config.mjs        # Astro configuration & i18n routing setup
├── package.json            # Scripts and dependency specifications
└── tsconfig.json           # TypeScript configuration
```

---

## Contributing

Contributions, feature requests, and bug reports are welcome.

1. **Fork** the repository
2. **Create your feature branch:**
   ```bash
   git checkout -b feature/new-tool-name
   ```
3. **Implement your changes:**
   - Add your tool worker in `src/workers/`
   - Create your UI component in `src/components/`
   - Register the tool in `src/data/tools.ts`
   - Add unit and browser checks in `scripts/`
4. **Run the test suite:**
   ```bash
   npm test
   npm run build
   npm run test:build
   ```
5. **Commit your changes and push:**
   ```bash
   git commit -m "feat: add new tool"
   git push origin feature/new-tool-name
   ```
6. **Open a Pull Request**

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

The bundled Archivo font is licensed separately under the
[SIL Open Font License 1.1](public/fonts/OFL.txt).

---

<p align="center">
  Maintained by <a href="https://github.com/harshit-dixit">Harshit Dixit</a>
</p>
