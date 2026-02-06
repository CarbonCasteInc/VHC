'use strict';

const importPlugin = require('eslint-plugin-import');
const softMaxLinesRule = require('./rules/soft-max-lines');

const codeGlobs = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];
const ignoreForLineRules = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.stories.tsx',
  'packages/types/**/*.ts'
];
const frontendGlobs = [
  'apps/**/*.{ts,tsx,js,jsx}',
  'packages/ui/**/*.{ts,tsx,js,jsx}'
];

module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**']
  },
  {
    files: codeGlobs,
    ignores: ignoreForLineRules,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      import: importPlugin,
      'vh-soft': {
        rules: {
          'soft-max-lines': softMaxLinesRule
        }
      }
    },
    rules: {
      'max-lines': [
        'error',
        { max: 350, skipBlankLines: true, skipComments: true }
      ],
      'vh-soft/soft-max-lines': [
        'warn',
        { max: 250, skipBlankLines: true, skipComments: true }
      ]
    }
  },
  {
    files: frontendGlobs,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      'import/no-nodejs-modules': 'error'
    }
  },
  {
    files: ['apps/web-pwa/src/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'apps/web-pwa/src/**/*.test.ts',
      'apps/web-pwa/src/**/*.test.tsx',
      'apps/web-pwa/src/hooks/useGovernance.ts'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Use safeGetItem/safeSetItem/safeRemoveItem from src/utils/safeStorage instead of direct localStorage access.'
        }
      ]
    }
  },
  {
    files: codeGlobs,
    ignores: ['packages/gun-client/**/*'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'gun',
              message: 'Use @venn-hermes/gun-client. Direct gun imports are forbidden.'
            }
          ]
        }
      ]
    }
  }
];
