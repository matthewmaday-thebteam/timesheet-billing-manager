/**
 * Typography - Font Styles Library
 *
 * This component documents and displays all typography styles used in the application.
 * Use this as a reference when implementing UI components.
 *
 * @category Design System
 * @created 2026-01-11
 */

import type { ReactNode } from 'react';

// =============================================================================
// TYPOGRAPHY TOKENS
// =============================================================================

export const fontFamilies = {
  sans: 'font-sans', // ui-sans-serif, system-ui, -apple-system, etc.
  mono: 'font-mono', // ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace
} as const;

export const fontSizes = {
  '2xs': { class: 'text-2xs', size: '10px', lineHeight: '14px' },
  'xs': { class: 'text-xs', size: '12px', lineHeight: '16px' },
  'sm': { class: 'text-sm', size: '14px', lineHeight: '20px' },
  'base': { class: 'text-base', size: '16px', lineHeight: '24px' },
  'lg': { class: 'text-lg', size: '18px', lineHeight: '28px' },
  'xl': { class: 'text-xl', size: '20px', lineHeight: '28px' },
  '2xl': { class: 'text-2xl', size: '24px', lineHeight: '32px' },
} as const;

export const fontWeights = {
  normal: { class: 'font-normal', weight: '400' },
  medium: { class: 'font-medium', weight: '500' },
  semibold: { class: 'font-semibold', weight: '600' },
  bold: { class: 'font-bold', weight: '700' },
} as const;

export const textColors = {
  primary: { class: 'text-vercel-gray-600', hex: '#000000', usage: 'Primary text, headings' },
  secondary: { class: 'text-vercel-gray-400', hex: '#666666', usage: 'Secondary text, labels' },
  tertiary: { class: 'text-vercel-gray-300', hex: '#888888', usage: 'Placeholder, hints' },
  muted: { class: 'text-vercel-gray-200', hex: '#999999', usage: 'Disabled text' },
  error: { class: 'text-error', hex: '#EE0000', usage: 'Error messages' },
  success: { class: 'text-success-text', hex: '#166534', usage: 'Success messages' },
  warning: { class: 'text-warning-text', hex: '#9A3412', usage: 'Warning messages' },
  info: { class: 'text-info-text', hex: '#3730A3', usage: 'Info messages' },
} as const;

// =============================================================================
// PREDEFINED TEXT STYLES
// =============================================================================

export const textStyles = {
  // Headings
  'heading-2xl': {
    classes: 'text-2xl font-bold text-vercel-gray-600',
    description: 'Page titles, hero headings',
    size: '24px',
    weight: '700',
    color: '#000000',
    usage: ['Hero headings (not currently used in app)'],
  },
  'heading-xl': {
    classes: 'text-xl font-semibold text-vercel-gray-600',
    description: 'Section titles',
    size: '20px',
    weight: '600',
    color: '#000000',
    usage: ['EmployeesPage', 'HolidaysPage', 'RatesPage', 'UsersPage', 'StyleReviewPage'],
  },
  'heading-lg': {
    classes: 'text-lg font-semibold text-vercel-gray-600',
    description: 'Card titles, sub-sections',
    size: '18px',
    weight: '600',
    color: '#000000',
    usage: ['ProjectCard', 'BillingRatesTable', 'DashboardChartsRow', 'Modal title', 'Dashboard sections', 'UnderHoursModal stats', 'EOMReportsPage'],
  },

  // Body text
  'body-base': {
    classes: 'text-base text-vercel-gray-600',
    description: 'Default body text',
    size: '16px',
    weight: '400',
    color: '#000000',
    usage: ['Button lg size', 'Input lg size'],
  },
  'body-sm': {
    classes: 'text-sm text-vercel-gray-600',
    description: 'Standard body text (most common)',
    size: '14px',
    weight: '400',
    color: '#000000',
    usage: ['ResourceTable cells', 'HolidayTable cells', 'UserTable cells', 'RatesPage table', 'Page descriptions', 'Form inputs', 'Dropdown menus'],
  },
  'body-xs': {
    classes: 'text-xs text-vercel-gray-400',
    description: 'Small text, captions',
    size: '12px',
    weight: '400',
    color: '#666666',
    usage: ['Page subtitles', 'Helper text', 'Empty state messages', 'Badge text', 'Calendar day numbers'],
  },

  // Labels
  'label-uppercase': {
    classes: 'text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider',
    description: 'Table headers, section labels',
    size: '10px',
    weight: '700',
    color: '#888888',
    usage: ['(Reserved for future use)'],
  },
  'label-form': {
    classes: 'text-xs font-medium text-vercel-gray-400 uppercase tracking-wider',
    description: 'Form field labels',
    size: '12px',
    weight: '500',
    color: '#666666',
    usage: ['EmployeeEditorModal', 'UserEditorModal', 'ProjectEditorModal', 'HolidayEditorModal', 'LoginPage', 'ForgotPasswordPage', 'ResetPasswordPage', 'ResourceTable headers', 'UserTable headers', 'HolidayTable headers', 'RatesPage headers', 'AccordionFlat headers', 'HolidayCalendar weekdays', 'UnderHoursModal headers'],
  },

  // Monospace
  'mono-sm': {
    classes: 'text-sm font-mono text-vercel-gray-400',
    description: 'System IDs, code snippets',
    size: '14px',
    weight: '400',
    color: '#666666',
    fontFamily: 'monospace',
    usage: ['ResourceTable (external_label, email, teams_account, monthly_cost)', 'RatesPage (project_id)'],
  },
  'mono-xs': {
    classes: 'text-xs font-mono text-vercel-gray-400',
    description: 'Small code, tokens',
    size: '12px',
    weight: '400',
    color: '#666666',
    fontFamily: 'monospace',
    usage: ['MetricCard labels', 'ProjectCard counts/totals', 'BillingRatesTable labels', 'AccordionNested task details', 'TaskList details'],
  },
  'mono-2xs': {
    classes: 'text-2xs font-mono text-vercel-gray-200',
    description: 'Fine print code',
    size: '10px',
    weight: '400',
    color: '#999999',
    fontFamily: 'monospace',
    usage: ['Typography font-family examples'],
  },

  // Interactive
  'button-sm': {
    classes: 'text-xs font-medium',
    description: 'Small button text',
    size: '12px',
    weight: '500',
    usage: ['Button component (size="sm")'],
  },
  'button-md': {
    classes: 'text-sm font-medium',
    description: 'Medium button text (default)',
    size: '14px',
    weight: '500',
    usage: ['Button component', 'NavItem', 'Modal footer buttons', 'Auth buttons', 'DateRangeFilter', 'DatePicker', 'Input labels', 'ResourceRow', 'AccordionNested'],
  },
  'button-lg': {
    classes: 'text-base font-medium',
    description: 'Large button text',
    size: '16px',
    weight: '500',
    usage: ['Button component (size="lg")'],
  },

  // Links
  'link-default': {
    classes: 'text-sm text-vercel-gray-400 hover:text-vercel-gray-600',
    description: 'Navigation links',
    size: '14px',
    weight: '400',
    color: '#666666',
    usage: ['Forgot password link', 'Back to login link'],
  },

  // Metrics
  'metric-value': {
    classes: 'text-2xl font-semibold text-vercel-gray-600',
    description: 'Dashboard metric values',
    size: '24px',
    weight: '600',
    color: '#000000',
    usage: ['MetricCard values', 'LoginPage title', 'ForgotPasswordPage title', 'ResetPasswordPage title'],
  },
  'metric-label': {
    classes: 'text-xs text-vercel-gray-400',
    description: 'Dashboard metric labels',
    size: '12px',
    weight: '400',
    color: '#666666',
    usage: ['MetricCard labels (via mono-xs)', 'body-xs contexts'],
  },
} as const;

// =============================================================================
// TYPOGRAPHY PREVIEW COMPONENT
// =============================================================================

interface TypographyPreviewProps {
  showAll?: boolean;
}

export function TypographyPreview({ showAll = false }: TypographyPreviewProps) {
  const sampleText = 'The quick brown fox jumps over the lazy dog';

  return (
    <div className="space-y-8">
      {/* Font Families */}
      <section>
        <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">Font Families</h3>
        <div className="space-y-4">
          <div className="p-4 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">Sans (Default)</span>
              <code className="text-xs font-mono text-vercel-gray-400">font-sans</code>
            </div>
            <p className="font-sans text-vercel-gray-600">{sampleText}</p>
            <p className="mt-2 text-2xs text-vercel-gray-300 font-mono">
              ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif
            </p>
          </div>
          <div className="p-4 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">Monospace</span>
              <code className="text-xs font-mono text-vercel-gray-400">font-mono</code>
            </div>
            <p className="font-mono text-vercel-gray-600">{sampleText}</p>
            <p className="mt-2 text-2xs text-vercel-gray-300 font-mono">
              ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace
            </p>
          </div>
        </div>
      </section>

      {/* Font Sizes */}
      <section>
        <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">Font Sizes</h3>
        <div className="space-y-3">
          {Object.entries(fontSizes).map(([name, { class: className, size, lineHeight }]) => (
            <div key={name} className="flex items-center gap-4 p-3 border border-vercel-gray-100 rounded-lg">
              <div className="w-20 text-xs text-vercel-gray-400">
                <p className="font-medium">{name}</p>
                <p className="font-mono text-2xs">{size} / {lineHeight}</p>
              </div>
              <p className={`${className} text-vercel-gray-600 flex-1`}>{sampleText}</p>
              <code className="text-2xs font-mono text-vercel-gray-300">{className}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Font Weights */}
      <section>
        <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">Font Weights</h3>
        <div className="space-y-3">
          {Object.entries(fontWeights).map(([name, { class: className, weight }]) => (
            <div key={name} className="flex items-center gap-4 p-3 border border-vercel-gray-100 rounded-lg">
              <div className="w-20 text-xs text-vercel-gray-400">
                <p className="font-medium capitalize">{name}</p>
                <p className="font-mono text-2xs">{weight}</p>
              </div>
              <p className={`${className} text-sm text-vercel-gray-600 flex-1`}>{sampleText}</p>
              <code className="text-2xs font-mono text-vercel-gray-300">{className}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Text Styles */}
      {showAll && (
        <section>
          <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">Predefined Text Styles</h3>
          <div className="space-y-3">
            {Object.entries(textStyles).map(([name, style]) => (
              <div key={name} className="p-4 border border-vercel-gray-100 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-vercel-gray-400">{name}</span>
                  <span className="text-2xs text-vercel-gray-300">{style.description}</span>
                </div>
                <p className={style.classes}>{sampleText}</p>
                <code className="mt-2 block text-2xs font-mono text-vercel-gray-300">{style.classes}</code>
                {'usage' in style && (
                  <div className="mt-3 pt-3 border-t border-vercel-gray-100">
                    <p className="text-2xs font-medium text-vercel-gray-400 mb-1">Used in:</p>
                    <p className="text-2xs text-vercel-gray-300">
                      {(style as { usage: readonly string[] }).usage.join(' • ')}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// =============================================================================
// UTILITY COMPONENT FOR CONSISTENT TEXT
// =============================================================================

interface TextProps {
  variant?: keyof typeof textStyles;
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'label';
  className?: string;
  children: ReactNode;
}

export function Text({ variant = 'body-sm', as: Component = 'span', className = '', children }: TextProps) {
  const style = textStyles[variant];
  return <Component className={`${style.classes} ${className}`}>{children}</Component>;
}

export default TypographyPreview;
