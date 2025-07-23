import { UrlQueryMap } from '@grafana/data';
import { KioskMode } from 'app/types/dashboard';

// TODO Remove after topnav feature toggle is permanent and old NavBar is removed
export function getKioskMode(queryParams: UrlQueryMap): KioskMode | null {
  switch (queryParams.kiosk) {
    //  legacy support
    case '':
    case '1':
    case true:
      return KioskMode.Full;
    default:
      return null;
  }
}

export function getKioskModeFromUrl(): KioskMode | null {
  const queryParams = new URLSearchParams(window.location.search);
  return getKioskMode(Object.fromEntries(queryParams.entries()));
}
