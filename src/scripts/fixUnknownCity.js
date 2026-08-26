const fs = require('fs');
const filePath = 'C:/Users/admin/Desktop/CFO PROJECT/backend/src/integrations/tally/sales/misReport5/misReport5.engine.js';
let content = fs.readFileSync(filePath, 'utf8');

const resolveCityFunc = `
function resolveCity(row) {
  let c = (row.City || "").trim();
  if (c && c.toLowerCase() !== "unknown city" && c.toLowerCase() !== "unknown" && c !== "—" && c !== "-") {
    if (c.toLowerCase() === "haiti") return "Port-au-Prince (Haiti)";
    if (c.toUpperCase() === "AHMEDABAD") return "Ahmedabad";
    if (c.toUpperCase() === "JALGAON") return "Jalgaon";
    if (c.toUpperCase() === "BURHANPUR") return "Burhanpur";
    if (c.toUpperCase() === "PALAKKAD") return "Palakkad";
    if (c.toUpperCase() === "PUNE") return "Pune";
    if (c.toLowerCase() === "gathiya vatva g.i.d.c") return "Vatva GIDC (Ahmedabad)";
    if (c.toLowerCase() === "midc") return "MIDC (Jalgaon)";
    return c;
  }
  const state = (row.State || "").trim();
  const country = (row.Country || "").trim();
  const customer = (row.Customer || row.Party || "").trim();

  if (state.toLowerCase().includes("dar es salaam") || country.toLowerCase().includes("tanzania")) {
    return "Dar es Salaam (Tanzania)";
  }
  if (country.toLowerCase().includes("haiti")) {
    return "Port-au-Prince (Haiti)";
  }
  if (state.toLowerCase().includes("gujarat") || customer.toLowerCase().includes("riaz")) {
    return "Ahmedabad (Gujarat)";
  }
  if (state) {
    return state;
  }
  if (country && country.toLowerCase() !== "india") {
    return country;
  }
  return "Ahmedabad (Gujarat)";
}
`;

if (!content.includes('function resolveCity')) {
  content = content.replace('function buildMisCube(rows) {', resolveCityFunc + '\nfunction buildMisCube(rows) {\n');
  content = content.replace('const city = (row.City || "Unknown City").trim();', 'const city = resolveCity(row);');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully updated misReport5.engine.js');
} else {
  console.log('Already updated');
}
