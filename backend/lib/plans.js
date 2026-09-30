const PLAN_CREDITS = {
  starter:    1000,
  growth:     2500,
  premium:    10000,
  enterprise: 999999  // effectively unlimited
};

const PLAN_PRICES_PAISE = {
  starter:    59900,   // ₹599
  growth:     99900,   // ₹999
  premium:    149900,  // ₹1499
  enterprise: 0        // custom
};

// Token-based Billing configuration
const TOKENS_PER_CREDIT = parseInt(process.env.TOKENS_PER_CREDIT || '500', 10);

let envModelFactors = {};
try {
  if (process.env.MODEL_FACTORS) {
    envModelFactors = JSON.parse(process.env.MODEL_FACTORS);
  }
} catch (err) {
  console.error('[Config Error] Failed to parse MODEL_FACTORS from env. Ensure it is valid JSON. Falling back to defaults.');
}

const MODEL_FACTORS = {
  'nvidia/nemotron-3-super-120b-a12b:free': 2,
  'openrouter/free': 1,
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 1,
  'minimax/minimax-m3:free': 1,
  // Extendable via JSON string in env
  ...envModelFactors
};

const PLAN_FEATURES = {
  starter:   { marketplace: false, ai_modes: ['data', 'thinking', 'automation'] },
  growth:    { marketplace: true,  ai_modes: ['data', 'thinking', 'automation'] },
  premium:   { marketplace: true,  ai_modes: ['data', 'thinking', 'automation'] },
  enterprise:{ marketplace: true,  ai_modes: ['data', 'thinking', 'automation'] },
};

const TOPUP_PACKS = [
  { id: 'starter_pack', name: 'Starter Pack', credits: 500,  price_paise: 9900,  price_display: '₹99'  },
  { id: 'value_pack',   name: 'Value Pack',   credits: 2000, price_paise: 29900, price_display: '₹299' },
  { id: 'power_pack',   name: 'Power Pack',   credits: 5000, price_paise: 59900, price_display: '₹599' },
];

module.exports = { PLAN_CREDITS, PLAN_PRICES_PAISE, TOKENS_PER_CREDIT, MODEL_FACTORS, PLAN_FEATURES, TOPUP_PACKS };
