# REVV vs CCC and Mitchell — Positioning + Phased Build Spec
_Authored 2026-06-01 (Hermes). Strategy doc — no code. Pairs with SPEC-monthly-goals.md._

## 1. Core strategic insight
CCC ONE and Mitchell (Enlyte) are estimatics + DRP platforms, not shop-operations platforms. Their moat is the labor-time / parts / OEM-procedure database they license to insurers. Do NOT try to out-data them. REVV wins by sitting ON TOP of their estimate (already OCR-imported) on the layer they neglect: shop operations, tech/owner experience, customer communication, supplement/profit intelligence.

Positioning line: "Bring your CCC or Mitchell estimate. REVV runs the shop around it — better, faster, and the customer actually sees it."

## 2. Competitor profile
CCC ONE — Strong: insurer DRP integration, estimating-data moat, parts network, scale. Weak: insurer-first, dated UI, heavy onboarding, opaque/high pricing, weak customer comms, weak tablet floor UX.
Mitchell/Enlyte — Strong: OEM repair procedures, MOTOR labor data, diagnostics adjacency, insurer ties. Weak: insurer-first, complex, expensive, fragmented surface, dated UX, comms is a bolt-on.
Open field neither does well: owner profit visibility; modern branded customer status portal + SMS; tech-floor tablet UX; fast self-serve onboarding + transparent pricing; storage/total-loss/SIU as native flows.

## 3. Comparison (shop-operations lens)
| Capability | CCC | Mitchell | REVV today | Opportunity |
|---|---|---|---|---|
| Estimatics labor DB | owns | owns | OCR import | stay importer, add intelligence |
| Insurer DRP pipe | yes | yes | claim tracker (partial) | not v1 priority |
| Supplement flagging | weak | weak | analyze engine | HEADLINE feature |
| Customer portal + SMS | bolt-on | bolt-on | TrackPortal/Claim | make it the brand |
| Tech tablet mode | weak | weak | TechView (partial) | dedicated floor mode |
| Owner profit/KPI | reporting | reporting | partial | margin/RO, capture pct |
| Total loss/storage/SIU | generic | generic | native | promote |
| Modern responsive UI | dated | dated | modern (verify live) | premium polish |
| Self-serve onboarding | no | no | yes | growth lever |

## 4. Differentiation pillars
- P-A Supplement and profit intelligence — turn the imported estimate into found money.
- P-B Customer experience — branded live status, photos, SMS, approvals.
- P-C Floor operations — tech tablet mode, parts/paint/QC handoffs, storage/total-loss.
- P-D Owner truth — margin/RO, cycle time, supplement capture pct, tech efficiency.
- P-E Frictionless adoption — import CCC/Mitchell PDFs, self-serve setup, transparent price.

## 5. Phased build spec (each phase: Codex build -> Claude Code QA -> Colonel review -> ship)
### Phase 0 — Verify and harden (prereq, mostly QA)
- Live dogfood pass 375/768/1440px screenshots of every authed screen (closes review HIGH-1).
- Standardize AI error sanitization across insuranceOcr /analyze + estimateAssistant (HIGH-2).
- Fix siu/total-loss resume fallback + basename-pin photo delete (MED-3/MED-4).
- Exit gate: 0 critical, responsive proof attached.
### Phase 1 — Supplement and Profit Intelligence (Pillar A) [HIGH ROI, do first]
- Promote insurance-ocr/analyze into a first-class Supplement Finder screen per RO.
- Per-RO margin card: insurer-allowed vs shop value vs captured supplement.
- Dashboard tile: total supplement found / captured this month (pct).
- Exit gate: owner sees money left on the table per RO and shopwide.
### Phase 2 — Customer Experience as the brand (Pillar B)
- Unify TrackPortal/ClaimPortal into one branded shop-logo status page.
- Milestone SMS for every status incl intake/qc (fills LOW-2), opt-in compliant.
- Customer-visible photo timeline; approval + e-sign in same portal.
- Exit gate: intake to delivery fully visible + branded.
### Phase 3 — Floor Operations mode (Pillar C)
- Dedicated tech tablet Floor Mode: todays cars, my ops, clock in/out, photo capture.
- Clean parts->repair->paint->QC handoff with blocker states.
- Make inspection a visible board stage if wanted (MED-1).
- Exit gate: a tech runs a full day from a tablet, no desktop.
### Phase 4 — Owner Truth dashboard (Pillar D)
- KPIs: cycle time per stage, touch time, supplement capture pct, margin/RO, tech efficiency.
- Surface existing month carryover + turnaround estimator here.
- Exit gate: one screen = shop health.
### Phase 5 — Adoption and scale (Pillar E)
- Polished CCC/Mitchell PDF import wizard.
- Self-serve onboarding refinement + transparent pricing page.
- Rate-limit + abuse protection on public AI/OCR endpoints (LOW-3).
- Exit gate: new shop live in under 30 min from their existing estimate.

## 6. Explicitly NOT building
- Our own estimatics labor-time DB (their moat — import instead).
- Deep insurer DRP integrations as a v1 priority.
