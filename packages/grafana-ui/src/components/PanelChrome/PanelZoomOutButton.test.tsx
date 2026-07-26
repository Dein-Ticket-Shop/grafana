import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PanelZoomOutButton } from './PanelZoomOutButton';

// Guards the Dein-Ticket-Shop fork patch (feat(kiosk): fullscreen kiosk panels). If
// this starts failing after a rebase onto upstream, the kiosk zoom-out button was
// dropped or changed - see CLAUDE.md.
describe('PanelZoomOutButton (Dein-Ticket-Shop fork)', () => {
  afterEach(() => {
    delete window.kioskZoomOut;
  });

  it('calls the provided onZoomOut handler when clicked', async () => {
    const onZoomOut = jest.fn();
    const user = userEvent.setup();
    render(<PanelZoomOutButton onZoomOut={onZoomOut} />);

    await user.click(screen.getByTestId('panel-zoom-out'));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('falls back to window.kioskZoomOut when no onZoomOut handler is provided', async () => {
    window.kioskZoomOut = jest.fn();
    const user = userEvent.setup();
    render(<PanelZoomOutButton />);

    await user.click(screen.getByTestId('panel-zoom-out'));

    expect(window.kioskZoomOut).toHaveBeenCalledTimes(1);
  });

  it('does not throw when neither onZoomOut nor window.kioskZoomOut is available', async () => {
    const user = userEvent.setup();
    render(<PanelZoomOutButton />);

    await expect(user.click(screen.getByTestId('panel-zoom-out'))).resolves.not.toThrow();
  });
});
