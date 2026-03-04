import { releaseNotes } from '../../data/releaseNotes';
import { Card } from '../Card';

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
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-vercel-gray-600">Release Notes</h1>
        <p className="mt-1 text-sm text-vercel-gray-400">A running log of updates and improvements</p>
      </div>

      <div className="space-y-4">
        {releaseNotes.map((note) => (
          <Card key={note.date + note.title}>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
              <div className="shrink-0 text-sm font-medium text-vercel-gray-400 sm:w-32">
                {formatDate(note.date)}
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
    </div>
  );
}
