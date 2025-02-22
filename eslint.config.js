import babelParser from '@babel/eslint-parser';

export default [
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          configFile: './babel.config.json'
        }
      }
    },
    rules: {
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'no-unused-vars': 'warn'
    }
  }
];