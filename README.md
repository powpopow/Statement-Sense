# Statement Sense

Upload a Thai bank or credit card statement, get your spending read, categorised
and summarised — and pair Shopee and Grab orders with the card charges they
produced, so a statement line reading `SHOPEE THAILAND` turns into what you
actually bought.

Everything is parsed **in your browser**. The PDF never leaves your machine.

## What it does

1. **Import** a statement as PDF or screenshot. Text PDFs are read with pdf.js;
   scanned PDFs and phone screenshots fall back to OCR (Thai + English).
2. **Extract** the transaction rows — Buddhist Era dates (2568 → 2025), Thai
   month abbreviations, Thai digits, and both `1,234.56` and `1.234,56`.
3. **Categorise** against ~215 seeded Thai merchant rules (7-Eleven, Lotus's,
   Grab, BTS, AIS, PTT, …), which you can edit in the app or in the sheet.
4. **Match** Shopee / Grab / Lazada orders to card charges on amount, date
   proximity and platform name, then rewrite the statement line with the item.
5. **Log what it could not categorise.** The Rules tab lists unmatched
   merchants by total spend, with names normalised — processor prefixes
   (`OMISE*OMISE *DTAC`), store codes (`PZ2124-`) and city suffixes
   (`…COMPLEXBANGKOK`) removed — so one shop is one row rather than five.
   "Copy list" exports it as Markdown for working through later.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

It works immediately with no setup — data is kept in your browser. Connecting
Google Sheets (below) is optional and adds durable, cross-device storage.

## Google Sheets storage (optional)

Your rows live in a spreadsheet called **Statement Sense Data** in your own
Drive, with one tab each for `Transactions`, `Orders` and `Rules`. Editing the
Rules tab in Google Sheets is a supported way to retrain categorisation.

The app requests only the `drive.file` scope, which grants access to the one
spreadsheet it creates and nothing else in your Drive.

To enable it:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create
   a project (or pick an existing one).
2. Under **APIs & Services → Library**, enable **Google Sheets API**.
   Optionally also enable **Google Drive API** — it is used for exactly one
   thing: finding a sheet you already have when connecting from a new browser,
   so you don't end up with duplicates. Without it the app still works and
   simply creates a new sheet.
3. Under **APIs & Services → OAuth consent screen**, choose **External**, fill in
   the app name and your email, and add yourself under **Test users**. You do not
   need to publish or get the app verified for your own use.
4. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type
   **Web application**. Add these **Authorised JavaScript origins**:
   - `http://localhost:5173` (for local development)
   - `https://<your-username>.github.io` (for the deployed site)
5. Copy the client ID into a `.env` file in this folder:

```bash
cp .env.example .env
```

Then set `VITE_GOOGLE_CLIENT_ID=...` in `.env` and restart the dev server.

A browser OAuth client ID is public by design — it is not a secret. What
restricts it is the list of authorised origins in step 4.

## Deploying to GitHub Pages

Push to a GitHub repo, then under **Settings → Pages**, set **Source** to
**GitHub Actions**. The included workflow at `.github/workflows/deploy.yml`
builds and deploys on every push to `main`.

For Sheets sync on the deployed site, add the client ID as a repository
**variable** (not a secret) named `VITE_GOOGLE_CLIENT_ID` under
**Settings → Secrets and variables → Actions → Variables**, and add your
`github.io` origin in step 4 above.

## Teaching it new merchants

Thai card statements name merchants opaquely — `AMZ_SC2644`, `SPVI-ISTUDIO`,
`2C2P ONE SIA` — so categorising them is a research job, not a guess. The loop:

1. Import statements as usual.
2. **Rules → Unmatched merchants** lists what has no rule, grouped by
   normalised name and ranked by total spend, so the ones worth fixing are at
   the top.
3. **Copy list** exports it as a Markdown table, including the original
   description (which often carries the clue the normalised name has lost).
4. Add the patterns to the `SEEDS` array in [`src/lib/categorize.ts`](src/lib/categorize.ts),
   or add them one at a time in the app, or directly in the sheet's Rules tab.

When adding a pattern, pick the part that survives a different branch or store
code — `SUSHIRO`, not `SUSHIRO GH(TH) C.RAMA 9`. Short acronyms are matched on
letter boundaries, so `BTS` matches `LINEPAY*LP_BTS` but not `DEBTS`.

Unmatched rows persist in the sheet with the category `Uncategorized`, so the
backlog rebuilds itself anywhere you open the app and accumulates across
imports.

## Where the OCR runtime comes from

Screenshots and scanned PDFs are read with [tesseract.js](https://github.com/naptha/tesseract.js),
a WebAssembly build of Tesseract. The image is never uploaded — recognition
happens in a Web Worker on your machine.

By default, though, tesseract.js fetches its own runtime from a public CDN at
the moment you first use it: the worker script (**executable JavaScript**), the
WASM core, and the language models — with no Subresource Integrity check. That
is third-party code executing in a page holding your transactions and a Google
access token.

So the app serves them itself. `scripts/sync-ocr-assets.mjs` copies them out of
`node_modules` into `public/tesseract/` before every dev run and build, and
`src/lib/extract.ts` points `workerPath`, `corePath` and `langPath` at those
copies. Setting all three removes the CDN entirely — tesseract.js only builds a
CDN URL when a path is unset, and verifiably fails rather than falling back when
a local path is wrong.

That means no third-party code at runtime, versions pinned by the lockfile,
nothing leaked to a CDN about what you scan, and OCR that works offline. It
costs about 23MB of assets in `dist`. `public/tesseract/` is build output and
is gitignored; `npm run sync-ocr` refreshes it by hand.

`pdfjs-dist` was already bundled locally, so the PDF path never had this
exposure — it only affected screenshots and scanned PDFs.

## Tests

```bash
npm test
```

The suite covers Buddhist Era date conversion, both decimal conventions,
balance-column inference, credit-vs-debit signing, Thai merchant
categorisation, and order matching.

## How the statement parser works

Rather than a hand-written layout per bank, the parser reads any row that
starts with a date and carries amounts, then infers what the money columns mean
from the data:

- If the rightmost column behaves like a **running balance** — each value equals
  the previous one plus or minus another amount on the row — the balance deltas
  sign every transaction exactly. This is the reliable path and most Thai
  passbook-style statements take it.
- Otherwise the rightmost amount is the transaction, signed from credit markers
  (`CR`, parentheses, trailing minus, `คืนเงิน`, `ชำระเงิน`).

Rows where the two readings disagree are flagged with a dot in the UI, so a
misread column surfaces rather than quietly skewing the totals.

Thai banks also print a **worked example** on every credit card statement — an
invented month of spending used to explain how interest is charged, laid out
with the same date and amount columns as the real table. The parser trims each
page at its first example heading, and says so in the import warnings. Without
this, one real statement reported 9,222 THB of spending against an actual 115.

Banks recognised by name: KBank, SCB, Krungthai, Bangkok Bank, ttb, Krungsri,
GSB, UOB, Citibank. Unrecognised banks still parse — you just lose the label.

## Known limits

- **Password-protected PDFs** are supported — the app asks for the password and
  opens the file in the browser. The password is used once and never stored.
- **OCR quality** drives everything for screenshots. A straight, well-lit crop
  that includes the amount column reads far better than a photo at an angle.
- **Screenshot orders** are read per labelled total, so a "My Purchases" list
  screenshot yields one order per row. Without a line labelled as the total,
  the largest amount on the image is used and the import says so.
- **Batch screenshot imports** share one OCR worker, so the Thai and English
  models load once rather than per file.
- **Multi-currency** card rows are detected and tagged, but not FX-converted;
  the THB amount billed is what gets counted.

## Project layout

```
src/
  lib/
    extract.ts       PDF text extraction (pdf.js) and OCR (tesseract.js)
    thaiDate.ts      Buddhist Era + Thai month parsing
    money.ts         Amount tokenising, both decimal conventions
    categorize.ts    Rule engine + ~215 seeded Thai merchant rules
    matching.ts      Order ↔ transaction scoring
    google.ts        OAuth token flow (no backend, no client secret)
    sheets.ts        Google Sheets read/write
    store.ts         App state, local cache, sync
    parsers/
      banks.ts       Bank and statement-kind detection
      statement.ts   The row parser and balance-column inference
      orders.ts      Shopee / Grab / Lazada screenshots and CSV exports
  components/        UI
```
