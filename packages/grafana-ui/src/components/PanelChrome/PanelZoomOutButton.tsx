import { cx } from '@emotion/css';
import React from 'react';

import { t } from '@grafana/i18n';

import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';

interface PanelZoomOutButtonProps {
  className?: string;
  showOnHoverClass?: string;
  tabIndex?: number;
  onZoomOut?: () => void;
}

/**
 * Kiosk mode zoom-out button that triggers provided onZoomOut or kioskZoomOut helper.
 */
export const PanelZoomOutButton: React.FC<PanelZoomOutButtonProps> = ({
  className,
  showOnHoverClass,
  tabIndex = 0,
  onZoomOut,
}) => {
  const handleClick = () => {
    if (onZoomOut) {
      onZoomOut();
      return;
    }
    // fallback to global helper provided by kiosk integration if present
    if (typeof window.kioskZoomOut === 'function') {
      window.kioskZoomOut();
    }
  };

  const tooltipContent = t('grafana-ui.panel-chrome.tooltip-zoom-out', 'Herauszoomen');

  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        aria-label={t('grafana-ui.panel-chrome.aria-label-zoom-out', 'Herauszoomen')}
        data-testid="panel-zoom-out"
        className={cx(className, showOnHoverClass)}
        tabIndex={tabIndex}
        onClick={handleClick}
      >
        <Icon name="search-minus" />
      </button>
    </Tooltip>
  );
};

// Augment the Window interface to include kioskZoomOut so we don't need a type assertion.
declare global {
  interface Window {
    kioskZoomOut?: () => void;
  }
}
