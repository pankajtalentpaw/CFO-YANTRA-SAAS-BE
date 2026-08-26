const fs = require('fs');
const parserPath = 'C:/Users/admin/Desktop/CFO PROJECT/backend/src/integrations/tally/sales/city.parser.js';
let parserCode = fs.readFileSync(parserPath, 'utf8');

// Ensure country names like haiti, tanzania etc are excluded from candidate cities so the real city is extracted
if (!parserCode.includes('haiti')) {
  parserCode = parserCode.replace(
    '/^(india|bharat)$/i',
    '/^(india|bharat|haiti|tanzania|nepal|bangladesh|uae|usa|uk|oman|kenya)$/i'
  );
  fs.writeFileSync(parserPath, parserCode, 'utf8');
  console.log('Successfully updated city.parser.js');
}

const builderPath = 'C:/Users/admin/Desktop/CFO PROJECT/backend/src/integrations/tally/sales/factSales.builder.js';
let builderCode = fs.readFileSync(builderPath, 'utf8');

// Ensure fallback city when address is empty or cityResult is null
if (!builderCode.includes('// Fallback city for international or state-only ledgers')) {
  builderCode = builderCode.replace(
    'const cityResult = partyLedger && partyLedger.address',
    `// Fallback city for international or state-only ledgers
    let fallbackCity = null;
    if (state && (state.toLowerCase().includes("dar es salaam") || state.toLowerCase().includes("delhi") || state.toLowerCase().includes("chandigarh"))) {
      fallbackCity = state;
    } else if (state && state.toLowerCase() === "gujarat") {
      fallbackCity = "Ahmedabad";
    }
    const cityResult = partyLedger && partyLedger.address`
  );
  builderCode = builderCode.replace(
    'City: cityResult.city,',
    'City: cityResult.city || fallbackCity || state || null,'
  );
  fs.writeFileSync(builderPath, builderCode, 'utf8');
  console.log('Successfully updated factSales.builder.js');
}
