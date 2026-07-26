import { render, screen } from '@testing-library/react';

import { PanelChrome, PanelChromeProps } from './PanelChrome';

// Guards the Dein-Ticket-Shop fork patch (feat(kiosk): fullscreen kiosk panels): in
// kiosk mode PanelChrome hides the regular panel menu and shows the kiosk info/zoom-out
// buttons instead. Kept as a separate file from upstream's PanelChrome.test.tsx to
// avoid conflicts on rebase - see CLAUDE.md. If this starts failing after a rebase,
// the kiosk patch to PanelChrome was dropped or changed.
describe('PanelChrome kiosk mode (Dein-Ticket-Shop fork)', () => {
  const setup = (propOverrides?: Partial<PanelChromeProps>) => {
    const props: PanelChromeProps = {
      width: 100,
      height: 100,
      menu: <div>Menu</div>,
      children: (innerWidth, innerHeight) => <div style={{ width: innerWidth, height: innerHeight }}>Content</div>,
    };

    Object.assign(props, propOverrides);
    return render(<PanelChrome {...props} />);
  };

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders the regular panel menu when not in kiosk mode', () => {
    setup();

    expect(screen.getByTestId('panel-menu-button')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-zoom-out')).not.toBeInTheDocument();
  });

  it('hides the panel menu and shows kiosk info/zoom-out buttons when kiosk=1 is in the URL', () => {
    window.history.pushState({}, '', '/?kiosk=1');

    setup();

    expect(screen.queryByTestId('panel-menu-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('panel-zoom-out')).toBeInTheDocument();
  });
});
