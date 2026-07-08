# FABLE_PRODUCT.md — REVV Product & Strategy Assessment

> Product-quality and strategy review (Fable 5), companion to `FABLE_AUDIT.md` (reliability) and the
> forthcoming `MARKET_ANALYSIS.md` (competitive). Grounded in the actual screens and code, not
> generalities. The **public surface (Landing, Login) was rendered live** at desktop 1440px and iPhone
> 390px; the **authenticated surface was read from code** — the backend could not be booted safely (the
> only `backend/.env` points `DATABASE_URL` at the hosted Railway DB, and no local Postgres exists, so a
> live authenticated walk would have meant touching production/Miles data). Where a claim needs a live
> backend to confirm, it's marked. No code was modified this session.

---

## Snapshot verdict (details at the end)

- **Where REVV sits today: ~6 / 10** as a product. Genuinely feature-rich, collision-native, clean on
  the surface, with two real differentiators (supplement finding, floor mode) and a coherent owner
  dashboard. Held back by a money layer whose numbers can't yet be fully trusted (audit H2/H3/H4),
  brittle OCR under its two headline features (H5), an empty day-1 trial, and a 2,928-line RO god
  component that will slow every future change. The just-closed security arc (C1/C2/C3/H1/H6/H7) moved
  it from "don't ship" to "shippable."
- **Realistic ceiling: ~8.5 / 10** — a sticky collision-shop OS for independent 1–5-location shops that
  wins on *supplements + profit + floor + customer experience*, living **alongside** CCC/Mitchell, not
  replacing them.
- **The one sentence that should drive the roadmap:** *"REVV found me $X in supplements last month I'd
  have missed."* Everything below serves making that sentence true and provable.

---

## What REVV actually is (grounded)

A React+Vite SPA (48 pages, 28 components) on an Express/Postgres monolith, sold at **$199/mo flat**
(14-day free trial, no card) as *"Modern Shop Management. Built for Real Shops"* for
**collision · mechanical · PDR** shops — positioned as *"built for shops that live in insurance"*
(rendered Landing copy). The IA (`components/Layout.jsx:21-46`) spans ~20 destinations in 5 groups —
Core (Dashboard, ROs, Customers, Schedule, Timeclock), Operations (Parts, Inventory, Storage, Floor
Mode, Tech View, ADAS, Vehicle Diagnostics, Estimate Requests), Financial (Payments, Job Costing, Owner
KPIs), Insights (Reviews, Reports), Admin (Team, Settings) — with a mature role model
(owner/admin/assistant/tech), multi-language, and dark/light themes. This is a real product, not a toy.

---

## Phase 1 — Walking the product

### 1. The chaotic Monday (12 open ROs, angry customer, adjuster on the phone)

**Where it genuinely helps:**
- **The owner's Dashboard is a real control center** (`pages/Dashboard.jsx:699-800`). Clickable KPI
  cards — Active Jobs (with % -of-goal bar), Completed, Total Revenue, **True Profit**, and
  **Supplement Opportunity** — each drilling into a filtered RO list, plus an actionable alert strip
  (`:803-824`): "N carryovers need revenue assignment," "N ADAS calibrations pending," pending
  appointments. In 5 seconds the owner sees what's on fire and clicks into it.
- **The adjuster call has a purpose-built home.** `pages/RODetail.jsx` mounts an `InsurancePanel`,
  `ClaimTrackerPanel`, `ClaimStatusCard`, `SupplementFinderPanel`, and `VehicleDiagram` (imports at
  `:8-23`), organized under an Insurance sub-tab (`:1182`). While on the phone the owner can see claim
  status, generate a tokenized **claim link** for the adjuster (`claimLinks.js`), and run the supplement
  finder to argue for more money — all from one RO.
- **Production keeps moving without the owner.** `pages/FloorMode.jsx` is a touch-first 4-column kanban
  (parts→repair→paint→qc, `:10-16`) filtered to each tech's assigned ROs, with big tap targets
  (`min-h-14`), optimistic "Move to next" with rollback (`:93-111`), **geolocation-verified clock-in**
  (`:22-34,113-129`), and quick bay photo capture. The angry customer gets **auto-SMS** on every status
  change (`ros.js queueStatusSMS`), so "is my car ready?" is answered before they call.
- **Customer comms need no account** — tokenized tracking + payment links (`TrackPortal`, `portal.js`),
  exactly as the Landing promises.

**Where it gets in the way:**
- **No global search / command palette.** When the adjuster says "I'm calling about the Camry, claim
  #48821," there is no way to jump straight to that RO — you go to `/ros` and scan/filter. For a
  phone-in-hand, 12-ROs-open Monday, this is the single biggest friction. (Confirmed absent: `Layout.jsx`
  has a back button and nav, no search input; no `Cmd-K` handler anywhere.)
- **RODetail is a 2,928-line god component with tabs inside tabs** — Overview → {Core, Insurance,
  Customer, Technician, Parts, Communication} (`:1170-1213`) plus a Storage tab. Mid-call, reaching
  claim info + a claim link + logging a supplement is several nested clicks. It works, but it's deep.
- **The numbers you quote may not be the numbers you bill.** Per the audit, the invoice trusts a
  client-editable `ro.total` (H2), payment isn't reconciled to what's owed (H3), and the money path is
  float (H4). On a live adjuster call that's a credibility risk: the supplement/total on screen isn't
  guaranteed to match the invoice the customer later gets.

### 2. What REVV does that CCC ONE's shop tools don't (or does better)

Honest framing first: **CCC ONE owns the estimate and the DRP/insurer workflow.** REVV wisely does
**not** try to be an estimating platform (see §5). Within *shop management*, three things REVV does that
CCC's shop tooling — and most SMS/tracking competitors — don't do as well:

1. **Supplement finding, not just supplement tracking.** `SupplementFinderPanel.jsx:119-156` uploads a
   CCC/Mitchell estimate (or reads RO line items), runs `/insurance-ocr/analyze`, and surfaces
   **per-line supplement opportunities in dollars**, sorted, with a total — the engine behind the
   Dashboard "Supplement Opportunity" KPI. This is *money-finding*, the highest-leverage revenue lever
   in collision. CCC estimates the job; REVV tells the shop where it's under-billing.
2. **A purpose-built floor experience.** `FloorMode.jsx` (touch kanban + geolocated clock-in + bay
   photos) is a better bay/tech experience than CCC's desktop-centric shop tools.
3. **Owner profitability foregrounded.** "True Profit" and Job Costing put per-job margin front-and-
   center (`Dashboard.jsx:734-744`, `JobCosting`), which CCC does not surface for the shop the same way.

If the honest answer to "what's the moat" is asked bluntly: **it's #1, and it's not fully realized yet**
(the finder is real but rides brittle OCR and has no closed-loop reporting). #2 and #3 are strong
supporting acts.

### 3. What's missing that makes an owner *tell another owner*

Not feature padding — a multiplier on what exists: **turn "Supplement Opportunity" from a passive number
into a provable, closed loop.** The referral sentence is *"REVV found me $4,200 in supplements last month
I'd have missed."* To earn it, REVV needs (a) a finder the owner **trusts** (fix OCR reconcile, H5), (b)
a monthly **"supplements found → requested → approved → $ realized"** report, and (c) a **worklist nudge**
("3 ROs have unaddressed supplement opportunities"). The parts are all already here (finder, ledger from
the C2 fix, dashboard KPI) — they're just not wired into a loop. That's spec #1 below.

Second-order gaps that hurt daily: **global RO search** (§1), and **trustworthy money** (without it, no
owner bets their billing on the tool).

### 4. First-impression audit (60-second trial)

- **Landing (rendered, desktop + mobile): strong.** Modern dark theme, crisp typography, a clear value
  prop, a "LIVE RO SNAPSHOT" card, honest pricing ($199/mo, 14-day trial, no card), and clean responsive
  behavior (nav collapses, hero scales, CTAs stack at 390px). It looks like a product you'd trust your
  business to.
- **Login (rendered): clean and professional** — logo, "AUTO BODY SHOP MANAGEMENT," shop-credentials
  copy, create-account link.
- **The seam is *after* signup.** Onboarding (`pages/Onboarding.jsx`) is a tidy 3-step wizard whose
  first-RO step smartly leads with **"Import your existing estimate — upload a CCC or Mitchell PDF"**
  (`:129-131`) — but then a fresh shop lands on an **empty dashboard**: no sample data, so the KPI cards,
  supplement finder, and floor board — REVV's best features — are all blank on day 1. Empty states exist
  and aren't broken ("No jobs assigned yet," `Dashboard.jsx:672`; "No completed jobs yet this week,"
  `:912`), but there's nothing to *react to*. The product's value is data-gated and day-1 has no data.
- **Two polish dings:** Onboarding uses a **gold accent** (`#EAB308`, `Onboarding.jsx:73,102`) that
  clashes with the **indigo** brand everywhere else — a visible seam from being built at a different
  time. And the Landing pushes **"Get the App"** prominently while the app is "coming soon" — a small
  expectation mismatch.

Net: the marketing surface earns trust; the empty first-run risks squandering it before the differentiated
features ever appear.

### 5. What REVV should refuse to build

- **Refuse to become an estimating platform.** Competing with CCC/Mitchell/Audatex on estimate authoring
  is capital-intensive, is their moat, and would destroy REVV's actual wedge (the management + supplement
  + profit layer *on top of* their estimates). **Import, don't author.** The current OCR-import direction
  is correct; keep it one-way-in.
- **Refuse a parts catalog / marketplace.** Bryan already scoped this right: track *ordered* parts and
  their status (`PartsOnOrder`), not a catalog or store. Don't drift into inventory-SKU-management or a
  parts marketplace.
- **Refuse to rebuild accounting.** The QuickBooks integration (`services/quickbooks.js`) is the right
  call — sync out, don't become the ledger.
- **Watch the breadth.** ADAS, Vehicle Diagnostics, Storage Hold, Inventory, Timeclock, Reviews,
  Leads, Goals, Job Costing are each defensible in collision, but that is a large surface for a small
  team and every one competes for the attention that should be **deepening the 2–3 features that win
  (supplements, profit, floor).** The risk isn't any single feature — it's spreading thin instead of
  making the wedge undeniable.

---

## Phase 2 — Top 3 product improvements (implementation specs)

Ordered by leverage. Each is scoped so another model can execute without re-deriving the reasoning.
All three assume the money-layer audit items (H2–H4) are on a parallel track — spec #1 in particular is
only as trustworthy as the numbers under it.

### Improvement #1 — Close the loop on Supplement Opportunity (the wedge)

**Why:** This is the one capability that is both differentiated *and* tied directly to shop revenue —
the referral sentence in §3. Today the pieces exist but don't form a loop: the finder surfaces
opportunities (`SupplementFinderPanel.jsx`), the ledger records supplements (the C2 fix,
`ro_supplements`), and the dashboard shows a single aggregate KPI (`Dashboard.jsx:745-755`) — but nothing
connects *found → requested → approved → realized*, and nothing nudges the owner to act.

**What to build:**
1. **A "Supplements" report** (new `pages/SupplementsReport.jsx` + backend aggregate endpoint, e.g.
   `GET /api/reports/supplements` in a new/expanded `routes/reports.js`). Per month, per RO: opportunity
   surfaced (from the finder), amount requested, amount approved, amount realized (paid by insurer),
   and the **gap** (found-but-not-requested). Source the "realized/requested/approved" side from the
   `ro_supplements` ledger (`amount_cents`, `status`) — **must be shop-scoped** (`WHERE shop_id = $1`;
   reuse the `assertRoOwnership`/shop-scope discipline from `5ae275d` so this doesn't become a new IDOR).
2. **A dashboard worklist**, not just a number. Turn the "Supplement Opportunity" card
   (`Dashboard.jsx:745-755`) into a click-through to a list of **specific ROs with unaddressed
   opportunity** ("3 ROs · $4,200 unrequested"), each linking to `RODetail` Insurance tab with the
   finder pre-opened.
3. **Trust the finder's inputs.** Gate the OCR path (`insuranceOcr.js`) behind the reconcile-or-flag
   rule from audit **H5** so the finder never surfaces opportunity off a mis-parsed estimate (parts +
   labor + sublet + tax must ≈ gross within a cent tolerance, else "review manually").

**Files:** `frontend/src/components/SupplementFinderPanel.jsx`, `frontend/src/pages/Dashboard.jsx`
(:745-755 card → worklist), new `frontend/src/pages/SupplementsReport.jsx` + a nav entry in
`components/Layout.jsx` (Financial group), backend `routes/insuranceOcr.js` (reconcile gate),
`routes/estimateLineItems.js` (opportunity calc, already present), new report endpoint aggregating
`ro_supplements`.

**Edge cases:** denied/withdrawn supplements excluded from "realized" (the ledger already models this);
opportunity double-count across re-analysis (dedupe by RO+line); months with zero activity (empty state,
not a 500); shops on the free/basic tier if supplement finder is gated (respect `subscriptions.js` tiers).

**Verification:** create a test RO with a $1,000 approved amount, run the finder to surface a $500
opportunity, request+approve it via the supplement flow, and confirm the report shows found $500 →
realized $500 and the dashboard worklist drops that RO. Feed a deliberately mis-parsed estimate → the
finder refuses to surface a bogus opportunity (H5 gate).

**How it gets botched:** building the report off the *float* `repair_orders.supplement_amount` display
field instead of the `ro_supplements` ledger (double-counts / can't show status); or surfacing
opportunity from an unreconciled OCR parse (erodes the exact trust the feature is meant to build). Source
of truth = the ledger; inputs = reconciled parses only.

### Improvement #2 — Global command palette + RO quick-jump

**Why:** Directly kills the biggest chaotic-Monday friction (§1): with an adjuster on the phone there's
no way to jump to an RO by number/customer/plate/claim. High daily-use value, modest effort.

**What to build:** a `Cmd/Ctrl-K` command palette + a top-bar search in `components/Layout.jsx` (the
header at `:411-457` is the natural home). It searches ROs by `ro_number`, `customer_name`, `plate`,
`vin`, and `claim_number`, and also jumps to nav destinations. Backed by a new
`GET /api/search?q=` endpoint that is **strictly shop-scoped** (`WHERE shop_id = $1`, using the
`assertRoOwnership`/join discipline) and returns a small ranked mix of ROs + customers.

**Files:** `frontend/src/components/Layout.jsx` (mount palette + keybind), new
`frontend/src/components/CommandPalette.jsx`, new backend `routes/search.js` mounted in `app.js`.

**Edge cases:** debounce + minimum query length (don't hammer the DB per keystroke); rank exact
`ro_number`/`claim_number` matches first; role-scope results (a tech shouldn't surface financial-only
entities); empty/no-match state; keyboard nav + escape; must never cross tenants (this is a *new query by
free text* — the highest-risk place to reintroduce the IDOR class the audit just closed, so shop-scope is
non-negotiable and should have a test like `claimLinks.scope.test.js`).

**Verification:** as shop A, search a term matching a shop-B RO → no results; search own RO number →
instant jump; `Cmd-K` opens/closes; arrow+enter navigates.

**How it gets botched:** a search endpoint that forgets `shop_id` (re-opens the exact IDOR class from
C1/C3/H6); or `ILIKE '%q%'` across huge tables with no index/limit (slow). Scope + limit + index the
searched columns.

### Improvement #3 — Trial "first 90 seconds": per-shop demo data + guided empty states

**Why:** First-impression is where trials convert or churn (§4), and REVV's value is data-gated — day 1
is blank. Lighting up the dashboard, finder, and floor board immediately is the difference between "I see
it" and "I'll come back later" (they won't).

**What to build:**
1. **"Load sample shop" on first run** — a per-shop demo-data generator (a handful of ROs across statuses:
   one mid-floor, one in `estimate` with a supplement opportunity, one `delivery` unpaid, one closed with
   profit) triggered by a button in `Onboarding.jsx`, clearly labeled and **one-click removable**. It
   must be **shop-scoped and isolated** from the global `db/seed.js` (which is app-wide demo seeding) —
   generate into the new shop's `shop_id` only, and never touch other shops (respect the data-safety
   floor; this is *sample* data the owner can wipe, not a reset).
2. **Guided empty states** on Dashboard / RepairOrders / FloorMode: each blank state gets one primary CTA
   ("Import your first estimate" / "Create an RO" / "Assign yourself a job") instead of a bare "No jobs
   yet."
3. **Unify the onboarding accent** from gold `#EAB308` to the indigo brand (`Onboarding.jsx:73,76,102`,
   etc.) so the first authenticated screen matches the marketing surface.

**Files:** `frontend/src/pages/Onboarding.jsx` (accent + "Load sample" + "Start empty"), new backend
`POST /api/shops/demo-data` + `DELETE /api/shops/demo-data` (shop-scoped generator/teardown, distinct
from `db/seed.js`), empty-state blocks in `Dashboard.jsx`, `RepairOrders.jsx`, `FloorMode.jsx`.

**Edge cases:** demo data must be visually flagged (e.g., a "Sample" badge) so it's never mistaken for
real jobs; teardown must remove *only* demo rows (tag them, e.g., `is_demo = true`, scoped to the shop);
idempotent (clicking twice doesn't double-seed); must not fire real SMS/email/QuickBooks side effects for
demo ROs (guard the notification/integration hooks when `is_demo`).

**Verification:** create a fresh shop → "Load sample shop" → dashboard KPIs, supplement finder, and floor
board all populate; no SMS/email sent; "Remove sample data" returns the shop to empty; a second shop sees
none of the first's demo data.

**How it gets botched:** reusing the global `db/seed.js` (pollutes all shops / not removable), or letting
demo ROs trigger real customer SMS/QuickBooks syncs (audit-relevant: the status-change side effects in
`ros.js` fire on write — they must be suppressed for `is_demo`). Tag, scope, and suppress.

---

## Verdict — where REVV is, its ceiling, and the path

**Today: ~6 / 10.** REVV is a real, collision-native shop-management product with a polished marketing
surface, a coherent owner control center, a genuinely good floor experience, and — most importantly — a
differentiated *supplement-finding* capability that ties to shop revenue. It is dragged down from a 7–8 by
four things, in priority order: (1) **the money layer can't yet be fully trusted** (audit H2/H3/H4 — the
invoice trusts a client-editable total, payments aren't reconciled, money is float); for a tool shops
*bill from*, this is the ceiling-setter. (2) **The two headline features (import, supplement finder) ride
brittle OCR** (H5). (3) **Day-1 trial is empty**, hiding the best features. (4) **The 2,928-line RO god
component** (and the ros.js god file behind it) will slow every future change. The just-shipped security
arc (C1/C2/C3/H1/H6/H7) was the price of admission — it moved REVV from "must not ship" to "shippable,"
but it doesn't add product value; it removes disqualifiers.

**Realistic ceiling: ~8.5 / 10.** A beloved, sticky operating system for independent collision shops
(1–5 locations) that wins on **supplements + profit + floor + customer experience**, priced accessibly,
sitting *alongside* CCC/Mitchell rather than fighting them. It will not become a 10 (that would require
owning the estimate + DRP hub, which it should not chase — §5). 8.5 is "shops fight to keep it and tell
peers about it," which is the stated goal.

**The ordered path from 6 to 8.5:**
1. **Trust the numbers.** Land the money layer (audit H2→H3→H4): server-authoritative invoice from line
   items, payment reconciled to owed, integer cents end-to-end. Nothing else matters if the billing math
   is suspect. *(This is audit work, but it is product-blocking — it's step 1 of the product path too.)*
2. **Sharpen the wedge (Improvement #1).** Close the supplement loop and make it provable — the referral
   engine.
3. **Win the trial (Improvement #3) + kill daily friction (Improvement #2).** Demo data + guided empty
   states so day 1 sells itself; global search so the chaotic Monday flows.
4. **Then breadth polish.** Reduce RODetail/ros.js complexity as you touch them; unify visual seams;
   revisit the "coming soon" mobile-app promise.

Do these in order and REVV crosses from "impressive but I'm not sure I trust it with my billing" to "the
tool that finds me money and I'd fight to keep." That crossing is entirely reachable from where the code
is today.

---
*Grounded in: rendered Landing/Login (desktop 1440 + iPhone 390); code — `Layout.jsx`, `Dashboard.jsx`,
`FloorMode.jsx`, `Onboarding.jsx`, `RODetail.jsx`, `SupplementFinderPanel.jsx`, `EstimateImportWizard.jsx`,
`App.jsx` routes; and `FABLE_AUDIT.md` for the reliability constraints (H2–H5, M5). Authenticated screens
were read, not run — the backend could not be booted without touching the hosted/production DB.*
