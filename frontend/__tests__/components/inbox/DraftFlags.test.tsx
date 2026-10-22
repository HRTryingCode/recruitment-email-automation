// U1b: state flags on inbox rows and the reply pane (failed send, back from
// snooze, edited by, expiring soon).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DraftFlags, { type DraftFlagFields } from '../../../src/components/inbox/DraftFlags';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const plain: DraftFlagFields = {
  status: 'PENDING',
  sendError: null,
  returnedFromSnoozeAt: null,
  hasEdits: false,
  editedByName: null,
  expiresAt: new Date(NOW + 10 * 86_400_000).toISOString(),
};

describe('DraftFlags', () => {
  it('renders nothing for a plain waiting draft', () => {
    const { container } = render(<DraftFlags flags={plain} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Send failed" with the reason as its description', () => {
    render(<DraftFlags flags={{ ...plain, status: 'FAILED', sendError: 'Gmail said no' }} now={NOW} />);
    const chip = screen.getByText('Send failed');
    expect(chip.closest('[data-flag="failed"]')).toHaveAttribute('title', 'Gmail said no');
  });

  it('shows a "Back from snooze" dot', () => {
    render(<DraftFlags flags={{ ...plain, returnedFromSnoozeAt: new Date(NOW).toISOString() }} now={NOW} />);
    expect(screen.getByText('Back from snooze')).toBeInTheDocument();
  });

  it('names who edited the reply by first name', () => {
    render(<DraftFlags flags={{ ...plain, hasEdits: true, editedByName: 'Ana Recruiter' }} now={NOW} />);
    expect(screen.getByText('Edited by Ana')).toBeInTheDocument();
  });

  it('says "Edited" when the editor is unknown', () => {
    render(<DraftFlags flags={{ ...plain, hasEdits: true, editedByName: null }} now={NOW} />);
    expect(screen.getByText('Edited')).toBeInTheDocument();
  });

  it('warns when the draft expires within 3 days', () => {
    render(<DraftFlags flags={{ ...plain, expiresAt: new Date(NOW + 2 * 86_400_000 + 1000).toISOString() }} now={NOW} />);
    expect(screen.getByText('Expires in 2d')).toBeInTheDocument();
  });
});
