# SPEC — REVV Full Experience Redesign

> Master build spec for the REVV UI/UX redesign + branded print + landing/demo. Paste-ready for Codex.
> **Pipeline:** each PHASE = one commit → Claude Code QA → Hermes ships. Run phases IN ORDER; do not start
> the next until the prior is QA-green. Build only; do NOT push/deploy.
> Repo: `/Users/zordon/.openclaw/workspace/Revv`. Created this session; visual direction approved by Bryan.

---

## Context & locked direction

This is a visual + UX redesign and a few new features — **NOT** a rewrite of business logic. The money
layer (`services/roMoney.js`: server-authoritative invoice/payment in integer cents) shipped already and
MUST be reused, never re-derived.

**Visual reference artifacts (Bryan can share):**
- UI screens: `claude.ai/code/artifact/b5e1bfc3-370f-4bd6-b01d-599e168211dc`
- Landing/app: `claude.ai/code/artifact/06764851-8fe1-4ac7-bb63-b6ea6a1995be`
- 30s demo: `claude.ai/code/artifact/3109fd87-50ce-40ad-adfb-bf2aef774fb7`
- Branded print: `claude.ai/code/artifact/76825665-cee7-4ab2-b33b-062db275f0f6`

### Design language — "Instrument" (derived from REVV's logo: an R built from a tachometer)
- **Ground (dark):** void `#0F1117` · panel `#1A1D2E` · panel-2 `#1D2132` · raised `#242942` ·
  hairline `#94A0B8` @10%/@20% · ink `#EAEEF7` · muted `#94A0B8` · faint `#5A6480`.
- **Brand:** indigo `#6366F1` (lit `#8B8FFF`, deep `#4844C7`).
- **Gold:** `#EAB308` (lit `#FACC15`) — the logo's needle; reserved for MONEY.
- **Semantic:** good/paid `#10B981` · danger/overdue/total-loss `#F26D6D`.
- **COLOR RULE (kills today's page-to-page drift — enforce everywhere):**
  - Indigo = brand + navigation + neutral primary UI + links + neutral-metric gauges.
  - Gold = money & opportunity ONLY: revenue/profit/supplement surfaces + revenue-generating primary
    actions (New RO, File Supplement, Take Payment).
  - Green = paid/success. Red = overdue/danger/total-loss. Never use gold as a generic accent.
- **Signature motifs:** (a) gauge arcs for goal/margin metrics; (b) a horizontal PRODUCTION-LINE
  tachometer (8 status stages as bars, current load lit indigo, over-promise stage "redlined" gold);
  (c) ALL numbers — money, %, counts, clocks — in tabular monospace (`font-variant-numeric: tabular-nums`).
- **Type (locked):** **Bricolage Grotesque** is THE display face everywhere — page titles, KPI/section
  headings, and the landing hero (distinctive, editorial, memorable). Self-host it (OFL/free — `@font-face`
  under `frontend/public/fonts`, no CDN hotlink). Keep the existing body stack for running/paragraph text.
  Data/numbers ALWAYS monospace (`ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo`).
- **Logo:** use the real assets in `frontend/public/` (`revv-app-icon`, `icon-192/512`,
  `revv-logo-wordmark.png`). For the DARK UI use a **transparent** version of the mark (the SVG icon, or a
  produced transparent PNG) — NOT the white-background jpg. Never invent a logo.

### Global guardrails (every phase)
- Do NOT push/deploy; commit locally per phase. Do NOT merge to main.
- Do NOT mutate/seed/reset customer/shop/RO/payment data. Do NOT alter Miles Automotive data.
- Do NOT boot a backend against the hosted DB (`.env` → `switchback.proxy.rlwy.net`). Backend tests mocked-only.
- Do NOT touch the unrelated in-flight tree changes (`auth.js`, `ShopRegister.jsx`, users terms-acceptance cols).
- Reuse `services/roMoney.js` for ALL money; integer cents; no float math, no client-set totals.
- Any new by-ro_id / by-shop query MUST be shop-scoped (reuse `middleware/roOwnership.js`). The new
  `/search` endpoint (Phase 2) is the highest IDOR risk — scope it hard and test it.
- Preserve all existing functionality, routes, roles, and the shipped status/close/supplement logic.
- **Per-phase DONE gate:** `node --check` changed backend files · `node --test` (new tests + full sweep) ·
  `cd frontend && npm run build` · `git diff --check` · `git ls-files frontend/dist` == 0. Emit a read-only
  Claude Code QA prompt (SHA) after each phase, then STOP.

---

## Phase 1 — Design system foundation
Goal: one token system every screen inherits; real logo; real light theme; shared primitives.
1. `tailwind.config.js` + `src/index.css`: define the full palette as CSS custom properties on `:root`
   (dark default). Add a REAL light theme via `:root[data-theme="light"]` token overrides (paper `#F7F8FB`
   surfaces, `#14171F` ink, accents tuned for contrast). **DELETE** the `filter: invert(1) hue-rotate`
   light-mode hack entirely. Map Tailwind semantic colors to tokens.
2. Self-host **Bricolage Grotesque** (OFL) as THE display face — `frontend/public/fonts` + `@font-face`,
   token `--font-display` used for all headings/titles AND the landing hero. Body keeps the system stack
   (`--font-body`); numbers always `--font-mono`. Set the type scale (display/heading/body/mono) as tokens.
3. Shared components (new, `src/components/ui/`):
   - `<Logo variant="mark|wordmark">` using the real transparent asset.
   - `<Money cents>` — single app-wide money renderer (integer cents → tabular-mono dollars).
   - `<GaugeArc value max>` — 270° arc gauge (indigo default; gold/green props).
   - `<StatusBadge status>` — restrained status-dot chip system (replaces today's rainbow).
   - `<StatInstrument label value gauge>` — the KPI card.
Verify: existing screens still render; light theme shows correct semantic colors (paid=green, danger=red),
NOT inverted; build clean; grep shows zero `filter: invert`.

## Phase 2 — Dashboard + global search
Goal: the command-center dashboard, and ⌘K search.
1. Instrument KPI row: Active Jobs (pipeline mini-bars), Revenue MTD (indigo GaugeArc to goal), True Profit
   (green GaugeArc, margin), Supplement Opportunity (GOLD card). Values via `<Money>`/roMoney.
2. PRODUCTION LINE tachometer (8 stages, counts, indigo bars, gold redline on any over-promise stage).
3. "NEEDS YOU NOW" focus list — the 3 highest-signal items (payment-ready→Close, unfiled supplement→File,
   overdue promise→Text). Left status stripe, tag, one action each.
4. Global command palette: `<CommandPalette>` (⌘K/Ctrl-K) in `components/Layout.jsx`, backed by new
   `routes/search.js` → `GET /api/search?q=` — **STRICTLY shop-scoped** (`WHERE shop_id=$1`), searches
   ro_number/customer/plate/vin/claim_number, ranked, LIMIT-ed, indexed. Mount in `app.js`.
Tests (mocked): foreign-shop term → no results (shop-scope) & own RO jumps; KPIs read cents from roMoney.

## Phase 3 — Repair Orders + RODetail
Goal: refined board + decluttered RO detail with the Supplement Finder as hero.
1. `RepairOrders.jsx`: clean table — RO# (indigo mono), Customer, Vehicle (muted), StatusBadge, Promise
   (red if overdue), Total (right, `<Money>`), Pay chip, View. Filter chips.
2. `RODetail.jsx` (2,928-line god screen — refactor carefully, do NOT change business logic):
   - Header: RO#/vehicle/claim left; RIGHT = ONE primary action (`Advance › <next>`) + compact cluster
     (`+ Supplement`) + overflow `…` menu. Kill the 8-button row.
   - Horizontal STATUS STEPPER (done=indigo, current=gold, upcoming=muted).
   - Flatten tab-in-tab → single tab row (Overview · Insurance · Parts · Customer · Comms · Photos).
   - Overview: left "Job & money" card (roMoney figures, tabular); RIGHT = SUPPLEMENT FINDER as GOLD HERO
     card ("$X opportunity found", flagged line, "File supplement" gold CTA). Keep existing endpoints.
   - Keep all shipped gates (payment-before-close, SIU, reopen) and status/supplement logic intact.
Tests (mocked): status gates still enforced; each tab renders; finder still calls existing analyze/parse.

## Phase 4 — Per-shop logo + branded print/invoice
Goal: shops upload their own logo; it shows next to their name and leads the printed RO + invoice, with a
tasteful REVV self-promo footer.
1. Logo upload: authed, shop-scoped upload endpoint (multer, `image/*`, size-limited, like `photos.js`)
   → store file, set `shops.logo_url` (column exists; used in `market.js`). Validate ownership; don't
   weaken auth. Settings › Shop upload UI (preview/replace/remove). Show shop logo next to shop name in
   `Layout.jsx` header (fallback to REVV mark if none).
2. Branded PRINT/PDF for BOTH the invoice (`invoice.js` already emits a PDF) and a NEW Repair Order print:
   - Header LEADS with SHOP logo + name + address/phone (+ shop accent if set).
   - Body: customer/vehicle/insurance + line items + totals — money from roMoney (cents, exact).
   - Authorization block (signature line) on the RO.
   - FOOTER: subtle single line — small REVV mark + "Estimated & tracked with REVV · revvshop.app" —
     muted, centered, must NOT overtake the shop's branding. pdfkit: embed shop logo + REVV mark.
Tests (mocked): invoice/RO totals equal roMoney (cents); upload rejects foreign shop / non-image; REVV
footer text present; no float money in the PDF path.

## Phase 5 — Landing + 30-second demo
Goal: the new front door with the demo embedded.
1. Redesign the hero in the Instrument language (real wordmark, indigo/gold, value prop, primary
   "Start free" + "Watch REVV run · 0:30").
2. Port the 30-second demo (reference artifact) into a self-contained React/Canvas component in the hero:
   the 5-beat sequence (hook "$1,450 short" → floor → the catch → payout → CTA), the synthesized Web-Audio
   score (cinematic mix), autoplay muted + "play with sound" gesture, reduced-motion fallback. VOICEOVER:
   the reference demo already ships a REAL neural-voice VO (edge-tts, en-US-AndrewNeural) as 8 embedded
   audio clips scheduled to the beats — port it as-is (or a single mp3), played on the sound gesture with a
   graceful no-VO fallback. Optional future upgrade: swap in an ElevenLabs mp3 in the same slot. (Bryan can
   hand you the reference demo HTML to adapt.)
3. Keep existing marketing sections (pricing, features) restyled to the system.
Tests: build clean; component mounts and respects reduced-motion; no external asset hosts (CSP-safe).

## Phase 6 — Propagate the system (the rest of the app)
Goal: every remaining screen inherits the tokens/components so nothing looks half-redesigned.
Apply Phase-1 tokens + shared components across Customers, Schedule, Inventory, PartsOnOrder, Payments,
Reports, MonthlyReport, OwnerKpis, JobCosting, Settings, TimeClock, FloorMode, TechView, the portals
(Claim/Approval/Track/Book), and empty states. Enrich thin Customer cards (vehicle/RO counts). Fix the
"undefined-undefined days" guard in the Turnaround Estimator. Confirm ONE consistent accent system and the
real light theme on every screen.
Tests: build clean; spot render dark + light at 1440px & 390px; no raw `#hex` where a token exists; no
inverted semantics in light mode anywhere.

---

## Delivery
6 QA-gated commits (split any phase that exceeds ~10 files — e.g. Phase 6 by area). Each emits its Claude
Code QA prompt. No push, no main merge, no data mutation, `frontend/dist` untracked, all backend tests
mocked & green, money always via roMoney in integer cents. **Bryan supplies:** the licensed display font
and (optionally) a transparent REVV mark PNG + an upgraded ElevenLabs VO. The 30s demo + a real neural VO
(edge-tts Andrew) already exist as a reference artifact to port.
