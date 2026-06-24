const { dbRun } = require('../db');

const RESOLVED_STATUSES_SQL = "('shipped', 'closed', 'wont_fix')";

async function closeEstimateImportSuccessNoise() {
  const result = await dbRun(
    `UPDATE feedback
     SET status = 'closed',
         routed_to = COALESCE(NULLIF(routed_to, ''), 'Codex'),
         support_note = COALESCE(
           NULLIF(support_note, ''),
           'Daily feedback audit auto-closed this row because it is an estimate-import success notification, not an error.'
         ),
         linked_ref = COALESCE(NULLIF(linked_ref, ''), 'daily-feedback-audit'),
         resolved_at = COALESCE(resolved_at, NOW()),
         updated_at = NOW()
     WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') NOT IN ${RESOLVED_STATUSES_SQL}
       AND COALESCE(tester_name, '') = 'Auto-Reporter'
       AND message ~* '^\\[AUTO\\]\\s+[0-9]+\\s+items imported from insurance estimate'`
  );
  return result.rowCount || 0;
}

async function assignOpenUnassignedFeedback() {
  const result = await dbRun(
    `UPDATE feedback
     SET status = CASE
           WHEN COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') = 'new' THEN 'assigned'
           ELSE status
         END,
         routed_to = CASE
           WHEN LOWER(COALESCE(category, '')) IN ('feature', 'idea', 'question') THEN 'Hermes'
           ELSE 'Codex'
         END,
         assigned_at = COALESCE(assigned_at, NOW()),
         support_note = COALESCE(
           NULLIF(support_note, ''),
           'Daily feedback audit assigned this open item for agent review.'
         ),
         updated_at = NOW()
     WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') NOT IN ${RESOLVED_STATUSES_SQL}
       AND COALESCE(NULLIF(TRIM(routed_to), ''), '') = ''`
  );
  return result.rowCount || 0;
}

async function runFeedbackDailyAudit() {
  const closedNoise = await closeEstimateImportSuccessNoise();
  const assigned = await assignOpenUnassignedFeedback();
  return { closedNoise, assigned };
}

module.exports = {
  runFeedbackDailyAudit,
  closeEstimateImportSuccessNoise,
  assignOpenUnassignedFeedback,
};
