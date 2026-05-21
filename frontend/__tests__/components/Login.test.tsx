import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Login from '../../src/pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  );
}

describe('<Login />', () => {
  it('renders the welcome heading and sign-in prompt', () => {
    renderLogin();
    expect(
      screen.getByRole('heading', { name: /welcome/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sign in with your.*google account/i),
    ).toBeInTheDocument();
  });

  it('renders the Archive Recruiting branding', () => {
    renderLogin();
    expect(
      screen.getByRole('heading', { name: /archive recruiting/i }),
    ).toBeInTheDocument();
  });

  it('shows the GIS loading hint until the Google button is initialized', () => {
    // window.google is not stubbed, so the GIS init loop never resolves —
    // the loading hint must be visible on first render.
    renderLogin();
    expect(screen.getByText(/loading google sign-in/i)).toBeInTheDocument();
  });

  it('does NOT render the legacy email/password form (removed in Phase E)', () => {
    renderLogin();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/password/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^sign in$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /email/i }),
    ).not.toBeInTheDocument();
  });
});
