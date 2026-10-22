import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../src/components/ui/dropdown-menu';

describe('ui/Button under React 18', () => {
  it('forwards its ref to the DOM button (Radix asChild triggers need it)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('works as a DropdownMenuTrigger asChild and returns focus on close', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Account menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
