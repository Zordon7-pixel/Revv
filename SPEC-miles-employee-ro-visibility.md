# SPEC - Fix employee/staff cannot see shop ROs (3b-M1 regression)

## Context
Live prod regression on Miles Automotive. The 3b-M1 hardening (commit 97d2825) over-applied. In backend/src/routes/ros.js GET / handler, self-only visibility is forced when the caller rank is BELOW admin. ROLE_RANK has technician=2, employee=2, staff=2 (all below admin=3), so employee and staff get a forced WHERE ro.assigned_to=self and see ZERO shop ROs when none are assigned to them. Confirmed live: assistant=41 visible, employee=0, staff=0. Intent of 3b-M1 was ONLY to stop Floor-Mode technicians from browsing coworker jobs, NOT to hide the shop board from front-desk employee/staff.

## Phase 1 - Restrict self-only RO filter to the technician role only
WHAT: In ros.js GET / handler (~line 777) change the assignedFilter logic so the forced self-filter (assignedFilter = req.user.id) applies ONLY when actorRole === technician. All other roles (owner, admin, assistant, employee, staff, superadmin) get full shop-wide visibility.
WHY: employee/staff are general shop roles that must see the whole RO board. Only literal technician (Floor Mode) should be scoped to own assignments.
HOW: isTechnicianOnly = actorRole===technician -> assignedFilter=req.user.id (forced). else if rank at/above admin or superadmin -> assignedFilter = normalizedTechId || normalizedAssignedTo (optional, unchanged). else (employee/staff/assistant below admin, non-technician) -> assignedFilter = EMPTY (no forced filter). Keep ro.shop_id=$1 scoping exactly as-is. No schema change. Do NOT touch POST/create gate.
GATE: add backend/src/__tests__/ros.roleVisibility.test.js asserting technician forces assigned_to=self; employee/staff/assistant/admin/owner do NOT force it and get all shop ROs; shop_id scoping present for every role. Existing ros tests stay green. Touch ONLY backend/src/routes/ros.js + the new test (max 2 files).

## Out of scope
ROLE_RANK values, middleware/roles.js, create/POST gate, frontend, schema, migrations.
