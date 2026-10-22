import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PageHeader from '../../src/components/shell/PageHeader';
import QueryError from '../../src/components/shell/QueryError';
import { Button } from '../../src/components/ui/button';

describe('PageHeader', () => {
  it('renders the page h1, description and actions', () => {
    render(<PageHeader heading="Today" description="What is waiting." actions={<Button>Export</Button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    expect(screen.getByText('What is waiting.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export' })).toBeVisible();
  });

  it('srOnly keeps the h1 for screen readers without showing a header', () => {
    render(<PageHeader heading="Inbox" srOnly />);
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toHaveClass('sr-only');
  });
});

describe('QueryError', () => {
  it('says what could not load and retries', async () => {
    const onRetry = vi.fn();
    render(<QueryError thing="the team" description="The server returned an error." onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the team");
    expect(alert).toHaveTextContent('The server returned an error.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables Retry while a retry is in flight', () => {
    render(<QueryError thing="Lever status" onRetry={() => {}} retrying />);
    expect(screen.getByRole('button', { name: /Retry/ })).toBeDisabled();
  });
});
