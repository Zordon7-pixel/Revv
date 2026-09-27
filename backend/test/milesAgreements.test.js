const test = require('node:test');
const assert = require('node:assert/strict');
const { MILES_SHOP_ID, profiles, prepareDetails, canUseProfile } = require('../src/services/milesAgreements');
const template = { shop_id: MILES_SHOP_ID, preparation_kind: 'miles_insurance_v1', document_sha256: profiles.miles_insurance_v1.hash };
const vehicle = { vehicle_year: 2024, vehicle_make: 'Toyota', vehicle_model: 'Camry', vin: '1HGBH41JXMN109186', claim_number: 'QA-CLAIM' };
const fields = { estimate: 'QA estimate v1', amount: '2500.50', deductible: '500', loss_date: '2026-09-20', reviewed: true };
test('only the verified Miles tenant can use a known original', () => {
  assert.ok(canUseProfile(template, MILES_SHOP_ID));
  assert.ok(!canUseProfile({ ...template, shop_id:'other' }, 'other'));
  assert.ok(!canUseProfile({ ...template, document_sha256:'wrong' }, MILES_SHOP_ID));
  assert.throws(() => prepareDetails(template,'other',vehicle,'Customer',fields), {status:403});
});
test('material blanks, unchecked review, invalid dates and money are rejected', () => {
  const prepare=(input,ro=vehicle)=>prepareDetails(template,MILES_SHOP_ID,ro,'José Rivera',input);
  assert.equal(prepare(fields).deductible,'500.00');
  for(const delta of [{amount:''},{amount:'-1'},{amount:'2.333'},{reviewed:false},{estimate:''},{loss_date:'2026-13-01'},{loss_date:'2026-02-30'},{stage:'anything'}]) {
    assert.throws(()=>prepare({...fields,...delta}),{status:400});
  }
  assert.throws(()=>prepare(fields,{...vehicle,vin:''}),{status:400});
  assert.throws(()=>prepare(fields,{...vehicle,claim_number:''}),{status:400});
});
test('completion and denied-claim removal require deliberate matching stages', () => {
  assert.throws(()=>prepareDetails(template,MILES_SHOP_ID,vehicle,'Customer',{stage:'completion',reviewed:true,invoice:'QA'}),{status:400});
  const removal={...template,preparation_kind:'miles_removal_v1',document_sha256:profiles.miles_removal_v1.hash};
  assert.throws(()=>prepareDetails(removal,MILES_SHOP_ID,vehicle,'Customer',{stage:'intake',reviewed:true}),{status:400});
  assert.throws(()=>prepareDetails(removal,MILES_SHOP_ID,vehicle,'Customer',{reviewed:true,condition:'Tow away'}),{status:400});
  assert.equal(prepareDetails(removal,MILES_SHOP_ID,vehicle,'Customer',{reviewed:true,condition:'Tow away',insurance_denied:true}).stage,'removal');
});
