const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getOpenAI, aiModel, completionText, analyzeDamage } = require('../src/services/openai');
const { extractLabel } = require('../src/services/partCapture');

test('OpenAI is the sole AI provider and model settings are workload-specific', () => {
  assert.equal(getOpenAI({ ANTHROPIC_API_KEY: 'unused' }), null);
  assert.equal(aiModel('vision', {}), 'gpt-4.1-mini');
  assert.equal(aiModel('estimate', {}), 'gpt-4o');
  assert.equal(aiModel('vision', { OPENAI_VISION_MODEL: 'test-vision' }), 'test-vision');
  const client = getOpenAI({ OPENAI_API_KEY: 'synthetic-test-only' });
  assert.equal(client.baseURL, 'https://api.openai.com/v1');assert.equal(client.timeout,45000);assert.equal(client.maxRetries,1);
  for (const file of ['routes/insuranceOcr.js','routes/photos.js','routes/estimateAssistant.js','services/partCapture.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'), /ANTHROPIC|Anthropic|claude-/);
  }
});
test('truncation/refusal cannot be treated as a completed extraction', async () => {
  assert.throws(()=>completionText({choices:[{finish_reason:'length',message:{content:'{}'}}]}),{status:422});
  assert.throws(()=>completionText({choices:[{message:{refusal:'cannot process'}}]}),{status:422});
  await assert.rejects(extractLabel(Buffer.from([255,216,255]),{client:{chat:{completions:{create:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})}}}}),{status:422});
});
test('damage assessment sends OpenAI image JSON request and validates output', async () => {
  let payload;
  const client={chat:{completions:{create:async(body)=>{payload=body;return{choices:[{finish_reason:'stop',message:{content:JSON.stringify({severity:'moderate',zones:['front bumper',42],description:'Visible front bumper damage.'})}}]};}}}};
  const result=await analyzeDamage(Buffer.from('test-image'),'image/png',{client,env:{OPENAI_VISION_MODEL:'test-vision'}});
  assert.deepEqual(result.zones,['front bumper']);assert.equal(result.severity,'moderate');assert.equal(payload.model,'test-vision');assert.equal(payload.store,false);
  assert.match(payload.messages[1].content[0].image_url.url,/^data:image\/png;base64,/);assert.equal(payload.response_format.type,'json_object');
  assert.equal(await analyzeDamage(Buffer.from('x'),'image/png',{env:{}}),null);
  client.chat.completions.create=async()=>({choices:[{message:{content:'{"severity":"made-up","zones":[],"description":"x"}'}}]});
  await assert.rejects(analyzeDamage(Buffer.from('x'),'image/png',{client}),/unusable/);
});
test('OpenAI provider failures propagate without a second AI provider', async () => {
  let calls=0;
  const client={chat:{completions:{create:async()=>{calls++;throw Object.assign(new Error('test auth failure'),{status:401});}}}};
  await assert.rejects(extractLabel(Buffer.from([255,216,255]),{client}),{status:401});
  assert.equal(calls,1);
});
