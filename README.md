# MDPI Layout Reviewer

A single web page that checks a Word manuscript (`.docx`) against *The MDPI Layout Style Guide* (11th ed.) and writes the findings back into the file as Word comments. It can also compare two files: Original ↔ Done (main text or references) and JATS XML ↔ Word.

Everything runs in the browser. No file is uploaded anywhere.

Live page: https://both7185.github.io/MDPI-Layout-Reviewer/

## Build

The page is shipped as one self-contained `index.html`, but the source is split into files under `src/` and `data/`.

```sh
npm run build        # writes dist/index.html
npm run check        # every file parses, is included once, and the build is reproducible
```

The build needs Node 18 or newer and no npm packages. It takes `src/index.html` (the page skeleton) and replaces each `<!-- include: path -->` with that file's exact contents. Nothing is minified or rewritten, so the built page is the same code you read in `src/`.

Every push to `main` builds the page and deploys it to GitHub Pages (`.github/workflows/pages.yml`). Pull requests run the same build and checks without deploying.

## How the code is laid out

All scripts are plain browser JavaScript (no modules). The engine files share one `<script>` and run in the order `src/index.html` lists them, so a file can use anything defined in a file listed before it.

| Path | What it does |
| --- | --- |
| `src/index.html` | Page skeleton: head, markup of both tabs, and the include list |
| `src/styles/app.css` | All page styles |
| **Reading Word files** | |
| `src/docx/xml-helpers.js` | Namespaces and small XML helpers (`kid`, `kids`, `wa`, `parseXml`, `ser`, …) |
| `src/docx/styles.js` | Theme fonts, paragraph/run properties, style inheritance, table-style formatting, list numbering |
| `src/docx/model.js` | `buildModel`: turns `document.xml` into paragraphs, runs, tables and floats with resolved formatting |
| `src/docx/comments.js` | Writes findings as native Word comments, removes old comments, and `processDocx` (entry point of the Check tab) |
| **Checks against the style guide** | |
| `src/checks/main/specs.js` | Expected paragraph format for each MDPI style (size, italic, spacing, …) and how deviations are described |
| `src/checks/main/constants.js` | Article types, back-matter labels, Title Case word lists, units, acronyms, companies, software, countries |
| `src/checks/references/species-and-formulas.js` | Species names (italics) and chemical formulas, ions, isotopes, unit exponents (super/subscript) |
| `src/checks/run-check.js` | `runCheck`: every check, in numbered sections (page setup, paragraph roles, formats, runs, front matter, headings, references, text rules, figures/tables, back matter, cross-references, acronyms) |
| `src/checks/references/reference-constants.js` | US city → state, fixed journal abbreviations |
| `src/checks/references/journal-abbrev.js` | Journal abbreviation check (ISO 4 / LTWA) |
| **Compare tab** | |
| `src/compare/docx/normalize.js` | Text normalising, tokens and package loading shared by both compare modes |
| `src/compare/docx/compare-docx.js` | `compareDocx`: Original ↔ Done, main text or references |
| `src/compare/xml/math.js` | Equations: OMML and MathML to a common linear form, and their diff |
| `src/compare/xml/jats.js` | Reading the JATS XML side |
| `src/compare/xml/word-side.js` | Reading the Word side for the XML compare (template styles, MathType, equation tables) |
| `src/compare/xml/compare-xml.js` | `compareXml`: XML ↔ Word |
| **Page** | |
| `src/ui/shared.js` | Display helpers used by both tabs |
| `src/ui/check-tab.js` | Check tab: file input, results list, download |
| `src/ui/compare-tab.js` | Compare tab |
| **Third-party code and data** | |
| `src/vendor/jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) 3.10.1 (MIT or GPLv3), reads and writes `.docx` |
| `src/vendor/abbrev-iso.js` | [abbrevIso](https://marcinwrochna.github.io/abbrevIso/) 1.2 (MIT), ISO 4 title abbreviation |
| `data/ltwa-2024.tsv`, `data/ltwa-2016.tsv` | List of Title Word Abbreviations (ISSN International Centre), 2024 and 2016 editions |
| `data/ltwa-short.txt` | Short words abbrevIso leaves out of abbreviations |

## Testing a change

The real test material is publishers' manuscripts, which are confidential, so it is **never** committed (`.gitignore` blocks `.docx`, `.xml` and `.htm`). Keep the files and a job list outside the repository, then run the same files through the last release and your build:

```sh
npm install && npx playwright install chromium   # once
npm run build
node scripts/regress.mjs --manifest ../test-files/jobs.json --baseline ../releases/v52.html
```

`jobs.json` lists the runs (paths relative to it):

```json
{ "jobs": [
  { "type": "check", "file": "paper-fc.docx" },
  { "type": "xml",   "word": "paper-fc.docx", "xml": "paper.xml" },
  { "type": "main",  "orig": "paper-ori.docx", "done": "paper-done.docx" },
  { "type": "ref",   "orig": "refs-ori.docx", "done": "refs-done.docx" }
] }
```

The script prints every finding, statistic or written Word part that differs between the two builds. A refactor should show no differences; a new check should show only the findings it was meant to add or remove.
