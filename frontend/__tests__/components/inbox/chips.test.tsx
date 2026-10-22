import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabelChip, NeedsReviewChip, PresenceChip, MailboxChip } from '../../../src/components/inbox/chips';
import EvidenceMessage from '../../../src/components/inbox/EvidenceMessage';
import ChangesView from '../../../src/components/inbox/ChangesView';

describe('inbox chips', () => {
  it('LabelChip says the label in words, never a percentage', () => {
    const { container } = render(<LabelChip classification="INTERESTED" confidenceLabel="high" />);
    expect(screen.getByText('Interested')).toHaveAttribute('data-tone', 'success');
    expect(container.textContent).not.toMatch(/%/);
  });

  it('LabelChip reads Unsure for neutral drafts', () => {
    render(<LabelChip classification="NEUTRAL" confidenceLabel="high" />);
    expect(screen.getByText('Unsure')).toHaveAttribute('data-tone', 'warning');
  });

  it('NeedsReviewChip uses the shared status word (U2a vocabulary), not Unsure', () => {
    render(<NeedsReviewChip />);
    expect(screen.getByText('Needs review')).toHaveAttribute('data-tone', 'warning');
  });

  it('PresenceChip names who is on the reply and what they are doing', () => {
    render(<PresenceChip presence={[{ userId: 'u2', name: 'Sofia Delgado', mode: 'editing' }]} />);
    expect(screen.getByText('Sofia editing')).toBeInTheDocument();
  });

  it('PresenceChip renders nothing when nobody else is there', () => {
    const { container } = render(<PresenceChip presence={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('MailboxChip shows the full mailbox address', () => {
    render(<MailboxChip email="rae@example.com" />);
    expect(screen.getByText('rae@example.com')).toBeInTheDocument();
  });
});

describe('EvidenceMessage', () => {
  it('highlights the evidence quote inside the candidate message', () => {
    render(<EvidenceMessage body={"Thanks! I'd love to chat next week."} quote="love to chat" />);
    const mark = screen.getByText('love to chat');
    expect(mark.tagName).toBe('MARK');
  });
});

describe('ChangesView', () => {
  it('marks removed and added words', () => {
    render(<ChangesView before="Hi there friend" after="Hi you friend" />);
    expect(screen.getByText('there')).toHaveAttribute('data-op', 'del');
    expect(screen.getByText('you')).toHaveAttribute('data-op', 'add');
  });
});
