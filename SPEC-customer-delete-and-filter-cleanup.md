# SPEC — Customer Delete Guard + RO Filter Cleanup

## Context
Live prod (Miles shop). Two dogfood findings 2026-06-18.

## Phase 1 — Customer delete FK guard (CRITICAL)
File: backend/src/routes/customers.js  (router.delete /:id, ~line 179)

Bug: customers.id is referenced by repair_orders.customer_id, vehicles.customer_id,
users.customer_id — all NO ACTION (no cascade). Current handler only nulls
users.customer_id then deletes the customer, so any customer with a vehicle or RO
throws a foreign-key violation and returns 500.

Required behavior (Bryan confirmed: block, do not delete, when ROs exist):
1. SELECT count(*) FROM repair_orders WHERE customer_id = id AND shop_id = shop.
2. If count > 0: do NOT delete. Respond HTTP 409 with JSON fields:
   error = 
