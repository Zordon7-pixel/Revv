const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearJobCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}src${path.sep}jobs${path.sep}feedbackDailyAudit.js`)
      || key.includes(`${path.sep}backend${path.sep}src${path.sep}db${path.sep}index.js`)
    ) {
      delete require.cache[key];
    }
  }
}

test('daily feedback audit closes success-notification noise then assigns remaining open rows', async () => {
  clearJobCache();
  const calls = [];
  installMock(require.resolve('../db'), {
    async dbRun(sql) {
      calls.push(String(sql));
      if (String(sql).includes("status = 'closed'")) return { rowCount: 6 };
      if (String(sql).includes("status = CASE")) return { rowCount: 4 };
      return { rowCount: 0 };
    },
  });

  const { runFeedbackDailyAudit } = require('../jobs/feedbackDailyAudit');
  const result = await runFeedbackDailyAudit();

  assert.deepEqual(result, { closedNoise: 6, assigned: 4 });
  assert.match(calls[0], /items imported from insurance estimate/);
  assert.match(calls[0], /daily-feedback-audit/);
  assert.match(calls[1], /routed_to = CASE/);
  assert.match(calls[1], /THEN 'Hermes'/);
  assert.match(calls[1], /ELSE 'Codex'/);
});
