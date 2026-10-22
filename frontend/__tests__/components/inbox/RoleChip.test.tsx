import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../../../src/components/ui/tooltip';
import { RoleChip } from '../../../src/components/inbox/chips';
import InboxList from '../../../src/components/inbox/InboxList';
import type { InboxItem } from '../../../src/lib/api';

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('RoleChip', () => {
  it('renders a short role in full with no truncation', () => {
    wrap(<RoleChip role="Product Designer" />);
    const chip = screen.getByTestId('role-chip');
    expect(chip).toHaveTextContent('Product Designer');
    expect(chip).toHaveAttribute('data-role-known', 'true');
  });

  it('truncates long roles to ~22ch and shows the full role in a tooltip', async () => {
    const role = 'Senior Staff Software Engineer, Platform Infrastructure';
    wrap(<RoleChip role={role} />);
    const chip = screen.getByTestId('role-chip');
    expect(chip.textContent!.length).toBeLessThanOrEqual(22);
    expect(chip.textContent).toMatch(/…$/);
    expect(chip).toHaveAccessibleName(`Role: ${role}`);
    await userEvent.hover(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(role);
  });

  it('shows a muted "Role unknown" chip with an explanatory tooltip when role is null', async () => {
    wrap(<RoleChip role={null} />);
    const chip = screen.getByTestId('role-chip');
    expect(chip).toHaveTextContent('Role unknown');
    expect(chip).toHaveAttribute('data-role-known', 'false');
    await userEvent.hover(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "Claude couldn't detect the role from the outreach",
    );
  });
});

function item(role: string | null): InboxItem {
  return {
    kind: 'candidate',
    id: 'c1',
    view: 'needs_review',
    sortAt: new Date().toISOString(),
    ageMs: 60_000,
    draft: null,
    candidate: {
      id: 'c1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      role,
      status: 'REPLIED',
      leverState: null,
      leverStage: null,
      leverPostingTitle: null,
      leverOpportunityId: null,
    },
    mailbox: { id: 'm1', emailAddress: 'paul.benigeri@archive.com', displayName: null },
    presence: [],
  } as InboxItem;
}

function renderList(items: InboxItem[]) {
  return wrap(
    <InboxList
      view="needs_review"
      items={items}
      loading={false}
      error={false}
      onRetry={vi.fn()}
      onOpen={vi.fn()}
      checked={new Set()}
      onCheckedChange={vi.fn()}
      onBatchSend={vi.fn()}
    />,
  );
}

describe('InboxList role chip', () => {
  it('puts the role chip first: [Role] [mailbox] [label]', () => {
    renderList([item('Founding Engineer')]);
    const row = screen.getByRole('listitem');
    const meta = within(row).getByTestId('role-chip').parentElement!;
    const chips = Array.from(meta.children).map((el) => el.textContent);
    expect(chips.slice(0, 3)).toEqual(['Founding Engineer', 'paul.benigeri', 'Needs review']);
  });

  it('shows "Role unknown" on rows whose candidate has no role', () => {
    renderList([item(null)]);
    expect(within(screen.getByRole('listitem')).getByTestId('role-chip')).toHaveTextContent('Role unknown');
  });
});
