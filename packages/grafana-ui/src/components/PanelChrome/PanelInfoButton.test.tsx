import { render, screen } from '@testing-library/react';

import { PanelInfoButton } from './PanelInfoButton';

// Guards the Dein-Ticket-Shop fork patch (feat(kiosk): fullscreen kiosk panels). If
// this starts failing after a rebase onto upstream, the kiosk info button was dropped
// or changed - see CLAUDE.md.
describe('PanelInfoButton (Dein-Ticket-Shop fork)', () => {
  it('renders an info button', () => {
    render(<PanelInfoButton />);

    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
