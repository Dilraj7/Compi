import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'resources/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', '*.config.{ts,js,mjs}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    // Site GitHub Pages : script de page, sans module.
    files: ['site/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' }
  },
  {
    // Film promo : scripts de page (navigateur) et de rendu (Electron, CommonJS).
    files: ['marketing/**/*.{js,cjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node }, sourceType: 'script' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }]
    }
  }
)
