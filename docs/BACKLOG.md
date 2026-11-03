# Statement Sense — Backlog

**Working file** — update during sessions. Companion to `PROJECT_SCOPE.md`. Changes go in `CHANGELOG.md`.
*(Format borrowed from KC Factory's backlog.)*

Priority: P0 = blocker · P1–P4 = high → low · F = future only · — = done
Size: S = small (hours) · M = medium (a day) · L = large (days) · XL = extra large (a week or more)
Status: ☐ open · ◐ in progress · ☑ done · ✋ waiting on a decision · ⏸ parked (out of scope for now)

---

## Already shipped (before this plan)
- ☑ Statement parser (generic, balance-aware), OCR, password PDFs, Thai dates, 215 rules
- ☑ Order parsers (Shopee list, Grab activity, receipts, CSV) and 1:1 matching
- ☑ Google Sheets storage (browser-direct), JSON/CSV backup and restore
- ☑ Installable phone app + offline OCR files (2026-11-03)
- ☑ Owner tag (Me / Mom / other) on orders and charges; "Paid for others" tile (2026-11-03)
- ☑ Duplicate handling: one-for-one import dedupe, look-alike flags (2026-11-03)

---

## Phase 0 — Foundations

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-001 | P0 | S | Agree decisions in `PROJECT_SCOPE.md` §10 | ✋ |
| SS-002 | P0 | M | Collect real samples. **Have:** four credit-card issuers, one savings account, Grab and Shopee screenshots. **Still need:** SCB/Krungsri/BBL if used, bank-app (K PLUS etc.) screenshots | ◐ |
| SS-003 | P1 | M | Fixture test harness: run each sample through the parser, assert row count, totals and reconciliation | ☑ 2026-11-03 |
| SS-004 | P2 | S | Remove the dead sign-in gate (`AccessGate`, `access.ts`, `VITE_ALLOWED_EMAILS`) once the backend replaces it | ☐ |
| SS-005 | P2 | S | Narrow Google scopes to what the app really uses; correct the README claim | ☐ |
| SS-006 | P2 | S | Content-Security-Policy meta tag (needs a test with OCR/WASM) | ☐ |
| SS-007 | P2 | S | Scan for secrets before every push (script + CI step) | ☐ |

## Phase 1 — Trustworthy import (requirements 1, 2)

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-101 | P1 | M | **Accounts**: type + store; detect bank and last 4 digits from a statement; per-account default owner | ◐ every card row carries account + accountName; no Accounts table yet |
| SS-102 | P1 | M | **Deterministic ids** for transactions and orders (content hash + occurrence index); migrate existing rows | ☐ |
| SS-103 | P1 | L | **Reconciliation**: opening + movements = closing (accounts); previous − payments + purchases = new balance (cards); result stored per import | ☑ 2026-11-03 (cards; account statements are parked) |
| SS-104 | P1 | L | **Import preview**: new / already there / changed / needs attention; choose account and owner for the file; commit on confirm | ☐ |
| SS-105 | P1 | M | **Edit any field** of a row; **add a row by hand** (cash); delete with undo | ☐ |
| SS-106 | P1 | L | **IndexedDB local store** + outbox (replaces `localStorage`); migration from the old cache | ☐ |
| SS-107 | P2 | M | Per-bank adapters (first the user's banks), each with real fixtures | ✋ |
| SS-108 | P2 | M | CSV / bank-app screenshot import for statements (not only orders) | ⏸ |
| SS-109 | P1 | S | **Card payments are transfers**: `PAYMENT - THANK YOU`, `Payment via ttb touch`, `Payment-SCB…Internet` are not spending *or* income | ☑ 2026-11-03 |
| SS-110 | P3 | S | Statement coverage: months with no statement per account | ☐ |

### Found from the real samples (2026-11-03) — Phase 1 additions

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-111 | P0 | M | **Bank detection from the issuer**: header/legal-entity lines, ignore pay-in-slip and footer text; add KTC (Krungthai Card) and other issuers; fixture test on the KTC file | ☑ 2026-11-03 |
| SS-112 | P0 | S | Sign handling: a lone `-` before an amount (`Payment … - 500.00`) is a credit | ☑ 2026-11-03 |
| SS-113 | P0 | M | **Rows only from the transactions table** (between the column header and SUB TOTAL / TOTAL); stop importing credit-bureau, points and interest tables | ☑ 2026-11-03 |
| SS-114 | P1 | M | Read **both dates** using the table header's column order (UOB post→trans, others trans→post); `date` = purchase date, posting date kept | ☑ 2026-11-03 |
| SS-115 | P1 | M | **Card sections** in one PDF (product name + masked number) → one Account each, reconciled separately (UOB: 3 cards) | ☑ 2026-11-03 |
| SS-116 | P1 | M | **Credit kinds**: card payment (transfer), refund / points offset (nets against the merchant's category), cashback, fee refund — not all "Income" | ☑ 2026-11-03 |
| SS-117 | P2 | S | Strip trailing `THB` / country code from descriptions; use them for foreign-spend detection | ☐ |
| SS-118 | P2 | S | Statement year from 2-digit-year dates (`14 Oct 26`); Dec→Jan year roll-over | ☐ |
| SS-119 | P2 | M | Instalment rows (`03/10`): record plan n of m; do not double the amount | ☐ |
| SS-120 | P2 | M | Detect garbled PDF text (legacy Thai fonts) and fall back to OCR or warn | ☐ |
| SS-121 | P1 | M | Capture statement summary (date, due date, minimum, limit, points); **Cards view + due-date reminders** | ☐ |
| SS-122 | P1 | M | **Wallet top-ups** (`SHOPEEPAY*`, TrueMoney…) = transfer to wallet; orders paid by wallet are the spending; payment method on orders | ☐ |
| SS-123 | P2 | S | Order text clean-up: OCR noise, ฿→B remnants, drop "Group Order by <name>", keep Shopee shop and product separate, keep Grab time of day | ☐ |
| SS-124 | P3 | M | Shopee lists show no date: ask for the order-detail screen, or accept amount-only matching | ☐ |
| SS-125 | P1 | M | **Real-fixture tests**: run every real sample through parser + reconciliation (fixtures stay local / private, never in the public repo) | ◐ harness + first fixtures done 2026-11-03 |
| SS-126 | P1 | M | **Statement chain check**: a statement's opening balance must equal the previous statement's closing balance for the same account; a mismatch means a statement is missing. Verified on two consecutive real statements | ☑ |
| SS-127 | P1 | M | **Thai account-statement layout**: read the printed control totals (`ยอดยกมา`, `รวมถอนเงิน N รายการ`, `รวมฝากเงิน N รายการ`, `ยอดยกไป`) and reconcile counts, sums and closing balance. Verified on a real savings file | ⏸ |
| SS-128 | P1 | M | **Transfer parsing**: direction, counterparty bank + last 4 digits (stable key), truncated name (`++`), channel; merchant name after `Ref X####` for QR payments | ⏸ |
| SS-129 | P1 | S | Append **wrapped description lines** to the row above (12+ in one statement lose their second line today) | ☐ |
| SS-130 | P1 | M | **Own-account transfers**: detect by the account holder's own name / known own accounts; exclude both sides from income and spending | ⏸ |
| SS-131 | P1 | M | **Money received is not income**: from a known person it is a settlement / reimbursement; otherwise a "transfer in". Salary and interest stay income | ⏸ |
| SS-132 | P2 | L | **Group events / shared costs** (e.g. a weekly sport): cost fronted vs shares received, net cost per event, link incoming transfers by pattern | ⏸ |
| SS-133 | P1 | S | **Cash allowance**: the user states a monthly amount moved to cash (a round monthly figure); it counts as personal spending in a "Cash" category for that month; editable per month | ☑ |
| SS-134 | P1 | S | **Spend-only summary**: drop "Money in / Net" (meaningless for cards); show spend, refunds & credits, card payments separately; total = card spend (mine) + stated cash | ☑ 2026-11-03 (Money in / Net replaced by Spend, Rewards, Paid to your cards; refunds net against their category and merchant) |
| SS-135 | P0 | S | Rows whose description contains "TOTAL" were dropped as summary lines (a merchant such as *Total Access* vanished); skip only genuine total lines | ☑ 2026-11-03 |
| SS-136 | P1 | L | **Categorisation coverage**: on real statements ~43% of spend is "Uncategorized" (e.g. fuel stations, payment gateways, app stores, games, hospitals). Extend the merchant rules, group by merchant not description, and offer "always categorise this merchant as…" when the user fixes one (see SS-402) | ◐ coverage 38% → 16% uncategorised on real data (2026-11-03); rest left to SS-402 |

## Phase 2 — Backend and sync (requirements 5, 7, 8)

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-201 | P0 | M | **Spike:** prove phone sign-in + signed session token + one round trip from the installed app (iPhone and Android) | ☐ |
| SS-202 | P1 | L | Apps Script backend (clasp, in `apps-script/`): auth, allow-list, session token, schema create/migrate, `Meta` rev counter | ☐ |
| SS-203 | P1 | L | Batch upsert/delete under a lock; idempotent by operation id; formula-injection guard | ☐ |
| SS-204 | P1 | M | Change feed: `pull(sinceRev)` with paging; cheap `ping` for the rev | ☐ |
| SS-205 | P1 | L | Client sync engine: outbox, push, pull, merge (newest wins, locked fields protected), no wholesale replace | ☐ |
| SS-206 | P1 | M | Polling schedule (visible/idle/hidden), on-focus sync, sync status in the header | ☐ |
| SS-207 | P1 | L | **Two-device simulation test** (offline edits, conflicts, deletes, retries) | ☐ |
| SS-208 | P2 | M | First-run migration of today's Sheet to the new schema (backup first) | ☐ |
| SS-209 | P2 | S | Weekly backup copy to Drive (time trigger) | ☐ |
| SS-210 | P2 | S | Measure real Apps Script quotas/latency; tune polling | ☐ |
| SS-211 | P3 | S | `Log` tab: who changed what, from which device | ☐ |

## Phase 3 — Orders and people (requirement 6, 7)

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-301 | P1 | M | **Matches** table (one row per link, status, score); remembers rejected links | ☐ |
| SS-302 | P1 | L | Many-to-one matching (one charge pays several orders; split payments) | ☐ |
| SS-303 | P1 | M | Choose the **owner when uploading** a batch; account default owner | ☐ |
| SS-304 | P2 | M | **Owner rules** ("orders from shop X are Mom's") and bulk assign | ☐ |
| SS-305 | P2 | M | Auto-owner from the **recipient name** on order detail pages (People aliases) | ✋ |
| SS-306 | P1 | M | `payment` on orders; **log an unmatched order as an expense** so it counts | ☐ |
| SS-307 | P1 | L | **Settlements + person ledger**: charged to them − paid back = owed; mark an incoming transfer as a settlement | ✋ |
| SS-308 | P3 | S | More platforms (LINE MAN, Foodpanda detail pages) | ☐ |

## Phase 4 — Insight and polish (requirement 4)

| ID | P | Size | Item | Status |
|---|---|---|---|---|
| SS-401 | P1 | L | **Review inbox**: one queue (low confidence, uncategorised, duplicates, unmatched, no owner, unreconciled) | ☐ |
| SS-402 | P2 | M | Learn from corrections: "always categorise this merchant as…" creates a rule | ☑ 2026-11-03 (prompt after a category change; learned rules outrank built-ins) |
| SS-403 | P2 | M | Summary by account; month-over-month; compare with last month | ☐ |
| SS-404 | P3 | L | Recurring charges / subscriptions; upcoming bills | ☐ |
| SS-405 | P3 | M | Budgets per category with progress | ☐ |
| SS-406 | P3 | M | Weekly summary email | ☐ |
| SS-407 | P3 | S | Split a charge between people / categories | ☐ |
| SS-408 | F | M | Overseas spend with exchange rates | ☐ |
| SS-409 | F | M | Thai-language interface | ☐ |
| SS-410 | F | S | Undo / change history UI | ☐ |

---

## Parked
- **Bank-account statements** (SS-127, 128, 130, 131, 132): the user will state a monthly cash amount instead (SS-133). Parser for deposit accounts already works (verified on a real KBank file) — revisit only if wanted.
- Cloud OCR (a deliberate no: statements stay on the device).
- A different backend (Cloudflare / Supabase) — revisit only if polling proves too slow.

## Pending testing
- Phone home-screen app: sign-in pop-up on iPhone (shipped 2026-11-03, not yet tried).
- Owner tags and "Paid for others" (shipped 2026-11-03, not yet tried on real data).
- Duplicate flags with a real overlapping screenshot pair (shipped 2026-11-03, not yet tried).

## Lessons learned
- *2026-11-03:* the balance check (previous + activity = closing) is the only thing that proves a parse is complete. It must name the card and the missing amount, and it must be tested by *damaging* a real statement, not only by passing one.
- *2026-11-03:* a section's card number often comes *after* its table header, and the header can be preceded by another card's number in a points table. Take the nearest number before the first row; count rows, not lines.
- *2026-11-03:* process: invented test data must not reuse real card digits or merchants. Scan the staged diff for them before every commit (it caught both this time).
- *2026-11-03:* "Money in" on a card is not income. Payments to the card are transfers, refunds reverse a charge (and net against it), cashback is a reward. Three different things; the old code called them all Income and the totals were nonsense.
- *2026-11-03:* a refund only nets against its merchant if both sides get the *same* merchant label (`PWP: WWW.GRAB.COM` vs `WWW.GRAB.COM BANGKOK`). Group by a normalised merchant, never by the raw description.
- *2026-11-03:* never identify the issuer by "a bank's name appears anywhere in the text": pay-in slips list every bank and merchant rows name banks (`Payment-SCB…`). Score the letterhead only, weight identifiers the issuer alone prints, and skip rows and everything after the payment slip.
- *2026-11-03:* rows belong to the **transactions table**, not to any line that starts with a date — credit-bureau and points tables look just like transactions.
- *2026-11-03:* writing the regression test for one bug exposed another (`TOTAL` in a merchant name). Test the neighbours.
- *2026-11-03:* the old import dedupe collapsed genuine repeat purchases (two ฿45 buys on one day) and merged
  undated same-price orders. Rule: **count, don't collapse** — match repeats one-for-one.
- *2026-11-03:* `.gitignore` excludes every `.png` on purpose (statement screenshots). New image assets need an
  explicit exception.
