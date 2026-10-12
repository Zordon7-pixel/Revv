#!/usr/bin/env node
'use strict';

// Configuration proof only: NOT delivery, provenance, authorization or consent proof.
// Deliberately no dotenv, app startup, provider, database or network imports.
const { inspectSmsTestRecipient } = require('../src/services/smsTestRecipient');
const inspection = inspectSmsTestRecipient(process.env);
console.log(JSON.stringify(inspection));
process.exitCode = inspection.valid ? 0 : 1;
