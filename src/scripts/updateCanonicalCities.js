const fs = require('fs');
const filePath = 'C:/Users/admin/Desktop/CFO PROJECT/backend/src/integrations/tally/sales/misReport5/misReport5.engine.js';
let content = fs.readFileSync(filePath, 'utf8');

const canonicalCityCode = `
const CANONICAL_CITIES = {
  'ahmedabad': 'Ahmedabad',
  'ahmedabad (gujarat)': 'Ahmedabad',
  'ahmadabad': 'Ahmedabad',
  'vatva': 'Ahmedabad',
  'gathiya vatva': 'Ahmedabad',
  'gathiya vatva g.i.d.c': 'Ahmedabad',
  'naroda': 'Ahmedabad',
  'sanand': 'Ahmedabad',
  'changodar': 'Ahmedabad',
  'jalgaon': 'Jalgaon',
  'midc': 'Jalgaon',
  'midc jalgaon': 'Jalgaon',
  'burhanpur': 'Burhanpur',
  'palakkad': 'Palakkad',
  'palghat': 'Palakkad',
  'vadodara': 'Vadodara',
  'baroda': 'Vadodara',
  'tumakuru': 'Tumakuru',
  'tumkur': 'Tumakuru',
  'pune': 'Pune',
  'poona': 'Pune',
  'dar es salaam': 'Dar es Salaam',
  'daressalaam': 'Dar es Salaam',
  'tanzania': 'Dar es Salaam',
  'port au prince': 'Port-au-Prince',
  'port-au-prince': 'Port-au-Prince',
  'portauprince': 'Port-au-Prince',
  'haiti': 'Port-au-Prince',
  'mumbai': 'Mumbai',
  'bombay': 'Mumbai',
  'navi mumbai': 'Mumbai',
  'thane': 'Mumbai',
  'bengaluru': 'Bengaluru',
  'bangalore': 'Bengaluru',
  'chennai': 'Chennai',
  'madras': 'Chennai',
  'kolkata': 'Kolkata',
  'calcutta': 'Kolkata',
  'hyderabad': 'Hyderabad',
  'delhi': 'Delhi',
  'new delhi': 'Delhi',
  'surat': 'Surat',
  'rajkot': 'Rajkot',
  'indore': 'Indore',
  'bhopal': 'Bhopal',
  'jaipur': 'Jaipur',
  'coimbatore': 'Coimbatore',
  'kochi': 'Kochi',
  'cochin': 'Kochi',
  'ernakulam': 'Kochi'
};

function resolveCity(row) {
  let str = (row.City || "").trim();
  const state = (row.State || "").trim();
  const country = (row.Country || "").trim();
  const customer = (row.Customer || row.Party || "").trim();

  if (!str || str.toLowerCase() === "unknown city" || str.toLowerCase() === "unknown" || str === "—" || str === "-") {
    if (state && state.toLowerCase().includes("dar es salaam")) return "Dar es Salaam";
    if (country && country.toLowerCase().includes("tanzania")) return "Dar es Salaam";
    if (country && country.toLowerCase().includes("haiti")) return "Port-au-Prince";
    if (state && state.toLowerCase() === "gujarat") return "Ahmedabad";
    if (customer && customer.toLowerCase().includes("riaz")) return "Ahmedabad";
    if (state) str = state;
    else if (country) str = country;
    else return "Ahmedabad";
  }

  // Strip parenthesized qualifiers like (Gujarat), (Maharashtra), (India)
  const clean = str.replace(/\\s*\\([^)]*\\)/g, "").trim().toLowerCase();
  if (CANONICAL_CITIES[clean]) return CANONICAL_CITIES[clean];
  if (CANONICAL_CITIES[str.toLowerCase()]) return CANONICAL_CITIES[str.toLowerCase()];

  // Title case fallback
  return clean.split(/[\\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
`;

// Replace previous resolveCity
const regex = /function resolveCity\(row\) \{[\s\S]*?\n\}/;
if (regex.test(content)) {
  content = content.replace(regex, canonicalCityCode.trim());
} else {
  content = content.replace('function buildMisCube(rows) {', canonicalCityCode + '\nfunction buildMisCube(rows) {\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated misReport5.engine.js with canonical normalization');
