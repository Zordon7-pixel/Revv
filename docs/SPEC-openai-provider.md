# OpenAI-only REVV AI — 2026-09-26

Bryan requested OpenAI for REVV AI going forward. All runtime AI call sites now use the shared `services/openai.js` client. Supplier/eBay data, tracking, payments and SMS still require their own service connections; an AI model does not replace those systems.

Migrated workloads:
- Part-label photo extraction → OpenAI vision, reviewed JSON candidates.
- Uploaded damage-photo assessment → OpenAI vision, existing optional-assessment behavior.
- Estimate-assistant scan → OpenAI vision, existing zone mapping and suggestion workflow.
- Estimate extraction/recovery → existing OpenAI gpt-4o path only. Removed Anthropic authentication fallback; deterministic parsing, preserved readable rows, PDF text/image fallback and relaxed-prompt retries remain.

Configuration: server-only `OPENAI_API_KEY`, optional `OPENAI_VISION_MODEL` (default gpt-4.1-mini) and `OPENAI_ESTIMATE_MODEL` (default existing gpt-4o). Defaults preserve fast photo assessment and the existing estimate workload rather than changing every workload to a flagship. Calls use the official OpenAI endpoint, JSON response mode, explicit output bounds, `store: false`, 45-second timeout, and one SDK retry. Incomplete/refused responses fail reviewably; no second AI provider receives data. Anthropic dependency removed. No model key or secret is emitted in logs or client responses. `store: false` is not a claim of zero provider retention.

Migration tests: 48 targeted/integration checks plus 7 deterministic-parser checks cover OpenAI client/model settings, request image shape, JSON response handling, refusal/truncation/provider failure, part matching, and estimate upload/intake/recovery/error reporting. Independent review passed, including a final 25-check rerun with real PostgreSQL. Provider fixtures test code paths; live OpenAI quality/billing/access are not verified because no local OpenAI key exists. Railway CLI returned unauthorized, so production configuration could not be inspected. No production configuration was changed and this branch was not deployed.

The eBay developer registration page was opened at https://developer.ebay.com/signin?tab=register. The user must enter a new password and complete license acceptance/account verification. No registration, production keyset, or Browse approval is claimed. Resume the retained browser tab after the user completes that checkpoint; do not invent account details or credentials.

Official reference: https://developers.openai.com/api/docs/guides/images-vision and https://developers.openai.com/api/docs/models/gpt-4.1-mini .
