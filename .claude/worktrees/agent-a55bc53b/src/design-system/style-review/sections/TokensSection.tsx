/**
 * TokensSection - Design Tokens Reference
 *
 * Displays color palette, typography scale, and spacing scale.
 * Extracted verbatim from StyleReviewPage.tsx.
 */

export function TokensSection() {
  const colors = {
    'Core Neutrals': [
      { name: 'Black', value: '#000000', token: '--color-black' },
      { name: 'White', value: '#FFFFFF', token: '--color-white' },
      { name: 'Gray 50 (Vercel)', value: '#FAFAFA', token: '--color-vercel-gray-50' },
      { name: 'Gray 100 (Vercel)', value: '#EAEAEA', token: '--color-vercel-gray-100' },
      { name: 'Gray 200 (Vercel)', value: '#999999', token: '--color-vercel-gray-200' },
      { name: 'Gray 400', value: '#666666', token: '--color-gray-400' },
      { name: 'Gray 500', value: '#333333', token: '--color-gray-500' },
    ],
    'Semantic - Error': [
      { name: 'Error', value: '#EE0000', token: '--color-error' },
      { name: 'Error Hover', value: '#CC0000', token: '--color-error-hover' },
      { name: 'Error Light', value: '#FEF2F2', token: '--color-error-light' },
    ],
    'Semantic - Success': [
      { name: 'Success', value: '#50E3C2', token: '--color-success' },
      { name: 'Success Medium', value: '#C5F0E2', token: '--color-success-medium' },
      { name: 'Success Light', value: '#F0FDF4', token: '--color-success-light' },
    ],
    'Semantic - Warning': [
      { name: 'Warning', value: '#F5A623', token: '--color-warning' },
      { name: 'Warning Medium', value: '#F1D4A3', token: '--color-warning-medium' },
      { name: 'Warning Light', value: '#FFF7ED', token: '--color-warning-light' },
    ],
    'Brand Accent': [
      { name: 'Indigo', value: '#667eea', token: '--color-brand-indigo' },
      { name: 'Purple', value: '#764ba2', token: '--color-brand-purple' },
      { name: 'The B Team', value: '#E50A73', token: '--color-bteam-brand' },
      { name: 'The B Team Light', value: '#FDF2F6', token: '--color-bteam-brand-light' },
    ],
  };

  const typography = [
    { name: 'Text 2XS', class: 'text-[10px]', size: '10px' },
    { name: 'Text XS', class: 'text-xs', size: '12px' },
    { name: 'Text SM', class: 'text-sm', size: '14px' },
    { name: 'Text Base', class: 'text-base', size: '16px' },
    { name: 'Text LG', class: 'text-lg', size: '18px' },
    { name: 'Text XL', class: 'text-xl', size: '20px' },
    { name: 'Text 2XL', class: 'text-2xl', size: '24px' },
  ];

  const spacing = [1, 2, 3, 4, 6, 8, 12, 16];

  return (
    <div className="space-y-12">
      {/* Colors */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Color Palette</h2>
        {Object.entries(colors).map(([category, palette]) => (
          <div key={category} className="mb-8">
            <h3 className="text-sm font-medium text-vercel-gray-400 mb-3">{category}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {palette.map((color) => (
                <div key={color.name} className="space-y-2">
                  <div
                    className="w-full h-16 rounded-lg border border-vercel-gray-100"
                    style={{ backgroundColor: color.value }}
                  />
                  <div>
                    <p className="text-xs font-medium text-vercel-gray-600">{color.name}</p>
                    <p className="text-2xs text-vercel-gray-400 font-mono">{color.value}</p>
                    <p className="text-2xs text-vercel-gray-200 font-mono">{color.token}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Typography */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Typography Scale</h2>
        <div className="space-y-4">
          {typography.map((type) => (
            <div key={type.name} className="flex items-center gap-4 p-4 border border-vercel-gray-100 rounded-lg">
              <div className="w-24 text-xs text-vercel-gray-400">
                <p className="font-medium">{type.name}</p>
                <p className="font-mono">{type.size}</p>
              </div>
              <p className={type.class + ' text-vercel-gray-600'}>
                The quick brown fox jumps over the lazy dog
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Spacing */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Spacing Scale</h2>
        <div className="flex flex-wrap gap-4">
          {spacing.map((space) => (
            <div key={space} className="text-center">
              <div
                className="bg-brand-indigo rounded"
                style={{ width: space * 4, height: space * 4 }}
              />
              <p className="text-xs text-vercel-gray-400 mt-2">{space}</p>
              <p className="text-2xs text-vercel-gray-200">{space * 4}px</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
