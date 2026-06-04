import { format } from 'date-fns';
import { DropdownMenu } from './DropdownMenu';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type { ReleaseNoteRecord } from '../hooks/useReleaseNotes';

interface ReleaseNoteTableProps {
  notes: ReleaseNoteRecord[];
  loading: boolean;
  onEdit: (note: ReleaseNoteRecord) => void;
  onPublishToggle: (note: ReleaseNoteRecord) => void;
  onDelete: (note: ReleaseNoteRecord) => void;
}

const editIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const publishIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const unpublishIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

const deleteIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

export function ReleaseNoteTable({
  notes,
  loading,
  onEdit,
  onPublishToggle,
  onDelete,
}: ReleaseNoteTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading release notes...</span>
          </div>
        </div>
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No release notes yet</p>
          <p className="mt-1 text-xs text-vercel-gray-300">Click "Add Release Note" to create your first entry</p>
        </div>
      </div>
    );
  }

  const getMenuItems = (note: ReleaseNoteRecord) => [
    {
      label: 'Edit',
      onClick: () => onEdit(note),
      icon: editIcon,
    },
    {
      label: note.status === 'published' ? 'Unpublish' : 'Publish',
      onClick: () => onPublishToggle(note),
      icon: note.status === 'published' ? unpublishIcon : publishIcon,
    },
    {
      label: 'Delete',
      onClick: () => onDelete(note),
      variant: 'danger' as const,
      icon: deleteIcon,
    },
  ];

  const formatNoteDate = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return format(d, 'MMM d, yyyy');
  };

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-vercel-gray-100">
        <h3 className="text-sm font-semibold text-vercel-gray-600">
          All Release Notes ({notes.length})
        </h3>
        <p className="text-xs text-vercel-gray-400 mt-0.5">
          Drafts and published entries
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Version
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {notes.map((note) => (
              <tr
                key={note.id}
                className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <span className="text-sm font-mono text-vercel-gray-400">v{note.version_label}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-vercel-gray-600">
                    {formatNoteDate(note.note_date)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-vercel-gray-600">{note.title}</span>
                </td>
                <td className="px-4 py-3">
                  {note.status === 'published' ? (
                    <Badge variant="success">Published</Badge>
                  ) : (
                    <Badge variant="default">Draft</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end">
                    <DropdownMenu items={getMenuItems(note)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
