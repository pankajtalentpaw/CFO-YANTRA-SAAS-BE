const commonValidations = require("./common.validation");
const companyValidations = require("./company.validation");
const factSalesValidations = require("./factSales.validation");
const aiValidations = require("./ai.validation");
const envValidations = require("./env.validation");
const authValidations = require("./auth.validation");
const middleware = require("./validate.middleware");

module.exports = {
  ...commonValidations,
  ...companyValidations,
  ...factSalesValidations,
  ...aiValidations,
  ...envValidations,
  ...authValidations,
  ...middleware
};
