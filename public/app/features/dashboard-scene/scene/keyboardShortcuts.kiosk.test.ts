import { behaviors, SceneTimeRange } from '@grafana/scenes';
import { DashboardCursorSync } from '@grafana/schema';
import { KeybindingSet } from 'app/core/services/KeybindingSet';

import { dashboardSceneGraph } from '../utils/dashboardSceneGraph';

import { DashboardScene } from './DashboardScene';
import { setupKeyboardShortcuts } from './keyboardShortcuts';

// Guards the Dein-Ticket-Shop fork patch (feat(kiosk): fullscreen kiosk panels), which
// exposes window.kioskZoomOut so the kiosk-mode PanelZoomOutButton (rendered by
// PanelChrome, far outside the scene graph) can trigger the dashboard's zoom-out
// behavior. Kept separate from upstream's keyboardShortcuts.test.ts to avoid conflicts
// on rebase - see CLAUDE.md. If this starts failing, the wiring was dropped or changed.
jest.mock('app/core/app_events', () => ({
  appEvents: {
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
    publish: jest.fn(),
  },
}));
jest.mock('app/core/services/KeybindingSet');
jest.mock('../utils/dashboardSceneGraph', () => ({
  dashboardSceneGraph: {
    getTimePicker: jest.fn(),
  },
}));

describe('window.kioskZoomOut (Dein-Ticket-Shop fork)', () => {
  let mockScene: DashboardScene;

  beforeEach(() => {
    jest.clearAllMocks();
    delete window.kioskZoomOut;

    const mockKeybindingSet = jest.mocked(new KeybindingSet());
    jest.spyOn(mockKeybindingSet, 'addBinding').mockImplementation();
    jest.spyOn(mockKeybindingSet, 'removeAll').mockImplementation();
    (KeybindingSet as jest.Mock).mockImplementation(() => mockKeybindingSet);

    mockScene = new DashboardScene({
      title: 'Test Dashboard',
      uid: 'test-uid',
      $timeRange: new SceneTimeRange({ from: 'now-6h', to: 'now' }),
      $behaviors: [new behaviors.CursorSync({ sync: DashboardCursorSync.Off })],
    });
    jest.spyOn(mockScene, 'canEditDashboard').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete window.kioskZoomOut;
  });

  it('is exposed as a function once keyboard shortcuts are set up', () => {
    setupKeyboardShortcuts(mockScene);

    expect(typeof window.kioskZoomOut).toBe('function');
  });

  it('triggers the same zoom-out behavior as the t z / ctrl+z shortcuts', () => {
    const timePicker = { onZoom: jest.fn() };
    (dashboardSceneGraph.getTimePicker as jest.Mock).mockReturnValue(timePicker);

    setupKeyboardShortcuts(mockScene);
    window.kioskZoomOut?.();

    expect(dashboardSceneGraph.getTimePicker).toHaveBeenCalledWith(mockScene);
    expect(timePicker.onZoom).toHaveBeenCalledTimes(1);
  });

  it('does not throw when there is no time picker available', () => {
    (dashboardSceneGraph.getTimePicker as jest.Mock).mockReturnValue(undefined);

    setupKeyboardShortcuts(mockScene);

    expect(() => window.kioskZoomOut?.()).not.toThrow();
  });
});
