# REVV Spark-OCR Spec — Local-first Insurance Estimate Extraction
> Drafted 2026-06-22. Goal: make Spark the PRIMARY estimate-extraction engine; demote OpenAI/Anthropic to confidence-gated fallback. $0 per estimate on the happy path.

## Context (pre-flight findings)
- `backend/src/routes/insuranceOcr.js` already does the full flow: upload → pdf-parse text OR rendered images → LLM → strict JSON contract (SYSTEM_PROMPT).
- Today: text path = OpenAI gpt-4o; image path = Anthropic claude-haiku-4-5. Both PAID, every call.
- Spark (http://spark:11434, provider ollama-spark) has: qwen2.5vl:7b (vision), batiai/qwen3.6-27b:q4 (text). Free, owned GPU.
- Existing tests: insuranceOcr.notifyOps.test.js, estimateImport.test.js, estimateTotals.test.js, bmsParser.test.js — must stay green.

## Design
- Mirror the existing fns with Spark equivalents, SAME SYSTEM_PROMPT + SAME JSON contract:
  - parseEstimateTextWithSpark(text, prompt)   → POST /api/chat, model batiai/qwen3.6-27b:q4, format=json
  - parseEstimateImagesWithSpark(urls, prompt)  → POST /api/chat, model qwen2.5vl:7b, images[]
- Orchestration: Spark FIRST → validate result → fall back to existing paid path only if Spark fails/unreachable/low-confidence.
- Confidence gate (no new ML): required fields present + estimate_totals numeric + grand_total reconciles within tolerance. Fail → escalate to paid, notifyOps logs WHY.
- Env toggle: REVV_OCR_PRIMARY = spark | openai (default spark). SPARK_OCR_BASE_URL = http://spark:11434. Timeout + 1 retry, then fallback.
- No secrets to Spark; it's loopback/tailscale internal. No PII leaves the network on happy path (privacy WIN for insurance data).

## Phases
### Phase 1 — Spark text path (primary for text PDFs)
WHAT: add parseEstimateTextWithSpark + route text extraction through Spark first, OpenAI fallback.
WHY: most CCC ONE PDFs are text-based; biggest cost chunk, lowest risk.
HOW: new fn + orchestration branch + REVV_OCR_PRIMARY flag; reuse sanitize + JSON parse + validation.
GATE: on existing text fixtures, Spark JSON matches paid output field-for-field (totals reconcile); all current tests green; fallback fires when Spark down.

### Phase 2 — Spark vision path (scanned/image estimates)
WHAT: add parseEstimateImagesWithSpark via qwen2.5vl:7b; route image path through Spark first, Anthropic fallback.
WHY: scanned estimates are the other half; closes full local coverage.
HOW: render pages to data URLs (existing code) → Spark vision → same JSON contract.
GATE: a scanned sample extracts core fields locally; low-quality scan auto-falls-back to Anthropic and is logged.

### Phase 3 — Confidence gate + observability
WHAT: formal confidence check + ops-notify on every fallback + per-extraction engine tag (spark|openai|anthropic) stored.
WHY: prove $ savings + catch silent quality regressions; Miles must never get a worse extraction than today.
HOW: validation fn returns {ok, reasons[]}; notifyOps on fallback; persist engine + confidence on the import record.
GATE: low-confidence doc escalates + logs reason; happy-path doc records engine=spark; dashboard/log shows fallback rate.

## Pipeline
Codex builds each phase → Claude Code QA (must EXECUTE: hit a real Spark call + run the OCR test suite) → Hermes reviews diff+verdict → ship. ≤10 files/session. Commit-guard after each. Ship gate = 0 CRITICAL + 0 unresolved HIGH.

## Risks / NOT-doing
- Don't rip out OpenAI/Anthropic — they're the fallback floor.
- Spark is single-GPU/bursty: estimate parsing is user-triggered + rate-limited (15/10min) so contention is low, but Phase 3 logs latency to confirm.
- Quality must be >= today. If Spark underperforms on real Miles PDFs, REVV_OCR_PRIMARY=openai reverts instantly with zero redeploy.
