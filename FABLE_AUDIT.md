# FABLE_AUDIT.md — REVV Reliability & Correctness Audit

> Deep technical audit (Fable 5). Every finding below was verified by reading the actual code —
> not inferred. No code was modified in this pass.
> **Audited at HEAD `256e0f2`; resolutions verified through `b9c767b`, 2026-07-03.** The repo is live:
> Codex/Hermes land fixes continuously, so re-verify line numbers before acting on an old copy of this file.
>
> **Supersedes** two older, frontend-focused reviews — `AUDIT-REPORT.md` (2026-03-18) and
> `QA-FINAL-REPORT-2026-03-30.md` (an incomplete run blocked by missing `.env`/Postgres). Their three
> headline items were spot-checked and are **fixed** in current code (TechView.jsx hook-order violation;
> Portal.jsx missing `Clock` import; PaymentPanel.jsx broken `STRIPE_PUBLISHABLE_KEY` fallback). Both
> files were **deleted this session** with Bryan's authorization. Their lower-severity frontend
> error-handling items were *not* individually re-verified — if you want that surface covered, run a
> dedicated frontend reliability pass (it is out of scope for this backend-focused audit).

---

## Status at a glance

| ID | Finding | Sev | Status @ `256e0f2` |
|----|---------|-----|--------------------|
| C1 | Cross-tenant photo read (IDOR) | CRITICAL | ✅ Resolved (`379f6c7`) |
| C2 | Supplements overwrite instead of accumulate | CRITICAL | ✅ Resolved (`1734aa4`) — but spawned H7 |
| **C3** | **Cross-tenant claim-link token leak → PII read + forged adjuster submit** | **CRITICAL** | ✅ Resolved (`5ae275d`) |
| H1 | `PUT /:id/status` bypassed payment/reopen/SIU gates | HIGH | ✅ Resolved (`256e0f2`) |
| H2 | Client controls the invoice total | HIGH | 🔴 Open |
| H3 | Payment amount not reconciled to what's owed | HIGH | 🔴 Open |
| H4 | Money stored as `REAL` float; import plugs tax | HIGH | 🔴 Open |
| H5 | OCR/adjuster import: brittle parse, silent mis-bucket | HIGH | 🔴 Open |
| **H6** | **Cross-tenant `parts_requests` read (IDOR)** | **HIGH** | ✅ Resolved (`5ae275d`) |
| **H7** | **`ro_supplements` schema divergence breaks supplement writes on fresh DBs** | **HIGH** | ✅ Resolved (`b9c767b`) |
| M1 | RO status read-then-write, no optimistic lock | MEDIUM | 🔴 Open |
| M2 | Photo file written before ownership check → orphans | MEDIUM | 🔴 Open |
| M3 | `/uploads` served with no auth | MEDIUM | 🔴 Open |
| M4 | Customer notifications best-effort, no retry/visibility | MEDIUM | 🔴 Open |
| M5 | No timezone model — all dates server/UTC | MEDIUM | 🔴 Open |
| M6 | `toIntCents` rounds a value already in cents (100× footgun) | MEDIUM | 🔴 Open (worse — 2nd helper added) |
| **M7** | **RO delete is non-transactional; child-delete errors swallowed; photo files not unlinked** | **MEDIUM** | 🔴 **OPEN (new this pass)** |
| L1 | `claim_links` REAL dollars crossing into RO integer cents | LOW | 🔴 Open |
| L2 | `ro_photos` has no `shop_id`/FK | LOW | 🟡 Mitigated (join-scoped) |
| L3 | No signature artifact for authorization | LOW | 🔴 Open (product/legal) |
| **L4** | **Supplement status casing diverges between the two write paths** | **LOW** | 🔴 **OPEN (new this pass)** |

**The headline of this pass (now resolved):** the C1 fix was scoped to *photos only*, and the identical
IDOR class — an authenticated `GET .../:ro_id` that reads a child table **without re-checking that the RO
belongs to the caller's shop** — was found still live in **two** more places (**C3 claim-links**,
**H6 parts-requests**). All three are now closed, and `5ae275d` added the shared `assertRoOwnership()`
guard (`middleware/roOwnership.js`) that the "Systemic fix" section called for, adopted by
claimLinks/partsRequests/parts. Tenancy remains a per-query convention everywhere else — keep every new
by-ro_id endpoint on the guard, and see "Systemic fix" for the durable DB-level close.

---

## One-page architecture summary (load this first)

**Stack.** React+Vite SPA → built to `frontend/dist`, served as static files by a Node/Express
monolith (`backend/src/app.js`). PostgreSQL via `pg`. Single Railway deployment; start runs `initDb()`
then (`if DATABASE_URL`) `runMigrations()` then `seed.js` then `app.listen`. ~51 route modules, ~31
tables. God file: `backend/src/routes/ros.js` (~2,600 lines).

**Auth/tenancy.** JWT (30-day). `req.user.shop_id` is the tenant key. **Tenancy is a per-route query
convention, not a DB-level guarantee** — every handler must remember `WHERE shop_id = $N` (or a join
that enforces it). This is the single biggest structural risk. Three `GET .../:ro_id` handlers were caught forgetting it —
`photos.js` (C1), `claimLinks.js` (C3), `partsRequests.js` (H6) — **all now fixed**, and `5ae275d`
introduced a shared `assertRoOwnership(roId, shopId)` guard (`middleware/roOwnership.js`) now used by
claimLinks/partsRequests/parts. The correct pattern was always right next to each bug (sibling
`DELETE`/`PATCH`/`POST` handlers scoped properly) — "the safe pattern exists and readers drift off it" —
which the shared helper, or DB row-level security, prevents going forward.

**External integrations.** Stripe (payments + subscription webhooks, raw-body mounted at
`app.js:40-41`; **both webhooks verify the signature** via `stripe.webhooks.constructEvent` in
`services/stripe.js:37` — not forgeable, checked this pass), Twilio (SMS, tier-gated), OpenAI/Anthropic
(estimate OCR + photo damage assessment), QuickBooks (OAuth + invoice sync), SMTP/Resend (email),
Sentry. **Background jobs run inside the web process** (`jobs/monthCarryover.js`,
`jobs/feedbackDailyAudit.js`) fired on startup + interval — no external scheduler.

**The money model is the core hazard.** An RO's finances exist in **three non-reconciling
representations** with **three different numeric types**:
1. `estimate_line_items` — `NUMERIC(10,2)`, DB-generated `total = quantity*unit_price`. The correct path.
   The line-item PATCH route *does* recompute RO financials server-side (`estimateLineItems.js:445`
   `syncRepairOrderFinancials`) — good — but the direct RO PATCH path (H2) bypasses it.
2. `repair_orders` scalar fields — `parts_cost/labor_cost/tax/total/deductible` are **`REAL` (float)**
   (`db/index.js:107,118-122`). The legacy path the **invoice reads from**.
3. `parts_orders` — separate parts lines the invoice also reads.
Insurance/payments are **`INTEGER` cents** (`insurance_approved_amount`, `total_insurer_owed`,
`ro_payments.amount_cents`), but `claim_links.approved_labor/approved_parts/supplement_amount` are
**`REAL` dollars**. A single RO simultaneously carries float dollars, integer cents, and NUMERIC, and
data crosses those unit boundaries as it flows adjuster → estimate → invoice → payment.

**Three core workflows.**
- **RO → estimate → work → invoice → payment:** `AddROModal`→`POST /ros`; estimate via
  `EstimateBuilder`/`estimateLineItems.js` or import via `insuranceOcr.js`/`estimateImport.js`;
  status via `PUT /ros/:id/status` **and** `PATCH /ros/:id` — now unified behind one gate
  (`assertStatusTransitionAllowed`, ros.js:80); invoice `invoice.js` reads scalar REAL fields; payment
  `payments.js`+Stripe → `ro_payments.amount_cents`.
- **Authorization:** **no signature capture exists.** Customer approval = tokenized link click
  (`estimate_approval_links`, `approval.js`); adjuster approval = tokenized form + file upload
  (`claim_links`, `claimLinks.js`) — the token is a **bearer credential** (see C3).
- **Photo/document:** `photos.js` multer disk-storage (uuid filename) → file written **before**
  ownership check (M2) → `INSERT ro_photos` (no `shop_id` column) → served bare at `/uploads` (M3).
  Reads are now shop-scoped via join (C1 fixed).

---

## ✅ Resolved since the last pass (verified in code, kept for context)

### C1 — Cross-tenant photo read (IDOR) — RESOLVED in `379f6c7`
Every `ro_photos` read now joins `repair_orders` and filters `ro.shop_id`: GET `/:ro_id`
(`photos.js:173`), **both** predropoff paths (`:103`, `:70`), POST (`:128`, checks RO ownership first),
and DELETE (`:190`). The predropoff path the prior audit flagged for follow-up is scoped. **Verified.**
Residual: the underlying table still has no `shop_id`/FK (L2) — scoping still depends on every reader
remembering the join, which is the structural root of C3/H6.

### C2 — Supplements overwrite instead of accumulate — RESOLVED in `1734aa4` (spawned H7)
Now an append-only `ro_supplements` ledger; `total_insurer_owed = insurance_approved_amount +
SUM(amount_cents)` over statuses `requested/pending/approved`; `denied/withdrawn` excluded; both the
singular (`ros.js POST /:id/supplement`) and plural (`supplements.js`) paths recompute via
`recomputeSupplementLedgerTotals`; duplicate active submissions are idempotent. Logic verified against
89/89 backend tests. **But the DDL that ships it introduced H7 (below) — the accumulation fix works on
the existing prod DB and breaks the feature on any fresh DB.**

### H1 — `PUT /:id/status` bypassed the gates `PATCH /:id` enforced — RESOLVED in `256e0f2`
One shared `assertStatusTransitionAllowed(ro, toStatus, actor)` (`ros.js:80`) now enforces SIU-hold,
admin-only-reopen, and payment-before-close. Called by **both** `PUT /:id/status` (`ros.js:2272`) and
`PATCH /:id` (`ros.js:2417`); the closed-side effects (`queueClosedReviewEmail`,
`sendClosedPaidInvoiceEmail`, `queueQuickBooksSync`) fire only after the gate passes (`ros.js:2289`).
**Verified.** (Concurrency on this path is still unguarded — see M1.)

---

## CRITICAL

### C3 — Cross-tenant claim-link token leak → PII read + forged adjuster submission  — ✅ RESOLVED in `5ae275d`
> **Fixed & QA-passed:** `GET /ro/:roId` now calls `assertRoOwnership` (404 on a foreign RO) and reads
> `claim_links WHERE ro_id=$1 AND shop_id=$2` — the token can no longer be obtained cross-tenant (it's
> still returned to the owning shop, preserving the copy-link UX). `POST /:roId`'s existing-link lookup
> was scoped too. Scope test asserts the foreign request 404s and *never reaches the claim_links query*;
> 95/95 backend tests. Full trace/fix kept below for the record.
>
**File:** `backend/src/routes/claimLinks.js:127` (`GET /ro/:roId`), mounted at
`/api/claim-links` and `/api/claim-link` (`app.js:82-83`).
```js
router.get('/ro/:roId', auth, async (req, res) => {
  const link = await dbGet('SELECT * FROM claim_links WHERE ro_id = $1 ORDER BY created_at DESC LIMIT 1',
                           [req.params.roId]);          // no shop_id, no RO-ownership check
  res.json(link || null);                                // returns the FULL row incl. `token`
});
```
**Trace.** Any authenticated user of **any** shop calls
`GET /api/claim-links/ro/<another-shop's-ro-id>` and receives that shop's claim-link row —
including the **`token`** and `approved_labor/approved_parts/supplement_amount/adjustor_*`. That
token is the **bearer credential** for the public adjuster routes:
1. `GET /api/claim-links/view/:token` (public, `claimLinks.js:42`) → full RO + **customer PII**
   (`name, phone, email`), vehicle, shop.
2. `POST /api/claim-links/:token/submit` and `/view/:token/submit` (public, `claimLinks.js:99`/`:71`)
   → **writes** `approved_labor/approved_parts/supplement_amount/adjustor_*` into the victim shop's
   claim_link and sets `submitted_at`. Guard is only `if (link.submitted_at) return 400 'Already
   submitted'`.
So one leaked cross-tenant `ro_id` escalates to: (a) read another shop's claim financials + adjuster
identity, (b) read the customer's PII, (c) **write a forged adjuster approval** onto the victim's RO,
or (d) **lock the claim** by submitting first so the real adjuster gets "Already submitted." This is
strictly worse than C1 — it's a cross-tenant **read *and* write / integrity** attack that also
discloses PII. The sibling `POST /:roId` (`claimLinks.js:22`) scopes correctly
(`WHERE id=$1 AND shop_id=$2`), proving the pattern was known and missed here.
**Severity: CRITICAL** (cross-tenant capability-token disclosure → PII read + forged/again-blocked
adjuster submission on another shop's claim).
**Fix.** `claim_links` **has** a `shop_id` column (written at `claimLinks.js:33-34`), so the minimal
fix is to scope: `WHERE ro_id = $1 AND shop_id = $2` with `[req.params.roId, req.user.shop_id]`, and
verify RO ownership first the way `POST /:roId` does. **Better:** don't return the raw `token` from an
authenticated status endpoint at all — return existence/status/`submitted_at`, and only mint/expose the
token through the scoped `POST /:roId` create path. Rate-limit and add expiry checks on the public
`view/submit` routes (an `expires_at` exists on the row — enforce it).
**Edge cases the fix must handle:** an RO with multiple historical links (still return only the
caller's shop's latest); already-submitted links (don't re-expose a live token); the alias mount
`/api/claim-link` (same router, same bug — one fix covers both).
**Verify:** as shop A, `GET /api/claim-links/ro/<shop-B-ro-id>` → `null`/404, **no token**; as shop A on
own RO → own link. Confirm the public `view`/`submit` still work with a legitimately issued token.
**How a weaker model botches it:** scopes the read but keeps returning the `token` field (still lets a
future endpoint leak it), or fixes `claimLinks.js` but leaves the twin IDOR in `partsRequests.js` (H6)
— fix the *class*, not the instance.

---

## HIGH

### H2 — Client controls the invoice total: `total`/`parts_cost`/`tax` are directly PATCHable floats
**Files:** `backend/src/routes/ros.js:2351` (`ALLOWED_PATCH_FIELDS`) → `invoice.js:110-120`
**Trace.** `ALLOWED_PATCH_FIELDS = [...,'parts_cost','labor_cost','sublet_cost','tax','total',...]`
(`ros.js:2351`), so `PATCH /ros/:id {total: 1}` writes the RO's `total` (a `REAL` column) with **no
server recompute**. `invoice.js` then does `baseTotal = Number(ro.total) > 0 ? Number(ro.total) :
subtotal+tax` — the invoice **trusts the client-supplied `total`**. This is also how the estimate and
invoice diverge: editing `parts_cost` directly while `estimate_line_items` holds the old lines means
the customer approved one number and the invoice bills another. (Contrast the line-item PATCH path,
which *does* recompute via `syncRepairOrderFinancials` — the direct RO PATCH is the hole.)
**Severity: HIGH** (invoice total is client-authoritative and can silently disagree with the approved estimate).
**Fix.** Make `estimate_line_items` the single source of truth. Remove `total`/`tax`
(and ideally `parts_cost`/`labor_cost`) from `ALLOWED_PATCH_FIELDS`; compute the invoice from line
items (+ `parts_orders` reconciled into a line-item type) and shop `tax_rate` at render time. If scalar
fields must persist for legacy display, recompute them server-side from line items on every estimate
change — never accept them from the client.
**Edge cases:** ROs with only scalar fields and no line items (backfill or explicit fallback); tax
recomputed on the *same* parts basis that's displayed; delivery fees.
**Verify:** approve an estimate, then `PATCH {total:1}` → invoice still bills the approved line-item total.
**How a weaker model botches it:** strips `total` but leaves `parts_cost`/`tax` writable, so divergence
persists; or recomputes `total` but still lets the invoice prefer a stale `ro.total`. The invoice must derive, not trust.

### H3 — Payment amount is client-supplied and never reconciled to what's owed
**Files:** `payments.js:50-64` (`handleCreateIntent`), webhook `payments.js:169-208` (sets
`payment_received = 1`), close-gate `ros.js:95` (`assertStatusTransitionAllowed`)
**Trace.** `handleCreateIntent` takes `amount` from `req.body`, runs `normalizeAmountCents`, and creates
a Stripe intent for exactly that — the only check is `amountCents` is a positive integer
(`payments.js:61-62`), **never that it equals the RO's owed total**. On webhook success it sets
`payment_received = 1` regardless of amount vs owed (`payments.js:200`) and stores `paid_amount`
(`:204`). The close-gate only checks the boolean `payment_received` (`ros.js:95`
`toStatus==='closed' && !ro.payment_received`). Chain: a `$1` intent → paid → `payment_received=1` → RO
can be closed as "paid" on a `$2000` invoice. Even honest use has a **float→cents boundary**: the
invoice total is a `REAL` dollar; nothing rounds `ro.total*100` and asserts it matches `amount_cents`.
**Severity: HIGH** (underpayment closes ROs; no amount reconciliation; float↔cents drift).
**Fix.** Compute the authoritative owed amount **server-side** (from line items, in cents) and either
(a) ignore the client `amount` and charge the computed owed, or (b) validate `amount_cents === owedCents`
and 400 otherwise. Track `amount_paid_cents` vs `amount_owed_cents`; set a real `payment_status`
(`paid`/`partial`/`unpaid`) and gate close on `paid`, not a boolean. (`paid_amount` is already stored —
use it in the gate.)
**Edge cases:** deposits/partial payments (support explicitly as `partial`, don't let them close);
tips/overpayment; multiple payments summing to owed; refunds reducing `amount_paid`.
**Verify:** intent for less than owed → cannot close; sum of payments === owed → `paid`.
**How a weaker model botches it:** validates `amount > 0` (already the case) instead of `amount === owed`;
or compares a float dollar to cents without rounding. Reconcile in integer cents.

### H4 — Money stored as `REAL` (float) in the invoice/estimate path; import plugs tax
**Files:** `db/index.js` `repair_orders` (`deductible REAL :107`, `parts_cost REAL :118`,
`labor_cost REAL :119`, `tax REAL :121`, `total REAL :122`); `claim_links.approved_* REAL`;
`estimateLineItems.js:54-83` `buildFinancialsFromAdjusterTotals`
**Trace.** Float dollars accumulate representation error; `.toFixed(2)` hides it per-value but sums
drift. Worse, `buildFinancialsFromAdjusterTotals` computes **tax as a plug**: `impliedTax = grossTotal
- parts - labor - sublet` (`:80`), then `tax = impliedTax >= 0 ? impliedTax : lineTax` (`:83`). If an
imported adjuster total is missing a bucket or rounds differently across CCC/Mitchell/Audatex, **the
discrepancy silently becomes "tax,"** and the RO's scalar float fields feed the invoice.
**Severity: HIGH** (systemic: every money read on the invoice path is float; import mis-buckets into tax).
**Fix.** Standardize on **integer cents everywhere** (or `NUMERIC(12,2)` at minimum); arithmetic in
integer cents; dollars only at display. Migrate the `repair_orders` REAL money columns and `claim_links`
REAL columns to `INTEGER` cents with a backfill (×100, round once). In the importer, **do not plug tax**
— carry the adjuster's stated tax; if buckets don't reconcile, flag "needs review" (see H5).
**Edge cases:** existing rows in dollars (backfill ×100 exactly once); mixed cents/dollars during
rollout (feature-flag the read path); negative/zero.
**Verify:** import a known adjuster total with a rounding delta → tax matches the adjuster, not the plug;
sum 1000 line items → exact.
**How a weaker model botches it:** converts columns to NUMERIC but keeps `parseFloat`+`toFixed` math
(reintroduces drift), or migrates the type without ×100-ing existing values (turns `$19.99` into 19¢).
One-time backfill correctness is the whole game.

### H5 — Adjuster/OCR import: brittle parsing, silent missing-field mis-bucketing
**Files:** `insuranceOcr.js` (OCR regex on PDF text), `estimateImport.js` (BMS XML),
`estimateLineItems.js:54-83`
**Trace.** The OCR path scrapes labor/tax by matching **printed line labels** in extracted PDF text —
layout differs across CCC ONE vs Mitchell vs Audatex and across versions, so a format the regex
doesn't match yields empty buckets → the tax-plug (H4) swallows the total, or line items are
misclassified (`R&I`/`RPR`/`RNI` handling is heuristic). Missing/renamed fields degrade **silently**
into a plausible-but-wrong estimate. (The BMS path is structured and safer; OCR is the common one.)
**Severity: HIGH** (garbage-in produces a confident wrong estimate the shop bills from).
**Fix.** Prefer structured BMS/EMS; for OCR, require the parsed result to **reconcile**
(parts+labor+sublet+tax ≈ gross within a cent tolerance) before accepting — otherwise surface a
"couldn't parse cleanly, review manually" state instead of writing derived financials.
**Edge cases:** negative adjustments (betterment/deductible printed negative), multi-page estimates,
locale decimal commas, OCR digit misreads.
**Verify:** feed a Mitchell and a CCC sample; a truncated PDF → flagged for review, not silently imported.
**How a weaker model botches it:** adds more vendor-specific regexes (endless whack-a-mole) instead of a
reconcile-or-flag gate. The gate is the fix; the regexes are the symptom.

### H6 — Cross-tenant `parts_requests` read (IDOR)  — ✅ RESOLVED in `5ae275d`
> **Fixed & QA-passed:** `GET /:ro_id` now uses `assertRoOwnership` + the `repair_orders` join
> (`WHERE pr.ro_id=$1 AND ro.shop_id=$2`) — correct, since `parts_requests` has no `shop_id` column.
> Scope test confirms cross-tenant reads return nothing. Full trace/fix kept below for the record.
>
**File:** `backend/src/routes/partsRequests.js:40-47` (`GET /:ro_id`), mounted at
`/api/parts-requests` (`app.js:85`).
```js
router.get('/:ro_id', auth, async (req, res) => {
  const requests = await dbAll('SELECT * FROM parts_requests WHERE ro_id = $1 ORDER BY created_at ASC',
                               [req.params.ro_id]);      // no shop scope, no RO-ownership check
  res.json({ requests });
});
```
**Trace.** Same class as C1/C3. Any authenticated user calls
`GET /api/parts-requests/<another-shop's-ro-id>` and receives that shop's parts requests —
`part_name, part_number, quantity, status, notes, requested_by` (`db/index.js:298-308`). No PII/token/
money, but it's a cross-tenant **business-data** leak (what parts a competitor is ordering, for which
jobs). The sibling `PATCH /:id` (`partsRequests.js:49`) scopes correctly (joins `repair_orders`, 403 on
mismatch) — pattern known, GET missed. `parts_requests` has **no `shop_id` column**, so the fix must go
through the `repair_orders` join (exactly like the C1 photo fix).
**Severity: HIGH** (cross-tenant read of business data; read-only, no PII/token — hence HIGH not CRITICAL).
**Fix.** Scope through `repair_orders`:
```sql
SELECT pr.* FROM parts_requests pr
JOIN repair_orders ro ON ro.id = pr.ro_id
WHERE pr.ro_id = $1 AND ro.shop_id = $2
```
params `[req.params.ro_id, req.user.shop_id]`. Consider adding a `shop_id` column to `parts_requests`
+ backfill so scoping stops depending on the join (same recommendation as L2 for `ro_photos`).
**Edge cases:** orphaned `ro_id` (return none, don't 500); the route currently has no `requireTechnician`
— decide whether read should be role-gated too.
**Verify:** as shop A, `GET /api/parts-requests/<shop-B-ro-id>` → `[]`; own RO → own requests.
**How a weaker model botches it:** adds `AND shop_id = $2` to the `parts_requests` query — the table has
no `shop_id`, so it errors or matches nothing. Scope via the join.

### H7 — `ro_supplements` schema divergence breaks supplement writes on fresh DBs  — ✅ RESOLVED in `b9c767b`
> **Fixed & QA-passed:** `index.js:346`'s CREATE now includes `description`/`amount`/`submitted_date`
> (matching the canonical migrate.js shape) plus additive `ADD COLUMN IF NOT EXISTS` backfills; the
> CREATE was **not** deleted (so the no-`DATABASE_URL` local path still creates the table). A source-guard
> regression test (`roSupplements.schema.test.js`) locks index↔migrate column parity; 95/95 backend tests.
> Full trace/fix kept below for the record.
>
**Files:** `db/index.js:346` (initDb `CREATE TABLE`), `db/migrate.js:346` (canonical `CREATE TABLE`),
`app.js:161-167` (boot order), INSERTs at `ros.js:1623` and `supplements.js:137`
**Trace.** Boot runs `initDb()` **first**, then `runMigrations()` (`app.js:161-167`). The C2 commit
added a `CREATE TABLE IF NOT EXISTS ro_supplements` to **`index.js:346`** that lists only
`id, ro_id, shop_id, amount_cents, notes, status, created_at, updated_at` — it **omits
`description`, `amount`, `submitted_date`**. The canonical definition in **`migrate.js:346`** has all
of them (`description TEXT NOT NULL`, `amount NUMERIC NOT NULL`, `submitted_date DATE NOT NULL`), but
because `initDb` already created the table, migrate's `CREATE TABLE IF NOT EXISTS` **no-ops** and it
only `ALTER…ADD`s `amount_cents`/`updated_at` — so `description`/`amount`/`submitted_date` are **never
created on a fresh DB**. Both supplement INSERTs write those columns → first supplement submit on a
fresh DB throws `column "description" does not exist` → **500**.
**Blast radius.** **Live prod is unaffected** — its `ro_supplements` predates this commit and already
has the columns; the accumulation fix works there. The break is confined to **freshly provisioned
databases**: staging/preview, disaster-recovery restore into a new DB, a new dev clone, or CI wired to
a real Postgres. It's a silent landmine that surfaces at the worst time (a DR cutover), and it
undermines the durability of the C2 fix.
**Severity: HIGH** (a core money feature is completely broken on any fresh DB; current prod safe).
**Fix.** Make `index.js:346`'s `ro_supplements` definition **match the canonical `migrate.js` shape** —
add `description TEXT NOT NULL DEFAULT ''`, `amount NUMERIC(12,2) NOT NULL DEFAULT 0`,
`submitted_date DATE NOT NULL DEFAULT CURRENT_DATE`. (The INSERTs always supply these, so the
`NOT NULL`s are safe; the defaults are belt-and-suspenders.)
**Edge cases the fix must handle:** do **not** simply delete the `index.js` CREATE — the singular
`POST /:id/supplement` (`ros.js`) does **not** call `ensureSupplementsTable()`, so on a local env with
no `DATABASE_URL` (migrate never runs) the table would then not exist at all → different 500. The
`index.js` definition must exist *and* be complete. Also align FK column types (`index.js` uses `UUID`
FKs; `migrate.js` uses `TEXT`) or keep both `::text`-cast-tolerant as the app already is.
**Verify:** drop a scratch DB, boot, submit a supplement → 201, no `column does not exist`; two
supplements $500 then $300 with $1000 approved → `total_insurer_owed = 1800`; deny the $300 → `1500`.
**How a weaker model botches it:** "fixes" it by deleting the `index.js` CREATE (breaks the no-migrate
local path), or adds the columns to `index.js` but forgets they're `NOT NULL` without a default and a
future non-supplement code path inserts a partial row → new 500.

---

## MEDIUM

### M1 — RO status: read-then-write with no optimistic lock (multi-user last-write-wins)
**File:** `backend/src/routes/ros.js:2270-2281` (`PUT /:id/status`); same shape on `PATCH /:id` and `/:id/assign`
**Trace.** `SELECT * ...` (`:2270`) then unconditional `UPDATE status=$new` (`:2277`/`:2279`) — no
`WHERE status = $expectedFrom`, no version column. Front desk and floor tablet act on the same RO:
tablet `repair→paint`, desk `repair→qc` a second later — both read `from=repair`, both write; **last
write wins**, the lost transition vanishes, and `job_status_log` records **two "from repair" rows**, so
the audit history lies. (H1 fixed the *rules* on this path; it did **not** add concurrency control.)
**Severity: MEDIUM** (real for the stated multi-user product; corrupts the board and the log).
**Fix.** Optimistic concurrency: a `version`/`updated_at` the client echoes, and
`UPDATE ... WHERE id=$1 AND shop_id=$2 AND updated_at=$expected` → 0 rows means "changed underneath you,
refetch." For status, also guard `WHERE status=$expectedFrom` and validate the transition is legal.
**Verify:** two concurrent status writes → one 409, log has one accurate transition.
**How a weaker model botches it:** wraps read+write in a transaction but still no `WHERE`-guard on the
expected prior value — a transaction doesn't stop last-write-wins, only the conditional update does.

### M2 — Photo upload: file written before ownership check → orphaned files
**File:** `backend/src/routes/photos.js:70` (predropoff) and `:128` (main)
**Trace.** `upload.single('photo')` (multer disk storage) writes the file to `uploads/photos/<uuid>`
**before** the handler runs. The handler *then* checks RO ownership (`:135`) and 404s — but the file is
**already on disk** with no `ro_photos` row. The 5-photo-limit rejection (`photos.js:145`) and any
`INSERT` failure orphan a just-written file too. No transaction spans file+row; no `finally unlink`.
Over time orphans accumulate and Railway's limited disk fills, silently.
**Severity: MEDIUM** (silent disk growth + file/DB pair not guaranteed).
**Fix.** Validate RO ownership and the count limit **before** accepting the upload (or use memory
storage and persist only after the DB row is written); on any post-write failure `unlink` in a
`finally`. Add a periodic orphan sweep (files with no `ro_photos` row older than N hours).
**Verify:** upload to a foreign RO / over the limit → rejected **and** no file left on disk.
**How a weaker model botches it:** adds `finally unlink` but keeps disk storage running before the
check, so a crash between write and unlink still orphans. Prefer memory storage or pre-validate.

### M3 — `/uploads` served with no authentication
**File:** `backend/src/app.js:117` — `app.use('/uploads', express.static(...))`
**Trace.** Every uploaded photo/document is world-readable by URL — no auth, no shop scope, no expiry,
no revocation. UUID filenames prevent blind enumeration, but URLs leak (browser history, referer,
shared links, proof-packet exports) and can never be revoked once known — for claim-material photos
that's a lasting exposure.
**Severity: MEDIUM** (mitigated by UUID entropy; still unauthenticated media access to PII).
**Fix.** Serve uploads through an authenticated route that verifies the caller owns the RO the file
belongs to, or issue short-lived signed URLs. Keep the static mount only for non-sensitive assets.
**Verify:** fetch a photo URL without a token → 401; with a foreign-shop token → 403.
**How a weaker model botches it:** puts `auth` in front of `express.static`, but the SPA's
`<img src="/uploads/...">` can't send the JWT header → images break. Needs signed URLs or a
token-in-query authenticated file route.

### M4 — Customer notifications are best-effort with no retry or visibility
**File:** `backend/src/routes/ros.js:134` (`queueStatusSMS`), `:239` (`queueStatusEmail`)
**Trace.** Both run in `setImmediate(async () => { try {...} catch {} })` *after* the response — fire
and forget. A Twilio/SMTP transient failure is caught and logged, but the shop never learns the "your
car is ready" text didn't send; no retry, no dead-letter. Combined with the RO marked done, the
customer silently isn't notified.
**Severity: MEDIUM** (reliability of a customer-facing channel the product is partly sold on).
**Fix.** Persist an outbound-notification record with status (`queued/sent/failed`), retry failures with
backoff, surface failures to the shop ("notification failed — resend").
**Verify:** force a Twilio error → a visible failed-notification row + retry, not just a log line.
**How a weaker model botches it:** naive retry loop inside `setImmediate` with no idempotency key →
double-sends. Persist + idempotency key first.

### M5 — No timezone model: all dates are server-time/UTC
**Files:** `jobs/monthCarryover.js:9,23` (`billing_month < TO_CHAR(NOW(),'YYYY-MM')`), schema
`estimated_delivery DATE`
**Trace.** `NOW()` is the DB timezone (UTC on Railway). `billing_month` derives from `created_at` (UTC);
carryover compares `billing_month < TO_CHAR(NOW(),'YYYY-MM')`. Near a month boundary a shop's local
"still January" is UTC "February," so January ROs carry over hours early (and promised-delivery / month
rollups land a day off). There is **no shop-timezone concept anywhere**, and `estimated_delivery` (a
date customers are told) is computed/compared in server time.
**Severity: MEDIUM** (off-by-a-day on delivery promises and revenue-period rollups; worse outside US-Central).
**Fix.** Add `shops.timezone`; compute month/day/business-hours boundaries in the shop's TZ (store UTC,
render/roll in local). Carryover and delivery-date math must use shop-local month/day, not `NOW()` UTC.
**Verify:** a shop at UTC-8 at 11pm on the last of the month → carryover does not fire until local midnight.
**How a weaker model botches it:** hardcodes a single offset (e.g., America/Chicago) instead of per-shop
TZ — just moves the bug for shops elsewhere.

### M6 — `toIntCents` rounds a value already in cents — 100× footgun by name
**File:** `backend/src/routes/ros.js:438`
```js
function toIntCents(value) { ... return Math.round(n); }  // does NOT multiply by 100
```
**Trace.** Despite the name, it rounds a number callers must already have in cents. It's now **worse**:
the C2 fix added a *separate* `dollarsToCents(d) = Math.round(d*100)` in `supplements.js`/`ros.js`, so
two cents helpers with **opposite input conventions** coexist. `toIntCents(500.00)` returns `500`
("cents" = $5.00) — a silent 100× underbill — while `dollarsToCents(500)` returns `50000`. Given the
H4/H5 import paths produce **dollar** floats, one wrong helper choice is a live money bug.
**Severity: MEDIUM** (latent; name/behavior mismatch on a money helper, now with a look-alike twin).
**Fix.** Rename `toIntCents` → `roundToIntCents` (asserts "input already cents"); keep a single
`dollarsToCents`; audit every caller to confirm the unit it passes.
**Verify:** grep all `toIntCents(`/`dollarsToCents(` callers; each provably passes the right unit.
**How a weaker model botches it:** "fixes" `toIntCents` to multiply by 100 — instantly 100×-ing the
supplement flow that already passes cents. The safe change is rename + audit, not behavior change.

### M7 — RO delete is non-transactional; child-delete errors swallowed; photo files not unlinked  *(NEW)*
**File:** `backend/src/routes/ros.js:2517-2554` (`DELETE /:id`)
**Trace.** Ownership is correctly checked (`:2520-2525`) and every child delete is shop-scoped — good —
but the cascade is a sequence of separate `dbRun`s, most wrapped in `.catch(() => {})` (`:2534-2553`),
with **no surrounding transaction**. If a middle delete fails it's **silently swallowed** and the
sequence continues; if the process dies mid-cascade you get a **partially-deleted RO** (some children
gone, parent or later children remaining). Separately, `ro_photos` **rows** are deleted but the
**files on disk** under `uploads/photos/` are **not** `unlink`ed — every RO deletion leaks its photo
files (compounds M2's orphan growth).
**Severity: MEDIUM** (partial/inconsistent deletes with no error surfaced; unbounded disk leak on delete).
**Fix.** Wrap the whole delete in a single transaction (`BEGIN…COMMIT`, `ROLLBACK` on any error) so it's
all-or-nothing; don't swallow child-delete errors — let them roll the transaction back and 500. Before
(or after successful commit) `unlink` the RO's photo files (fetch `photo_url`s first, delete files in a
`finally`/post-commit step, tolerate already-missing files).
**Edge cases:** children added later that also lack CASCADE (audit the FK graph); files already missing;
very large photo sets (batch the unlinks); concurrent access to the same RO mid-delete.
**Verify:** force a child-delete error → the whole delete rolls back (RO still fully present), not a
half-deleted RO; after a successful delete, the RO's files are gone from disk.
**How a weaker model botches it:** keeps the per-statement `.catch(()=>{})` "to avoid FK errors" inside
the transaction — swallowing the error defeats the rollback. Let it throw.

---

## LOW

- **L1 — `claim_links` money is `REAL` dollars crossing into RO `INTEGER` cents.** When an adjuster's
  `approved_labor/approved_parts/supplement_amount` (float dollars) flow into the RO's integer-cents
  fields, there's a unit conversion with rounding. Fold into H4's cents standardization.
- **L2 — `ro_photos` has no FK on `ro_id` and no `shop_id`** (`db/index.js`). Structural cause of the
  IDOR class (C1/C3/H6 all exist because child tables can't be scoped by a column, only a join). Add
  `shop_id` + FK + backfill so scoping stops depending on every reader remembering the join. Same
  applies to `parts_requests` (H6).
- **L3 — No signature artifact for authorization** (`estimate_approval_links`, `claim_links`). Approval
  is a token click; for a legally meaningful "authorization to repair / direction to pay," capture and
  store a signed artifact + signer identity/timestamp/IP. (Product/legal, not a code defect.)
- **L4 — Supplement status casing diverges between the two write paths** *(NEW)*. The singular route
  (`ros.js`) writes lowercase statuses (`requested/approved/denied/withdrawn`); the plural route
  (`supplements.js`, `VALID_STATUSES = ['Pending','Approved','Denied','Withdrawn']`) writes Title-case.
  Both land in the same `ro_supplements.status`. It's non-breaking **only because**
  `recomputeSupplementLedgerTotals` compares with `LOWER(...)` — but any consumer that filters
  `status = 'approved'` (e.g., `supplements.js:177-180`'s validator message still says "Pending,
  Approved, or Denied") will disagree with itself. Normalize on one casing at write time.

---

## Systemic fix — the IDOR class (option 1 landed in `5ae275d`)

C1, C3, and H6 were the **same bug three times**: an authenticated `GET .../:ro_id` (or `.../:id`)
reading a child table without re-checking the RO belongs to `req.user.shop_id`.

1. **✅ Shared ownership guard — done.** `5ae275d` added `assertRoOwnership(roId, shopId)`
   (`middleware/roOwnership.js`), returning the RO or null (callers 404), adopted by
   claimLinks/partsRequests/parts. Mandate it for every new by-ro_id route — cheap and greppable in review.
2. **DB-level tenancy — still recommended.** Add `shop_id` to the child tables that lack it
   (`ro_photos`, `parts_requests`), backfill, and consider Postgres **row-level security** keyed on a
   per-request `shop_id` GUC so a forgotten `WHERE` can't leak across tenants at all. This removes the
   class, not just the instances — fold it in when the money-layer work (H2–H4) is touching the schema anyway.

Until (2) lands, treat every new by-ro_id endpoint as a tenancy review gate and require the guard.

---

## Priority order for the next sessions
_C1, C2, C3, H1, H6, H7 are shipped/QA-verified as of `b9c767b` — the cross-tenant + fresh-DB arc is closed.
Remaining, in order:_
1. **H3 / H2** server-authoritative money: reconcile payment amount + stop trusting client `total`.
2. **H4 / H5** integer-cents standardization + import reconcile-or-flag (largest; deliberate, with backfill).
3. **M1** optimistic-lock / last-write-wins guard on status + field edits.
4. **M7 / M2** RO-delete transaction + photo-file unlink; upload orphan sweep.
5. **M3 / M4** `/uploads` authenticated serving; durable notifications with retry/visibility.
6. **M5 / M6** shop timezone model; `toIntCents` rename + caller audit.
7. **DB-level tenancy** (Postgres row-level security) as the durable close on the IDOR class — see "Systemic fix."

Every finding above was read in the actual code (audited at `256e0f2`; resolutions verified through
`b9c767b`). Nothing here is speculative; each has a concrete failure trace and a fix whose failure modes
for a careless implementer are called out inline.
Verified-safe on this pass (ruled out as false positives): `users.js` PUT/reset-password (scoped guard
before unscoped update), `estimateLineItems.js` item PATCH, `parts.js /ro/:roId`, `export.js`,
`supplements.js` plural PATCH, and both Stripe webhooks' signature verification.
