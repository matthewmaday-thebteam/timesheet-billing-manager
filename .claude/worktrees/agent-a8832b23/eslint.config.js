import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * ESLint Configuration with Design Token Enforcement
 *
 * Task 017: Lint Rules & CI Enforcement for Style Consistency
 *
 * Since eslint-plugin-tailwindcss doesn't support Tailwind v4 yet,
 * we use regex-based rules to prevent arbitrary hex colors.
 *
 * Approved Exceptions (documented in STYLEGUIDE.md):
 * - bottom-[9px], h-[2px]: NavItem indicator
 * - max-h-[90vh]: Modal height constraint
 * - max-h-[500px]: UnderHoursModal height
 * - max-w-[200px], min-w-[120px]: Text truncation/layout
 * - z-[1000]: Modal z-index
 * - border-[3px]: Spinner border
 * - text-[10px], text-[11px]: Fine print (should use text-2xs token)
 */

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      /**
       * Design Token Enforcement Rules
       *
       * These rules prevent hardcoded hex colors in Tailwind classes.
       * Use design tokens from @theme instead (e.g., bg-vercel-gray-50).
       *
       * To add an exception, use eslint-disable comment with justification:
       * // eslint-disable-next-line no-restricted-syntax -- [reason]
       */
      'no-restricted-syntax': [
        'error',
        {
          // Detect bg-[#...] arbitrary background colors
          selector: 'Literal[value=/bg-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary background colors (e.g., bg-vercel-gray-50 instead of bg-[#FAFAFA])',
        },
        {
          // Detect text-[#...] arbitrary text colors
          selector: 'Literal[value=/text-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary text colors (e.g., text-vercel-gray-400 instead of text-[#666666])',
        },
        {
          // Detect border-[#...] arbitrary border colors
          selector: 'Literal[value=/border-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary border colors (e.g., border-vercel-gray-100 instead of border-[#EAEAEA])',
        },
        {
          // Detect hover:bg-[#...] arbitrary hover colors
          selector: 'Literal[value=/hover:bg-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary hover colors (e.g., hover:bg-vercel-gray-50)',
        },
        {
          // Detect focus:border-[#...] arbitrary focus colors
          selector: 'Literal[value=/focus:border-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary focus colors (e.g., focus:border-vercel-gray-600)',
        },
        {
          // Detect placeholder-[#...] arbitrary placeholder colors
          selector: 'Literal[value=/placeholder-\\[#[0-9A-Fa-f]{3,8}\\]/]',
          message: 'Use design tokens instead of arbitrary placeholder colors (e.g., placeholder-vercel-gray-300)',
        },
      ],
    },
  },
  // Exception: StyleReviewPage is a dev-only design system showcase
  // It uses arbitrary values intentionally to demonstrate the token system
  {
    files: ['**/design-system/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
