require('dotenv').config();

// Test models that actually produce content (not reasoning-only)
const CANDIDATES = [
  'nvidia/nemotron-3.5-lightning:free',
  'thinkingmachines/inkling-small:free',
  'thinkingmachines/inkling:free',
  'poolside/laguna-s-2.1:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'dots-studio/dots-3-note-preview:free',
];

async function testModel(modelId) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dentalsmart.app',
        'X-Title': 'dentalsmart',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say exactly: hello world' }],
        max_tokens: 50,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    const errMsg = data?.error?.message || data?.message;
    if (content) {
      console.log(`✅ ${modelId} → "${content}"`);
    } else {
      console.log(`❌ ${modelId} → ${errMsg || 'empty (reasoning-only?)'}`);
    }
  } catch (e) {
    console.log(`❌ ${modelId} → ${e.message}`);
  }
}

async function main() {
  console.log('Finding working free models...\n');
  for (const m of CANDIDATES) await testModel(m);
  console.log('\nDone.');
}
main();
