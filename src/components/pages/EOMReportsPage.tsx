import { Card } from '../Card';

export function EOMReportsPage() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <section>
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-semibold tracking-tight text-vercel-gray-600">
            End of Month Reports
          </h2>
        </div>
        <Card padding="lg">
          <p className="text-sm text-vercel-gray-400">
            EOM reporting coming soon. This page will provide monthly summaries,
            billing reports, and exportable data for invoicing.
          </p>
        </Card>
      </section>
    </div>
  );
}
