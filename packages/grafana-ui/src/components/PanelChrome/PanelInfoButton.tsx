import { cx } from '@emotion/css';
import React from 'react';

import { t } from '@grafana/i18n';

import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';

interface PanelInfoButtonProps {
  className?: string;
  showOnHoverClass?: string;
  tabIndex?: number;
}

/**
 * Kiosk mode info button with multi-line tooltip explaining interaction.
 */
export const PanelInfoButton: React.FC<PanelInfoButtonProps> = ({ className, showOnHoverClass, tabIndex = 0 }) => {
  const tooltipContent = (
    <>
      {[
        'grafana-ui.panel-chrome.tooltip-zoom-help-line1',
        'grafana-ui.panel-chrome.tooltip-zoom-help-line2',
        'grafana-ui.panel-chrome.tooltip-zoom-help-line3',
        'grafana-ui.panel-chrome.tooltip-zoom-help-line4',
      ].map((key, i) => {
        const defaults = [
          'Zoom: Klicken und ziehen, um einen Zeitraum auszuwählen.',
          'Herauszoomen: Auf das Lupen-Symbol klicken.',
          'Einzelne Linie anzeigen: Auf den Eintrag in der Legende klicken.',
          'Mehrere Linien anzeigen: Mit gedrückter Shift-Taste zusätzliche Legendeneinträge anklicken.',
        ];
        const full = t(key, defaults[i]);
        const colonIdx = full.indexOf(':');
        if (colonIdx === -1) {
          return (
            <React.Fragment key={key}>
              {full}
              {i < 3 && <br />}
            </React.Fragment>
          );
        }
        const label = full.slice(0, colonIdx);
        const rest = full.slice(colonIdx + 1);
        return (
          <React.Fragment key={key}>
            <strong style={{ fontWeight: 600 }}>{label}:</strong>
            {rest}
            {i < 3 && <br />}
          </React.Fragment>
        );
      })}
    </>
  );

  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        aria-label={t('grafana-ui.panel-chrome.aria-label-info', 'Informationen zur Diagramm-Navigation')}
        className={cx(className, showOnHoverClass)}
        tabIndex={tabIndex}
      >
        <Icon name="info-circle" />
      </button>
    </Tooltip>
  );
};
