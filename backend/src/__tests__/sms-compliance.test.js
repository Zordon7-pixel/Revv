const test = require('node:test');
const assert = require('node:assert/strict');

const { messageWithComplianceFooter } = require('../services/sms');

test('SMS compliance footer is appended to customer-facing messages', () => {
  const body = messageWithComplianceFooter('Your vehicle is ready for pickup.');

  assert.equal(
    body,
    'Your vehicle is ready for pickup.\n\nReply STOP to opt out, HELP for help.'
  );
});

test('SMS compliance footer is not duplicated when opt-out language exists', () => {
  const body = 'Your vehicle is ready. Reply STOP to opt out, HELP for help.';

  assert.equal(messageWithComplianceFooter(body), body);
});

test('SMS compliance footer is still appended when stop is not opt-out language', () => {
  const body = messageWithComplianceFooter('Your vehicle is ready. Stop by when convenient.');

  assert.equal(
    body,
    'Your vehicle is ready. Stop by when convenient.\n\nReply STOP to opt out, HELP for help.'
  );
});

test('SMS compliance footer can be skipped for internal messages', () => {
  const body = 'Late Clock-In Alert: Employee clocked in late.';

  assert.equal(messageWithComplianceFooter(body, { customerFacing: false }), body);
});
