const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutofill, checkRevision } = require('../src/services/agreementAutofill');
const ro = { ro_number:'RO-123', total:'4250.50', deductible:'0.00', claim_number:'CLAIM-A', updated_at:'2026-09-27T12:30:00Z' };
const customer = { name:'Avery Sample',email:'avery@example.test',phone:'7185550100' };
const vehicle = { year:2024,make:'Toyota',model:'Camry',vin:'TESTVIN' };
test('prefills saved dollar totals and preserves a zero deductible without inventing approvals',()=>{
 const result=buildAutofill(ro,customer,vehicle);
 assert.equal(result.defaults.amount,'4250.50');assert.equal(result.defaults.deductible,'0.00');
 assert.equal(result.defaults.estimate,'RO-123 / estimate 2026-09-27 12:30:00 UTC');
 assert.equal(result.identity.vehicle,'2024 Toyota Camry');
 assert.equal(result.defaults.loss_date,'');assert.ok(!('reviewed' in result.defaults));
});
test('unreviewed OCR, empty totals and inconsistent legacy fields do not authorize guessed money',()=>{
 assert.equal(buildAutofill(ro,customer,vehicle,{import_draft:{needs_review:true}}).defaults.amount,'');
 for(const total of [0,null,'','bad',-50,'10.005',1e9]) {
  const result=buildAutofill({...ro,total,estimate_amount:500000,insurance_approved_amount:500000},customer,vehicle);
  assert.equal(result.defaults.amount,''); assert.equal(result.defaults.estimate,'');
 }
 assert.equal(buildAutofill({...ro,deductible:null},customer,vehicle).defaults.deductible,'');
});
test('date of loss reuse requires matching customer VIN and claim and rejects impossible dates',()=>{
 const previous={name:customer.name,vin:vehicle.vin,claim:ro.claim_number,loss_date:'2026-09-20'};
 assert.equal(buildAutofill(ro,customer,vehicle,{},previous).defaults.loss_date,'2026-09-20');
 for(const delta of [{name:'Someone else'},{vin:'OTHER'},{claim:'OTHER'},{loss_date:'2026-02-30'}]) assert.equal(buildAutofill(ro,customer,vehicle,{}, {...previous,...delta}).defaults.loss_date,'');
 assert.equal(buildAutofill({...ro,date_of_loss:'2026-09-21'},customer,vehicle,{},previous).defaults.loss_date,'2026-09-21');
});
test('revision changes with customer vehicle or money; stale review is rejected',()=>{
 const baseline=buildAutofill(ro,customer,vehicle);
 checkRevision(baseline.revision,baseline);
 for(const result of [buildAutofill({...ro,total:5000},customer,vehicle),buildAutofill(ro,{...customer,name:'Different'},vehicle),buildAutofill(ro,customer,{...vehicle,vin:'CHANGED'})]){
  assert.notEqual(result.revision,baseline.revision);assert.throws(()=>checkRevision(baseline.revision,result),{status:409});
 }
 assert.equal(buildAutofill(ro,customer,vehicle).revision,baseline.revision);
});
