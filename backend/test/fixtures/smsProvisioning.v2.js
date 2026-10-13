'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const corpus = require('./smsProvisioning.v2.json');

// Complete offline validator for the dialect actually used by these six pinned
// draft-07 data schemas. Reject unknown schema keywords rather than silently
// ignoring constraints if a future schema is substituted. No network or packages.
function validateData(schema, data) {
  const keywords = ['$id', '$schema', 'additionalProperties', 'description', 'properties', 'required', 'title', 'type'];
  assert.ok(Object.keys(schema).every(k => keywords.includes(k)), 'unsupported schema keyword');
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties));
  for (const definition of Object.values(schema.properties)) {
    assert.ok(Object.keys(definition).every(k => ['type', 'description'].includes(k)), 'unsupported field keyword');
    assert.ok(['string', 'integer'].includes(definition.type), 'unsupported field type');
  }
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'data must be object');
  for (const key of schema.required) {
    assert.equal(typeof key, 'string');
    assert.ok(Object.hasOwn(data, key), `required: ${key}`);
  }
  for (const [key, value] of Object.entries(data)) {
    assert.ok(Object.hasOwn(schema.properties, key), `additional property: ${key}`);
    const type = schema.properties[key].type;
    assert.ok(type === 'integer' ? Number.isInteger(value) : typeof value === 'string', `type: ${key}`);
  }
}

function validateFixture(event) {
  const entry = corpus.events.find(e => event.type === e.fixture.type);
  assert.ok(entry, 'unknown event type');
  assert.equal(event.dataschema, entry.sourceUrl);
  validateData(entry.schema, event.data);
  return event;
}

assert.equal(corpus.events.length, 6);
assert.equal(new Set(corpus.events.map(e => e.kind)).size, 6);
for (const entry of corpus.events) {
  assert.equal(entry.sourceUrl, entry.schema.$id);
  assert.equal(createHash('sha256').update(JSON.stringify(entry.schema)).digest('hex'), entry.schemaSha256);
  validateFixture(entry.fixture);
}

function fixture(kind, time, id, mapping, phoneSid) {
  const entry = corpus.events.find(e => e.kind === kind);
  assert.ok(entry, 'unknown fixture kind');
  const event = structuredClone(entry.fixture);
  event.id = id; event.time = new Date(time).toISOString();
  Object.assign(event.data, { accountsid: mapping.account_sid, messagingservicesid: mapping.service_sid,
    phonenumbersid: phoneSid, timestamp: time, updateddate: time });
  if (Object.hasOwn(event.data, 'campaignsid')) event.data.campaignsid = mapping.event_campaign_sid;
  // Every normal fixture used by signed HTTP and real PG is validated after
  // parameter substitution. Deliberately invalid test mutations happen afterward.
  return validateFixture(event);
}

module.exports = { corpus, validateData, validateFixture, fixture };
