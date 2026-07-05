# REVV — Missed-Ops & Supplement Intelligence Engine (Phased Build Spec)
_Authored 2026-07-02 (Hermes). Pairs with SPEC-revv-vs-ccc-mitchell-phased-build.md (Pillar A) and REVV-SPARK-OCR-SPEC.md (estimate ingestion)._

## 0. Strategic thesis
ALLDATA and RepairLogic sell OEM *knowledge*. REVV already ingests the insurer-written CCC ONE estimate via OCR. The winning move is to apply a missed-operations ruleset to the estimate REVV already parsed — flagging not-included operations, quantifying recoverable supplement dollars, and generating an OEM-cited liability/approval PDF. This is RepairLogic's whole value prop, delivered inside the shop-management app the tech is already using. No re-keying, no second tool.

Positioning line: "REVV reads your CCC estimate and tells you what the insurer left off — before you eat the supplement."

## 1. Scope (v1) — narrow on purpose
Start with the 5 highest-frequency, highest-liability missed operations. Do NOT license a full OEM database (that is ALLDATA's moat and cost sink). Build a curated, citable ruleset:
1. **Pre-repair & post-repair scans** (diagnostic health scan) — near-universally required, frequently omitted.
2. **ADAS calibrations** (static/dynamic) triggered by ADAS-equipped VIN + affected sensor zone.
3. **Corrosion protection / cavity wax** on any panel replacement or welded repair.
4. **Weld-bonding / rivet-bonding & related consumables** on structural panel R&R.
5. **Feature/road-test checks** (blind-spot, lane-keep, park assist) when collision area overlaps the system.

Each rule = trigger condition (from parsed estimate + VIN decode) + OEM/position-statement citation + estimated labor/parts value range.

## 2. Data inputs (already available)
- Parsed CCC ONE estimate lines (from OCR pipeline): operations, panels, part types, labor ops.
- VIN → decode year/make/model + ADAS-equipment flags (free NHTSA vPIC VIN API; ADAS flag via curated make/model/year map for v1).
- Damage area / impact points (from estimate metadata or manual tag at intake).

## 3. Phases
Each phase: Hermes pre-flight -> Codex build -> Claude Code QA (must execute the analyze path on a real seed estimate) -> Hermes review -> ship + post-deploy live-verify on demo RO.

### Phase 1 — Ruleset engine + Missed-Ops scan (core)
- WHAT: `missedOps.js` service — takes a parsed estimate + VIN, returns an array of flagged ops {rule_id, title, why, citation, est_value_low, est_value_high, confidence}.
- WHY: this is the offense feature; turns imported estimate into found money.
- HOW: deterministic rules first (trigger conditions on parsed line items); AI (existing OpenAI lane) only for fuzzy op-name matching + plain-English rationale, never for the money math. Curated JSON ruleset in repo (versioned), 5 rules v1.
- GATE: on a seed CCC estimate missing a post-scan + calibration, engine flags both with citations and a $ range; zero false-positive on an estimate that already includes them.

### Phase 2 — Supplement Finder screen (per RO)
- WHAT: first-class "Missed Ops" tab on the RO — list of flags, each expandable to citation + $ range, with check/dismiss + "add to supplement" action.
- WHY: makes the intelligence actionable at the point of work; ties into existing supplement/analyze surface from positioning spec Pillar A.
- HOW: React screen consuming Phase 1 endpoint; dismiss/accept persists to RO; accepted items roll into a supplement total.
- GATE: owner opens an RO, sees flagged ops, accepts 3, and a running "recoverable supplement" total updates.

### Phase 3 — OEM-cited Liability / Approval PDF
- WHAT: one-tap export: "These N operations were omitted — OEM citation + reason each," branded, ready to send to the insurer/customer.
- WHY: this is the "get approvals faster / reduce liability" quadrant from the competitor poll; documentation is what wins supplement approvals.
- HOW: server-side PDF from accepted flags + citations; reuse existing PDF/branding infra.
- GATE: generated PDF lists each accepted missed op with a real citation string and $ value; opens cleanly; matches shop branding.

### Phase 4 — Dashboard money tile + gating
- WHAT: dashboard tile "Supplement found / captured this month" (count + $ + capture %); gate the whole engine to Pro/Agency tiers.
- WHY: proves ROI to the owner (the buyer) and monetizes the differentiator.
- HOW: aggregate accepted/captured flags over the period; Stripe tier gate consistent with existing free/pro/agency model (free = preview count only, no PDF/detail).
- GATE: dashboard shows shopwide recoverable + captured %; free tier sees a locked teaser, paid sees full detail.

## 4. Explicitly NOT building (v1)
- Full OEM procedure database (ALLDATA's moat — cite curated position statements instead).
- Auto-submission to insurer DRP pipes.
- More than 5 rules (expand only after measuring $ recovered from v1).

## 5. Success metric
Dollars of supplement flagged and captured per shop per month. If v1 five-rule engine surfaces real recoverable dollars on Miles' insurer-written CCC PDFs, expand the ruleset. That number is the whole business case.
