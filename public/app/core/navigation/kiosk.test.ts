import { KioskMode } from 'app/types/dashboard';

import { getKioskMode, getKioskModeFromUrl } from './kiosk';

describe('getKioskMode', () => {
  it('returns Full when kiosk=1', () => {
    expect(getKioskMode({ kiosk: '1' })).toBe(KioskMode.Full);
  });

  it('returns null when kiosk param is absent', () => {
    expect(getKioskMode({})).toBeNull();
  });
});

// Guards the Dein-Ticket-Shop fork patch (feat(kiosk): fullscreen kiosk panels). If
// this starts failing after a rebase onto upstream, the kiosk patch was dropped -
// see CLAUDE.md.
describe('getKioskModeFromUrl (Dein-Ticket-Shop fork)', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
  });

  it('reads kiosk mode from the current window location', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '?kiosk=1' },
      writable: true,
    });

    expect(getKioskModeFromUrl()).toBe(KioskMode.Full);
  });

  it('returns null when the current URL has no kiosk param', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '' },
      writable: true,
    });

    expect(getKioskModeFromUrl()).toBeNull();
  });
});
