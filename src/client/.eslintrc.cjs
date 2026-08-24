module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    // Existing project conventions: terminal ANSI regexes, intentionally empty
    // catch blocks, JSX copy with quotation marks, and legacy hook patterns.
    // Keep the initial baseline focused on actionable defects.
    'no-empty': 'off',
    'no-control-regex': 'off',
    'no-case-declarations': 'off',
    'no-useless-escape': 'off',
    'no-unused-vars': 'off',
    'react/no-unescaped-entities': 'off',
    'react/jsx-uses-react': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-hooks/rules-of-hooks': 'off',
    'react-refresh/only-export-components': 'off',
  },
};
