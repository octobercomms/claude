/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@remix-run/eslint-config", "prettier"],
  globals: {
    shopify: "readonly",
  },
};
