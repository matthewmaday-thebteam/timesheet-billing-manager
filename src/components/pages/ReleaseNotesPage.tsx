import { useState, useMemo } from 'react';
import { useActiveReleaseNotes } from '../../hooks/useReleaseNotes';
import { releaseNotes as staticReleaseNotes } from '../../data/releaseNotes';
import { Card } from '../Card';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';

const PAGE_SIZE = 10;

/** Display shape shared by DB-backed records and the static fallback array. */
interface DisplayNote {
  key: string;
  version: string;
  date: string;
  title: string;
  highlights: string[];
}

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
  const { notes, loading, error } = useActiveReleaseNotes();
  const [page, setPage] = useState(0);

  // FALLBACK/kill-switch: when the DB hook errors or returns no notes, render the
  // static array so the page never goes blank during/after the migration.
  const displayNotes = useMemo<DisplayNote[]>(() => {
    if (!error && notes.length > 0) {
      return notes.map((note) => ({
        key: note.id,
        version: note.version_label,
        date: note.note_date,
        title: note.title,
        highlights: note.highlights,
      }));
    }
    return staticReleaseNotes.map((note) => ({
      key: note.date + note.title,
      version: note.version,
      date: note.date,
      title: note.title,
      highlights: note.highlights,
    }));
  }, [notes, error]);

  const totalPages = Math.ceil(displayNotes.length / PAGE_SIZE);
  const pageNotes = useMemo(
    () => displayNotes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [displayNotes, page],
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-vercel-gray-600">Release Notes</h1>
        <p className="mt-1 text-sm text-vercel-gray-400">A running log of updates and improvements</p>
      </div>

      {/* Error Alert (non-blocking — static fallback still renders below) */}
      {error && (
        <div className="mb-4">
          <Alert message="Showing the latest cached release notes." icon="info" variant="default" />
        </div>
      )}

      {loading && notes.length === 0 && !error ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading release notes...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {pageNotes.map((note) => (
            <Card key={note.key}>
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
      )}

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
