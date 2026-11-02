# Statement Sense — Project Scope & Design

**Status: DRAFT for discussion — nothing here is built yet.** Written 2026-11-03 after a full read of the code.
Companion file: `BACKLOG.md` (the tracker). Decisions we still need are in section 10.

---


> ### Scope decision — 2026-11-03 (from the user)
> **Track credit cards only.** Bank accounts are *not* tracked. Instead, the user states how much goes to a cash
> account each month and that amount is **assumed to be personal spending** ("Cash").
> Consequences: no deposit-account import, no income/"money in" tracking, no group-event ledger, no own-account
> transfer matching. Card payments (`PAYMENT - THANK YOU` etc.) are transfers, neither spend nor income.
> The summary becomes **spend-only**: card spend (mine) + stated cash, with "paid for others" kept separate.
> Card issuers seen so far: UOB, KBank, ttb, KTC.

## 1. What this app is for

One place to see where the money went, across several Thai banks and cards, for one person's household:
upload a statement from any bank (PDF or screenshot) from a phone or a computer, have it read, categorised and
saved to a Google Sheet automatically, and know — for each purchase — whether it was **mine, my mom's, or
someone else's request**, so what I paid for others can be tracked and settled cleanly.

### Hard constraints (carried over from today, and good ones)
- **Statements never leave the device.** PDFs/screenshots are read in the browser. Only extracted rows are stored.
- **Google Sheet is the record** (the user can open and edit it), not a database they cannot see.
- **Free to run.** GitHub Pages for the site, Google for storage. No paid servers.
- **Works offline** for reading and importing; syncs when back online.

---

## 2. Requirements and where we stand today

| # | Requirement | Today | Gap |
|---|---|---|---|
| 1 | Upload statements from **multiple banks** | 🟡 A generic parser plus a list of 9 bank names. The bank name is only a label; no bank-specific logic. | Never validated on real statements (tests use invented text). No per-bank handling, no accuracy check. |
| 2 | **Extract** the data | 🟡 pdf.js for text PDFs, Tesseract OCR for screenshots/scans, password PDFs. | No check that the numbers add up. Imports are saved immediately, with no preview. |
| 3 | **Categorise** | 🟢 ~215 Thai merchant rules, priority-based, editable, manual override. | Does not learn from corrections. Categories are a fixed list. |
| 4 | **Summary** | 🟡 Category split, monthly chart, top merchants, month picker, per-person filter. | No per-account view, trends, budgets or recurring charges. |
| 5 | **Auto-record to the Google Sheet** | 🟡 Browser writes to the Sheet with the user's own token. | Not automatic: needs a manual connect; the token expires hourly; every change rewrites whole tabs. |
| 6 | **Order matching** + whose order it is | 🟡 One-to-one matching on amount/date; an owner tag on each row. | One charge paying several orders is not handled. No running balance per person. Orders with no card charge are not counted. |
| 7 | **Matching stored in the Sheet** | 🔴 Stored as a cross-reference on *both* the order row and the charge row. | Two copies of one fact can disagree. Should be its own table. |
| 8 | **Phone/PC sync in near real time** | 🔴 None. A manual push/pull; *pull replaces local data*, which can lose changes. | Needs a real sync design (section 6). |
| 9 | Project scope and tracker | 🔴 Only a README. | This document and `BACKLOG.md`. |

---

## 3. How it is built today (as-built)

A static React + TypeScript single-page app (Vite), no server.

```
file ──► extract.ts ──► import.ts ──► parsers/statement.ts ──► categorize.ts ──┐
 PDF: pdf.js text        decides        parsers/orders.ts      (rules)         │
 image/scan: Tesseract   statement      (Shopee/Grab/CSV)                      ▼
 CSV: plain text         vs orders                                    store.ts (React state)
                                                                       │  localStorage cache
                                                              sheets.ts ┘  + whole-tab push/pull
                                                                        to Google Sheets (browser token)
UI: Import · Summary · Transactions · Order matching · Rules · Storage
```

**Done well and worth keeping:** self-hosted OCR runtime (no CDN code), a parser that infers columns from the
data instead of per-bank templates, balance-delta sign detection, removal of the bank's worked-example pages,
Thai/Buddhist-era date handling, password-protected PDFs, merchant-name normalisation, duplicate handling,
the installable phone app, 115 passing unit tests.

---

## 4. Problems found in the current design

These are structural, not cosmetic. They are why a redesign is worth doing before adding more features.

1. **Sync can lose data.** Pulling replaces everything local with the sheet's contents. An import made offline,
   or on the phone, can be wiped by a pull from the laptop. Pushing rewrites every row of every tab on each change,
   so two devices overwrite each other (last writer wins, silently).
2. **No stable identity.** Row ids are made from the file name and the clock, so the same row has a different id
   on each import and each device. That is why duplicates need guesswork, and it blocks real sync.
3. **The browser holds the keys.** The app asks Google for access to *all* your spreadsheets (`spreadsheets`),
   although the README promises only `drive.file`. A one-hour token means pop-ups and failed background sync, which
   is worst on a phone home-screen app.
4. **Matching is stored twice** (on the order and on the charge) and only supports one order ↔ one charge.
   One Shopee payment that covers two orders cannot be matched.
5. **No account concept.** The app does not know *which* bank, card or account a row came from. So it cannot
   verify a statement, spot a transfer between your own accounts (money out of one, in to another), or show
   spending per account.
6. **No way to know an import is right.** Nothing checks that opening balance + movements = closing balance.
   A misread amount looks the same as a correct one until you spot it by eye.
7. **Imports are committed immediately.** There is no preview, so a misread file is already in your data.
8. **Storage:** the local cache is `localStorage` (about 5 MB, synchronous). Fine today, a ceiling soon.
9. **Parser accuracy is unproven.** Tests use invented statements. We do not have a single real redacted
   sample per bank. This is the biggest *product* risk, bigger than any code issue.
10. **Leftovers:** the soft sign-in gate (bypassable, now off) is dead code; there is no schema versioning for
    the sheet (a header-refresh workaround stands in).

---

## 5. Target design

### 5.1 Layers

```
 ┌──────────────── Browser / phone (public static site, no secrets) ────────────────┐
 │  UI   Inbox · Import · Transactions · Orders & matching · People · Summary · Settings
 │  Domain (pure TypeScript, unit-tested)   ids · parse · reconcile · categorise · match · ledger · summarise
 │  Ingest   file → extract → classify (bank/account/kind) → parse → normalise → reconcile → PREVIEW → commit
 │  Local store   IndexedDB (rows + outbox of unsent changes)         ← works offline
 │  Sync engine   push outbox · pull changes since last revision · merge
 └───────────────────────────────────────┬──────────────────────────────────────────┘
                              HTTPS (Google ID token → session token)
 ┌───────────────────────────────────────▼──────────────────────────────────────────┐
 │  Backend: Google Apps Script bound to the Sheet (clasp-managed in this repo)
 │  auth (allow-list) · batch upsert under a lock · change feed by revision number
 │  schema versioning · validation · formula-injection guard · daily backup · notices
 └───────────────────────────────────────┬──────────────────────────────────────────┘
                                          ▼
                    Google Sheet (the record): Accounts · Transactions · Orders · Matches
                              People · Settlements · Rules · Imports · Meta · Log
```

**Why an Apps Script backend (recommended).** It is the only option that keeps "Google Sheet is the backend",
costs nothing, and fixes problems 1, 3 and the access question together: the browser no longer needs access to
your Drive (it only proves who it is), the server does the writes safely, and only allow-listed emails get data —
so the page can stay public. We already built and proved this pattern for split-app. Costs: calls take 1–3 seconds,
there is no push (so "near real time" means polling), and there are Google quotas to confirm. Alternatives
(Cloudflare, Supabase) give true real-time but leave the Sheet behind; we can move later because the sync
layer is isolated.

### 5.2 Data model (Sheet tabs)

Every synced row carries: `id`, `updatedAt`, `updatedBy` (device), `rev` (server-assigned, always increasing),
`deleted` (a flag, so deletions sync instead of reappearing).

| Tab | Holds | Key points |
|---|---|---|
| **Accounts** | one row per bank account / card | bank, kind, last 4 digits, nickname, **default owner** (e.g. Mom's card) |
| **Transactions** | statement lines | **deterministic id** from account+date+amount+text+occurrence, so re-import = same row; `owner`; category + lock |
| **Orders** | Shopee/Grab/Lazada orders | platform, ref, items, amount, `owner`, `payment` (card / ShopeePay / COD / transfer) |
| **Matches** | *one row per link* order ↔ charge | status (suggested / confirmed / rejected), score, reasons. Many-to-one allowed. Rejected links are remembered. |
| **People** | Me, Mom, … | name, aliases (for auto-assigning an order's recipient), colour |
| **Settlements** | money someone paid back | person, amount, date, optional link to the incoming transaction |
| **Rules** | categorisation rules | as today, plus owner rules ("this shop is always Mom's") |
| **Imports** | one row per uploaded file | file hash, bank/account, period, row counts, **reconciliation result**, time, device |
| **Meta / Log** | schema version, revision counter / audit trail | |

### 5.3 Sync protocol (near real time)
- **Local first:** every edit lands in IndexedDB and an outbox immediately; the UI never waits for Google.
- **Push:** the outbox is sent as a batch of upserts/deletes with an operation id (safe to retry).
- **Pull:** `changes since revision N`; the server answers with only what changed. First sync pages the whole sheet.
- **When:** after every local change, when the app regains focus, and every ~20 s while it is visible; slower
  when idle, paused when hidden. Two devices therefore agree within a few seconds to half a minute.
- **Conflicts:** per row, newest `updatedAt` wins, with device id as tie-breaker; locked fields (a hand-picked
  category) are never overwritten by an automatic change. The losing change is kept in the Log, not silently lost.
- **Never** replace local data wholesale from a pull.

### 5.4 Import pipeline (requirements 1 and 2)
1. Drop many files at once, from a phone or a computer.
2. Each file is classified: bank, account (last 4 digits), kind (statement / app screenshot / order list / CSV).
3. Parsed by the generic engine **plus a small per-bank adapter where a bank needs it**.
4. **Reconciliation:** opening balance + movements = closing balance (cards: previous balance − payments +
   purchases = new balance). Result: ✅ verified, ⚠ mismatch, or "cannot verify". A mismatch blocks silent saving.
5. **Preview:** a table of what will be added, what is already there, what changed, and what needs attention.
   Choose the account and the owner for the whole file ("this is Mom's statement") before saving.
6. Commit → local store → synced to the Sheet.

### 5.5 Orders, owners and settling up (requirement 6)
- **Owner** on every order and charge; a matched pair shares one owner (kept).
- Ways to set it without clicking every row: **owner chosen when you upload** a batch; **rules** ("shop X → Mom");
  **account default** (Mom's card); and, where the app shows it, the **recipient name on the order detail page**
  matched to a person's aliases.
- **Many-to-one matching:** one charge can pay several orders (sum match), and one order can be split across charges.
- **Orders with no card charge** (ShopeePay, cash on delivery, transfer) can be logged as an expense so they count.
- **Person ledger:** for each person, what you paid on their behalf minus what they have paid back
  (`Settlements`) = what they owe you now. Money coming in from them is marked as a settlement, not income.

### 5.6 Security
- No secrets in the page. The Sheet is private; only the backend touches it.
- Server-side allow-list of emails; every request carries a verified token; a signed session token
  (HMAC, secret in Script Properties) avoids hourly Google re-login on the phone.
- The browser asks Google for *identity only* — no Drive or Sheets scope.
- Values written to the Sheet are sanitised (a merchant name starting with `=` must not become a formula).
- A Content-Security-Policy on the page. Account numbers stored as last 4 digits only.
- Weekly automatic backup copy of the Sheet to Drive.

---

## 6. Features beyond the nine, proposed

**Should have**
- **Review inbox:** one queue for everything needing a look — low confidence, uncategorised, possible duplicates,
  unmatched orders, rows with no owner, statements that did not reconcile.
- **Edit and add:** change any field of a row; add a cash expense by hand; split one charge between people/categories.
- **Transfers between your own accounts and card payments** detected and excluded from spending (both sides).
- **Statement coverage:** "no statement imported for September on your KBank card".
- **Learn from corrections:** after you recategorise a merchant, offer "always do this" (creates a rule).

**Could have (later)**
- Recurring charges and subscriptions, budgets per category, month-over-month and year-over-year trends.
- Weekly summary email (a scheduled script in the backend).
- Overseas spending with exchange rates.
- Undo and a change history ("who changed this, from which device").
- Thai-language interface.

**Not planned:** uploading statements to any cloud OCR; a paid backend; sharing the Sheet with other apps.

---

## 7. Phases (see `BACKLOG.md` for the item list)

| Phase | Goal | Delivers requirements |
|---|---|---|
| **0 — Foundations** | Decisions made, real sample statements collected, test harness for bank fixtures, this doc agreed | 9 |
| **1 — Trustworthy import** | Accounts, deterministic ids, reconciliation, import preview, edit/add rows, IndexedDB store | 1, 2 |
| **2 — Backend and sync** | Apps Script backend, auth, change feed, sync engine, schema, backups | 5, 7, 8 |
| **3 — Orders and people** | Matches table, many-to-one matching, owner rules, settlements and ledger | 6, 7 |
| **4 — Insight and polish** | Review inbox, recurring/budgets/trends, notifications, accounts view | 4 |
| **Ongoing** | Bank adapters, one bank at a time, each with real redacted fixtures | 1 |

Phases 1 and 2 are independent enough to overlap; bank adapters should start in phase 0, not wait.

---

## 8. Quality gates (every item)
Unit tests for domain logic · bank parsers tested against **real redacted fixtures** · a two-device sync simulation
test · reconciliation must pass on every fixture · no secrets in the repo (scan before every push) ·
changelog entry · README/Scope updated · tried on a real phone before "done".

## 9. Risks
- **Bank formats (high):** without real samples, "multiple banks" is a promise we cannot verify.
- **Apps Script limits (medium):** latency, daily quotas, 30 simultaneous runs. Plenty for one household; to be measured early.
- **Phone sign-in (medium):** pop-ups in a home-screen app. The signed session token is the mitigation; prototype it first.
- **OCR accuracy on screenshots (medium):** reconciliation and the preview are the safety net.
- **Sheet size (low):** tens of thousands of rows are fine; archive by year if needed.

## 10. Decisions needed from you
1. **Which banks and cards do you actually use?** And can you share one redacted PDF/screenshot per bank
   (hide names, account numbers; keep the layout)? This sets the order of bank adapters.
2. **Backend:** confirm the Apps Script backend (section 5.1).
3. **Who uses it?** Only you on several devices, or do Mom/others also log in (to view or add)?
4. **Whose orders are they?** Do you take Mom's screenshots yourself, or does she send them? Do you ever use
   her Shopee login? (This decides whether we can auto-assign from the recipient name.)
5. **Settling up:** how do others pay you back — PromptPay transfer, cash? Do you want a ledger with "paid" marks?
6. **Sync speed:** is "within about 20–30 seconds" acceptable?
7. **Currencies:** Thai baht only, or overseas card spend too?
8. **The public repo:** keep it public (no secrets, only code) or move the source to a private repo?
9. **Order of work:** do you agree with the phases, and what must come first?

---

## 11. Lessons from testing real statements

Real statements (credit cards from four issuers, one savings account) and Grab / Shopee order screenshots were
tested locally. The files and every figure from them stay out of this public repository: extracted text lives in
the git-ignored `fixtures/` folder and is exercised by `scripts/realSamples.test.mjs`, which skips itself when
there are no fixtures.

**Confirmed**
- The generic, data-driven parser reads amounts and signs correctly on most issuers, and the balance column logic
  works on a real deposit-account statement.
- Every card statement prints a previous and a new balance, so reconciliation is possible for all of them, and
  consecutive statements chain (one's closing balance is the next one's opening balance).
- The OCR + order parsers read the right amount on every Shopee and Grab row tested, and orders match card charges.

**Found and being fixed** (see `BACKLOG.md`): bank detection fooled by pay-in slips that list every bank;
a credit sign printed as a separate column; non-transaction tables (credit bureau, points) read as rows;
the two date columns appearing in a different order per bank; all credits filed as income; several cards in one PDF
merged; wallet top-ups that would double-count against the orders they fund; wrapped description lines dropped.

**New ideas:** a Cards view with due dates, minimum payments and utilisation, and a reminder before each due date.

---

## 12. Scope decision — credit cards only, cash stated by the user (2026-11-03)

The user does not want bank accounts tracked. Each month they state the amount moved to a cash account and it is
treated as personal spending. This removes a whole class of hard problems (income vs reimbursement, own-account
transfers, group events) and sharpens the focus on cards:

- **Per card:** statement import, balance reconciliation, previous-statement chain check, due date and minimum
  payment, credit utilisation, points.
- **Credits on a card are not income:** card payments are transfers; refunds and points offsets net against the
  merchant's category; cashback and fee refunds are shown as credits.
- **Cash:** one monthly figure (editable per month) in a "Cash" category; no detail below it.
- **Whose spending:** unchanged — Me / Mom / others, per card charge and per order; "Paid for others" stays.
- **Parked:** deposit-account statements (the parser already reads them correctly if ever wanted), settlements
  from bank transfers, shared-cost events.
