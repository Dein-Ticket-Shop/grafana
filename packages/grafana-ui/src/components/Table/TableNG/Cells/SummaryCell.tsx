import { css, cx } from '@emotion/css';

import { GrafanaTheme2, Field } from '@grafana/data';

import { useStyles2 } from '../../../../themes/ThemeContext';
import { TableRow } from '../types';
import { getFooterItemNG } from '../utils';

interface SummaryCellProps {
  sortedRows: TableRow[];
  field: Field;
  omitCountAll: boolean;
}

export const SummaryCell = ({ sortedRows, field, omitCountAll }: SummaryCellProps) => {
  const styles = useStyles2(getStyles);
  const footerItem = getFooterItemNG(sortedRows, field);

  if (!footerItem) {
    return <div className={styles.footerCell} />;
  }

  const footerItemEntries = Object.entries(footerItem);

  // Render each reducer in the footer
  return (
    <div className={styles.footerCell}>
      {footerItemEntries.map(([reducerId, { reducerName, formattedValue }]) => {
        const isCountAll = reducerId === 'countAll';

        if (!isCountAll || !omitCountAll) {
          const canonicalReducerName = isCountAll ? 'Count' : reducerName;
          const isSingleSumReducer = Object.keys(footerItem).every((item) => item === 'sum');

          return (
            <div key={reducerId} className={cx(styles.footerItem, isSingleSumReducer && styles.sumReducer)}>
              {!isSingleSumReducer && <div className={styles.footerItemLabel}>{canonicalReducerName}</div>}
              <div className={styles.footerItemValue}>{formattedValue}</div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  footerCell: css({
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
  }),
  footerItem: css({
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  }),
  footerItemLabel: css({
    // Handle overflow reducer name collision with footer item value
    maxWidth: '75%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightLight,
    marginRight: theme.spacing(1),
    textTransform: 'uppercase',
  }),
  footerItemValue: css({
    maxWidth: '75%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  sumReducer: css({
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'end',
    width: '100%',
  }),
});
