# SPEC: REVV id-type cast regression guard + silent-catch fix

## Context
Prod bugs (claim tracker Could-not-load, bulk status operator-does-not-exist text=uuid) were caused by a schema where PARENT tables (repair_orders, shops, customers, vehicles) use TEXT primary keys while 17 child tables use UUID PKs (and notifications has a text PK with uuid FKs). Cross-type id comparisons without ::text casts throw at runtime. Already fixed case-by-case (claimTracker.js, ros.js bulk, notifications.js all cast ::text). No ::uuid casts remain in routes. This spec prevents RECURRENCE + clears 1 LOW.

## Known facts (do not re-derive)
- Parent PKs are TEXT: repair_orders.id, shops.id, customers.id, vehicles.id.
- Mixed-type tables (uuid PK or uuid FKs vs text): analytics_events, estimate_requests, inspections, notifications, parts_inventory, proof_packet_links, rental_inventory_items, ro_internal_notes, ro_inventory_items, ro_supplements, shop_reviews, sms_messages, storage_charges, vehicle_diagnostic_scans.
- The established safe pattern is ::text on BOTH sides of any cross-table id comparison (see existing backend/test/typeCastRoutes.test.js).

## Phase 1 — Regression guard test (backend/test/idTypeCastGuard.test.js, node:test)
WHAT: A static source-scan test over backend/src/routes/*.js that FAILS if a forbidden pattern reappears.
Assert, across ALL route files:
1. No `= ANY($N::uuid[])` and no `= $N::uuid` casts anywhere in routes (the bulk-status bug). Use regex; fail listing file:line.
2. Every SQL JOIN predicate of the form `<alias>.id = <alias>.<something>_id` (or reverse) that touches repair_orders/shops/customers/vehicles parents OR any mixed-type table MUST have ::text on both sides. Pragmatic heuristic: for each routes file, find lines matching /JOIN\s+(repair_orders|shops|customers|vehicles|notifications)\b/ and the following ON predicate; if the ON compares two dotted columns without ::text on both, fail. Keep it conservative to avoid false positives on text=text where both are already known-safe — but since adding ::text is always safe, the rule is simply: cross-table id JOIN predicates must cast ::text both sides.
3. Keep/merge the existing typeCastRoutes.test.js assertions (claimTracker + ros bulk patterns) so coverage is not lost.
WHY: turns a recurring prod-500 class into a CI failure.
GATE: `node --test backend/test/` passes; deliberately break one cast (remove ::text from one notifications JOIN) and confirm the guard FAILS, then restore.

## Phase 2 — Clear LOW silent catch
WHAT: backend/src/routes/diagnostics.js line ~112 `} catch (e) {}` — add `console.error("[diagnostics] suppressed:", e.message);` inside (no behavior/flow change). Leave the estimateAssistant.js best-effort fs.unlinkSync temp-cleanup catch as-is.
GATE: node --check passes; grep confirms no remaining empty `catch (e) {}` in diagnostics.js.

## Out of scope (deliberately deferred)
- Schema normalization migration (unifying all id columns to one type). High-risk on live prod DB with real customer (Miles) data; requires backup + planned migration window + Bryan go. NOT in this build.
