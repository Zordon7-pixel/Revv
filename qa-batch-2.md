# REVV QA Batch 2 — Findings
Pages: JobCosting, Landing, Login, MonthlyReport, Onboarding, PartsOnOrder, Payments, Performance, Portal, PublicEstimateRequest, RODetail, Register, RepairOrders

Audited: 2026-03-18

---

## CRITICAL / HIGH

### [HIGH] Portal.jsx — `Clock` component used but not imported
**Line:** ~137 (inside `ro.pending_parts` render block)
**Description:** `<Clock size={14} />` is rendered in the "Still waiting on parts" section, but `Clock` is not included in the `lucide-react` import on line 2. When any RO has `pending_parts`, React will throw `TypeError: Clock is not a function` (or similar), crashing the entire portal for customers.
**Import line 2 has:** `Phone, Car, Calendar, LogOut, Wrench, Truck, AlertTriangle, Package, CheckCircle` — `Clock` is absent.
**Fix:** Add `Clock` to the lucide-react import.

---

## MEDIUM

### [MEDIUM] Portal.jsx — Missing `.catch()` on both API calls in useEffect
**Lines:** 40–41
```js
api.get('/portal/my-ros').then(r => setRos(r.data.ros || []))
api.get('/portal/shop').then(r => setShop(r.data))
```
**Description:** Neither call has a `.catch()` handler. Network errors or 401s will produce unhandled promise rejections. The customer portal shows nothing and gives no feedback on failure.
**Fix:** Add `.catch(() => {})` or set error state on both calls.

---

### [MEDIUM] RODetail.jsx — `advance()` has no try/catch
**Lines:** 322–328
```js
async function advance() {
  const idx = STAGES.indexOf(ro.status)
  if (idx < STAGES.length - 1) {
    await api.put(`/ros/${id}/status`, { status: STAGES[idx+1] })
    load()
  }
}
```
**Description:** If the `api.put` fails (network error, 4xx/5xx), the rejection is unhandled. The UI gives no feedback and the button appears to do nothing.
**Fix:** Wrap in try/catch with an `alert` or toast on failure.

---

### [MEDIUM] RODetail.jsx — `updatePartsReqStatus()` has no try/catch
**Lines:** 384–387
```js
async function updatePartsReqStatus(reqId, status) {
  await api.patch(`/parts-requests/${reqId}`, { status })
  loadPartsRequests()
}
```
**Description:** No error handling. Failed requests are silently swallowed.
**Fix:** Wrap in try/catch.

---

### [MEDIUM] Performance.jsx — Potential null crash on `stat.avg_hours_per_ro.toFixed(1)`
**Line:** 122
```js
<td className="text-right text-slate-300 px-4 py-3">{stat.avg_hours_per_ro.toFixed(1)} hrs</td>
```
**Description:** If the backend returns `null` or `undefined` for `avg_hours_per_ro` (e.g. a tech with no completed ROs), calling `.toFixed()` on it throws `TypeError: Cannot read properties of null`. Also at line 142 in the summary footer: `s.avg_hours_per_ro * s.ros_completed` — multiplying null by a number produces `0` silently but the `.toFixed(1)` call on line 122 is the hard crash path.
**Fix:** Use `Number(stat.avg_hours_per_ro || 0).toFixed(1)`.

---

### [MEDIUM] RODetail.jsx — `copyClaimLink()` clipboard write has no try/catch
**Lines:** 300–305
```js
async function copyClaimLink() {
  const url = `${window.location.origin}/claim/${claimLink.token}`
  await navigator.clipboard.writeText(url)
  setLinkCopied(true)
  setTimeout(() => setLinkCopied(false), 3000)
}
```
**Description:** `navigator.clipboard.writeText` throws if clipboard permission is denied (common in non-HTTPS or certain browser configs). Unhandled rejection.
**Fix:** Wrap in try/catch.

---

## CLEAN — No Issues Found

| File | Result |
|------|--------|
| JobCosting.jsx | Clean — all hooks before JSX return, try/catch in `load()` |
| Landing.jsx | Clean — no hooks, pure JSX |
| Login.jsx | Clean — all hooks at top, both async fns have try/catch/finally |
| MonthlyReport.jsx | Clean — all hooks at top, error handling in effects |
| Onboarding.jsx | Clean — all hooks at top, try/catch in `saveStepOne()` |
| PartsOnOrder.jsx | Clean — early returns are after all hooks; useEffect has `.catch()` |
| Payments.jsx | Clean — all hooks at top, mounted-flag pattern correct |
| PublicEstimateRequest.jsx | Clean — early return after `done` is after all hooks |
| RODetail.jsx | Clean for hooks — `damagedPanels` useMemo was previously moved above early return (line 617); see issues above for missing try/catch in helpers |
| Register.jsx | Clean — all hooks at top, try/catch/finally in `submit()` |
| RepairOrders.jsx | Clean — all hooks at top, comprehensive error handling |

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 |

**Highest priority fix:** Portal.jsx `Clock` import — will crash the customer portal whenever a pending part exists.
