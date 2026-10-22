import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../../../src/components/ui/tooltip';
import { MailboxLine, RoleChip, RoleLine } from '../../../src/components/inbox/chips';
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

  it('renders long roles in full (no character cut-off) and repeats the role in a tooltip', async () => {
    const role = 'Senior Staff Software Engineer, Platform Infrastructure';
    wrap(<RoleChip role={role} />);
    const chip = screen.getByTestId('role-chip');
    expect(chip).toHaveTextContent(role);
    expect(chip.textContent).not.toMatch(/…/);
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

describe('RoleLine', () => {
  it('shows the full role title, however long, with the title in a tooltip', async () => {
    const role = 'Customer Success Manager, Enterprise Accounts (EMEA)';
    wrap(<RoleLine role={role} />);
    const line = screen.getByTestId('role-line');
    expect(line).toHaveTextContent(role);
    expect(line.textContent).not.toMatch(/…/);
    expect(line).toHaveAttribute('data-role-known', 'true');
    expect(line).toHaveAccessibleName(`Role: ${role}`);
    await userEvent.hover(line);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(role);
  });

  it('keeps the "Role unknown" state', () => {
    wrap(<RoleLine role="  " />);
    const line = screen.getByTestId('role-line');
    expect(line).toHaveTextContent('Role unknown');
    expect(line).toHaveAttribute('data-role-known', 'false');
  });
});

describe('MailboxLine', () => {
  it('labels the full sending address: "From <address>"', async () => {
    wrap(<MailboxLine email="rampersad.aaron@archive.com" />);
    const line = screen.getByTestId('mailbox-line');
    expect(line).toHaveTextContent('From rampersad.aaron@archive.com');
    expect(line).toHaveAccessibleName('Sent from rampersad.aaron@archive.com');
    await userEvent.hover(line);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('rampersad.aaron@archive.com');
  });
});

describe('InboxList row meta', () => {
  it('lays a row out as name / full role / "From" full mailbox + label / snippet', () => {
    renderList([item('Customer Success Manager')]);
    const row = screen.getByRole('listitem');
    expect(within(row).getByTestId('role-line')).toHaveTextContent('Customer Success Manager');
    const from = within(row).getByTestId('mailbox-line');
    expect(from).toHaveTextContent('From paul.benigeri@archive.com');
    // The status chip shares the "From" line.
    expect(within(from.parentElement!).getByText('Needs review')).toBeInTheDocument();
    const text = row.textContent!;
    expect(text.indexOf('Jane Doe')).toBeLessThan(text.indexOf('Customer Success Manager'));
    expect(text.indexOf('Customer Success Manager')).toBeLessThan(text.indexOf('From paul.benigeri@archive.com'));
    expect(text.indexOf('From paul.benigeri@archive.com')).toBeLessThan(text.indexOf('No draft yet'));
  });

  it('shows "Role unknown" on rows whose candidate has no role', () => {
    renderList([item(null)]);
    expect(within(screen.getByRole('listitem')).getByTestId('role-line')).toHaveTextContent('Role unknown');
  });
});
