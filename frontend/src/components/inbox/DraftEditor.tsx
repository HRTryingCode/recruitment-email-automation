import { useState, type FormEvent } from 'react';
import { RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import type { EmailDraft } from '@/lib/api';
import type { DraftEditorState } from '@/hooks/useDraftEditor';
import ChangesView from './ChangesView';

export const QUICK_REWRITES: Array<{ label: string; instruction: string }> = [
  { label: 'Shorter', instruction: 'Make it shorter and more concise. Keep the meaning.' },
  { label: 'Warmer', instruction: 'Make the tone warmer and friendlier.' },
  { label: 'Propose times', instruction: 'Propose two or three specific times for a short call next week.' },
];

export function editorId(draftId: string): string {
  return `reply-body-${draftId}`;
}

/** Focus the reply textarea (the E shortcut). */
export function focusEditor(draftId: string): void {
  document.getElementById(editorId(draftId))?.focus();
}

type Mode = 'edit' | 'preview' | 'changes';

interface Props {
  draft: EmailDraft;
  editor: DraftEditorState;
  editable: boolean;
  rewriting: boolean;
  onRewrite: (instruction: string) => void;
  onRegenerate: () => void;
  /** Shown while the editor still holds the last rewrite's text. */
  onUndoRewrite?: () => void;
}

/** Plain-text reply editor with preview, AI diff/revert and instruction rewrites. */
export default function DraftEditor({ draft, editor, editable, rewriting, onRewrite, onRegenerate, onUndoRewrite }: Props) {
  const [mode, setMode] = useState<Mode>('edit');
  const [instruction, setInstruction] = useState('');
  const ai = draft.aiBodyText ?? null;
  const differsFromAi = ai !== null && ai !== editor.body;

  const submitInstruction = (e: FormEvent) => {
    e.preventDefault();
    const text = instruction.trim();
    if (!text) return;
    onRewrite(text);
    setInstruction('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Toggle
          size="sm"
          variant="outline"
          pressed={mode === 'preview'}
          onPressedChange={(p) => setMode(p ? 'preview' : 'edit')}
        >
          Preview
        </Toggle>
        {ai !== null && (
          <Toggle
            size="sm"
            variant="outline"
            pressed={mode === 'changes'}
            onPressedChange={(p) => setMode(p ? 'changes' : 'edit')}
          >
            Show changes
          </Toggle>
        )}
        {editable && differsFromAi && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              editor.setBody(ai);
              setMode('edit');
            }}
          >
            <Undo2 data-icon="inline-start" />
            Revert to AI draft
          </Button>
        )}
      </div>

      {mode === 'preview' ? (
        <p
          aria-label="Reply preview"
          className="min-h-48 whitespace-pre-wrap border-y border-border py-3 text-sm leading-relaxed text-foreground"
        >
          {editor.body}
        </p>
      ) : mode === 'changes' && ai !== null ? (
        <div className="min-h-48 border-y border-border py-3">
          {differsFromAi ? (
            <ChangesView before={ai} after={editor.body} />
          ) : (
            <p className="text-sm text-muted-foreground">No changes from the AI draft.</p>
          )}
        </div>
      ) : (
        <Textarea
          id={editorId(draft.id)}
          aria-label="Reply"
          value={editor.body}
          readOnly={!editable}
          onChange={(e) => editor.setBody(e.target.value)}
          onFocus={() => editor.setFocused(true)}
          onBlur={() => editor.setFocused(false)}
          rows={12}
          className="min-h-48 text-sm leading-relaxed"
        />
      )}

      {editable && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            {QUICK_REWRITES.map((r) => (
              <Button key={r.label} size="xs" variant="outline" disabled={rewriting} onClick={() => onRewrite(r.instruction)}>
                {r.label}
              </Button>
            ))}
            <Button size="xs" variant="ghost" disabled={rewriting} onClick={onRegenerate}>
              <RefreshCw data-icon="inline-start" />
              Regenerate
            </Button>
            {onUndoRewrite && !rewriting && (
              <Button size="xs" variant="ghost" onClick={onUndoRewrite}>
                <Undo2 data-icon="inline-start" />
                Undo rewrite
              </Button>
            )}
            {rewriting && <Spinner aria-label="Rewriting" />}
          </div>
          <form onSubmit={submitInstruction} className="flex items-center gap-2">
            <Input
              aria-label="Regenerate with instruction"
              placeholder="Regenerate with instruction…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={rewriting}
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={rewriting || !instruction.trim()}>
              Rewrite
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
