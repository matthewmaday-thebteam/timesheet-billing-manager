import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Input } from './Input';
import { DatePicker } from './DatePicker';
import { Toggle } from './Toggle';
import type { ReleaseNoteRecord, ReleaseNoteInput } from '../hooks/useReleaseNotes';

interface ReleaseNoteEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: ReleaseNoteRecord | null;
  /** Persist a new note. `published` controls whether it is published after creation. */
  onSave: (input: ReleaseNoteInput, published: boolean) => Promise<boolean>;
  /** Persist edits. `published` controls publish/unpublish after the update. */
  onUpdate: (id: string, input: ReleaseNoteInput, published: boolean) => Promise<boolean>;
  isSaving: boolean;
}

interface FormState {
  title: string;
  version_label: string;
  note_date: string;
  highlights: string; // one bullet per line in the textarea
  published: boolean;
}

interface FormErrors {
  title?: string;
  version_label?: string;
  note_date?: string;
  highlights?: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getFormStateFromNote(note: ReleaseNoteRecord | null): FormState {
  if (note) {
    return {
      title: note.title,
      version_label: note.version_label,
      note_date: note.note_date,
      highlights: note.highlights.join('\n'),
      published: note.status === 'published',
    };
  }
  return {
    title: '',
    version_label: '',
    note_date: todayIsoDate(),
    highlights: '',
    published: false,
  };
}

/** Split textarea content into a trimmed, empty-free string[] (one bullet per line). */
function parseHighlights(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function ReleaseNoteEditorModal({
  isOpen,
  onClose,
  note,
  onSave,
  onUpdate,
  isSaving,
}: ReleaseNoteEditorModalProps) {
  const [formData, setFormData] = useState<FormState>(() => getFormStateFromNote(note));
  const [errors, setErrors] = useState<FormErrors>({});
  const [lastResetKey, setLastResetKey] = useState<string>('');

  const isEditing = !!note;

  // Reset form when note/isOpen changes (React-recommended pattern, mirrors HolidayEditorModal)
  const resetKey = `${note?.id ?? 'new'}-${isOpen}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setFormData(getFormStateFromNote(note));
    setErrors({});
  }

  const validateForm = (highlights: string[]): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }
    if (!formData.version_label.trim()) {
      newErrors.version_label = 'Version label is required';
    }
    if (!formData.note_date) {
      newErrors.note_date = 'Date is required';
    }
    if (highlights.length === 0) {
      newErrors.highlights = 'Add at least one highlight';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const highlights = parseHighlights(formData.highlights);
    if (!validateForm(highlights)) return;

    const input: ReleaseNoteInput = {
      title: formData.title.trim(),
      version_label: formData.version_label.trim(),
      note_date: formData.note_date,
      highlights,
    };

    let success: boolean;
    if (isEditing && note) {
      success = await onUpdate(note.id, input, formData.published);
    } else {
      success = await onSave(input, formData.published);
    }

    if (success) {
      onClose();
    }
  };

  const handleFieldChange = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field in errors) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const footerContent = (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" variant="primary" onClick={() => handleSubmit()} disabled={isSaving}>
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" color="white" />
            Saving...
          </span>
        ) : isEditing ? (
          'Update Release Note'
        ) : (
          'Add Release Note'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Release Note' : 'Add Release Note'}
      maxWidth="lg"
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <Input
          label="Title"
          value={formData.title}
          onChange={(e) => handleFieldChange('title', e.target.value)}
          placeholder="e.g. QuickBooks Invoice Fix"
          error={errors.title}
        />

        {/* Version label */}
        <Input
          label="Version Label"
          value={formData.version_label}
          onChange={(e) => handleFieldChange('version_label', e.target.value)}
          placeholder="e.g. 1.0.0.109"
          error={errors.version_label}
        />

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
            Date
          </label>
          <DatePicker
            value={formData.note_date}
            onChange={(date) => handleFieldChange('note_date', date)}
            placeholder="Select a date"
            error={!!errors.note_date}
          />
          {errors.note_date && (
            <p className="mt-1 text-xs text-error" role="alert">{errors.note_date}</p>
          )}
        </div>

        {/* Highlights — one bullet per line */}
        <div>
          <label
            htmlFor="release-note-highlights"
            className="block text-sm font-medium text-vercel-gray-600 mb-1"
          >
            Highlights
          </label>
          <textarea
            id="release-note-highlights"
            value={formData.highlights}
            onChange={(e) => handleFieldChange('highlights', e.target.value)}
            placeholder={'One bullet per line, e.g.:\nFixed: invoices now send for large task lists\nAdded: month-start SLA revenue materialization'}
            rows={6}
            className="w-full !bg-white rounded-md border border-vercel-gray-200 focus:border-vercel-gray-400 focus:ring-1 focus:ring-vercel-gray-400 focus:outline-none transition-colors text-sm text-vercel-gray-600 placeholder:text-vercel-gray-200 px-3 py-2 resize-none"
          />
          {errors.highlights ? (
            <p className="mt-1 text-xs text-error" role="alert">{errors.highlights}</p>
          ) : (
            <p className="mt-1 text-xs text-vercel-gray-400">One bullet per line. Blank lines are ignored.</p>
          )}
        </div>

        {/* Published toggle */}
        <Toggle
          label="Published"
          description="Published notes appear on the public Release Notes page"
          checked={formData.published}
          onChange={(checked) => handleFieldChange('published', checked)}
        />
      </form>
    </Modal>
  );
}
