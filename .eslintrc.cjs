// Root ESLint config (flat-ish eslintrc) shared by web/client, web/server and
// web/shared. The codebase predates linting, so the noisy rules are relaxed:
// the guardrail targets real mistakes (undefined vars, unreachable code,
// suspicious patterns), not style. Tighten rules as the code improves.
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'vue'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-essential',
  ],
  rules: {
    // TypeScript covers these; eslint's version false-positives on types.
    'no-undef': 'off',
    // The codebase uses `any` and unused vars liberally — leaving these on
    // would fail on thousands of pre-existing lines. Off for now.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    // Suppression comments predate this config.
    '@typescript-eslint/ban-ts-comment': 'off',
    // Vue component names are single-word in places (ZoneHeader, TopToolbar…).
    'vue/multi-word-component-names': 'off',
    'vue/no-v-html': 'off',
  },
};
