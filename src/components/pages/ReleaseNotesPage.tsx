import { useState, useMemo } from 'react';
import { releaseNotes } from '../../data/releaseNotes';
import { Card } from '../Card';
import { Button } from '../Button';

const PAGE_SIZE = 10;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ReleaseNotesPage() {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(releaseNotes.length / PAGE_SIZE);
  const pageNotes = useMemo(
    () => releaseNotes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [page],
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-vercel-gray-600">Release Notes</h1>
        <p className="mt-1 text-sm text-vercel-gray-400">A running log of updates and improvements</p>
      </div>

      <div className="space-y-4">
        {pageNotes.map((note) => (
          <Card key={note.date + note.title}>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
              <div className="shrink-0 text-sm sm:w-32">
                <div className="font-medium text-vercel-gray-400">{formatDate(note.date)}</div>
                <div className="font-mono text-xs text-vercel-gray-300 mt-0.5">v{note.version}</div>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-vercel-gray-600">
                  {note.title}
                </h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-vercel-gray-400">
                  {note.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-vercel-gray-100">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs font-mono text-vercel-gray-300">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
