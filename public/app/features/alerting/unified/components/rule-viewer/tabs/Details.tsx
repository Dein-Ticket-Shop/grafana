import { css } from '@emotion/css';
import { formatDistanceToNowStrict } from 'date-fns';
import { isEmpty, isUndefined } from 'lodash';
import { Fragment } from 'react/jsx-runtime';

import { GrafanaTheme2, dateTimeFormat, dateTimeFormatTimeAgo } from '@grafana/data';
import { Trans, t } from '@grafana/i18n';
import { Icon, Link, Stack, Text, TextLink, useStyles2 } from '@grafana/ui';
import { useDatasource } from 'app/features/datasources/hooks';
import { CombinedRule } from 'app/types/unified-alerting';
import { GrafanaAlertingRuleDefinition, RulerGrafanaRuleDTO } from 'app/types/unified-alerting-dto';

import { usePendingPeriod } from '../../../hooks/rules/usePendingPeriod';
import { makeEditTimeIntervalLink } from '../../../utils/misc';
import { getAnnotations, isPausedRule, prometheusRuleType, rulerRuleType } from '../../../utils/rules';
import { isNullDate } from '../../../utils/time';
import { Tokenize } from '../../Tokenize';
import { DetailText } from '../../common/DetailText';
import { TimingOptionsMeta } from '../../notification-policies/Policy';
import { ContactPointLink } from '../ContactPointLink';

import { UpdatedByUser } from './version-history/UpdatedBy';

enum RuleType {
  GrafanaManagedAlertRule = 'Grafana-managed alert rule',
  GrafanaManagedRecordingRule = 'Grafana-managed recording rule',
  CloudAlertRule = 'Cloud alert rule',
  CloudRecordingRule = 'Cloud recording rule',
  Unknown = 'Unknown',
}

const DetailGroup = ({ title, children }: { title: string; children: React.ReactNode }) => {
  return (
    <Stack direction="column" gap={1}>
      <Text variant="h4">{title}</Text>
      <Stack direction="column" gap={2}>
        {children}
      </Stack>
    </Stack>
  );
};

interface DetailsProps {
  rule: CombinedRule;
}

export const Details = ({ rule }: DetailsProps) => {
  const styles = useStyles2(getStyles);

  const pendingPeriod = usePendingPeriod(rule);
  const keepFiringFor = rulerRuleType.grafana.alertingRule(rule.rulerRule) ? rule.rulerRule.keep_firing_for : undefined;

  let determinedRuleType: RuleType = RuleType.Unknown;
  if (rulerRuleType.grafana.alertingRule(rule.rulerRule)) {
    determinedRuleType = RuleType.GrafanaManagedAlertRule;
  } else if (rulerRuleType.grafana.recordingRule(rule.rulerRule)) {
    determinedRuleType = RuleType.GrafanaManagedRecordingRule;
  } else if (rulerRuleType.dataSource.alertingRule(rule.rulerRule)) {
    determinedRuleType = RuleType.CloudAlertRule;
  } else if (rulerRuleType.dataSource.recordingRule(rule.rulerRule)) {
    determinedRuleType = RuleType.CloudRecordingRule;
  }

  const targetDatasourceUid = rulerRuleType.grafana.recordingRule(rule.rulerRule)
    ? rule.rulerRule.grafana_alert.record?.target_datasource_uid
    : null;

  const datasource = useDatasource(targetDatasourceUid);

  const showTargetDatasource = targetDatasourceUid && targetDatasourceUid !== 'grafana';

  const evaluationDuration = rule.promRule?.evaluationTime;
  const evaluationTimestamp = rule.promRule?.lastEvaluation;

  const annotations = prometheusRuleType.alertingRule(rule.promRule) ? getAnnotations(rule.promRule) : undefined;

  const hasEvaluationDuration = Number.isFinite(evaluationDuration);

  const updated = rulerRuleType.grafana.rule(rule.rulerRule) ? rule.rulerRule.grafana_alert.updated : undefined;
  const isPaused = rulerRuleType.grafana.rule(rule.rulerRule) && isPausedRule(rule.rulerRule);

  const missingSeriesEvalsToResolve =
    rulerRuleType.grafana.rule(rule.rulerRule) &&
    !isUndefined(rule.rulerRule.grafana_alert.missing_series_evals_to_resolve)
      ? String(rule.rulerRule.grafana_alert.missing_series_evals_to_resolve)
      : undefined;

  const pausedIcon = (
    <Stack>
      <Text color="warning">
        <Icon name="pause-circle" />
      </Text>
      <Text>
        <Trans i18nKey="alerting.alert.evaluation-paused">Alert evaluation currently paused</Trans>
      </Text>
    </Stack>
  );
  return (
    <div className={styles.metadata}>
      <DetailGroup title={t('alerting.alert.rule', 'Rule')}>
        <DetailText id="rule-type" label={t('alerting.alert.rule-type', 'Rule type')} value={determinedRuleType} />
        {rulerRuleType.grafana.rule(rule.rulerRule) && (
          <>
            <DetailText
              id="rule-type"
              label={t('alerting.alert.rule-identifier', 'Rule identifier')}
              value={rule.rulerRule.grafana_alert.uid}
              monospace
              showCopyButton
              copyValue={rule.rulerRule.grafana_alert.uid}
            />
            <DetailText
              id="last-updated-by"
              label={t('alerting.alert.last-updated-by', 'Last updated by')}
              value={<UpdatedByUser user={rule.rulerRule.grafana_alert.updated_by} />}
            />
            {updated && (
              <DetailText
                id="date-of-last-update"
                label={t('alerting.alert.last-updated-at', 'Last updated at')}
                value={dateTimeFormat(updated) + ` (${dateTimeFormatTimeAgo(updated)})`}
              />
            )}
          </>
        )}
        {showTargetDatasource && (
          <DetailText
            id="target-datasource-uid"
            label={t('alerting.alert.target-datasource-uid', 'Target data source')}
            value={
              <Link href={`/connections/datasources/edit/${datasource?.uid}`}>
                <Stack direction="row" gap={1}>
                  <img style={{ width: '16px' }} src={datasource?.meta.info.logos.small} alt="datasource logo" />
                  {datasource?.name}
                </Stack>
              </Link>
            }
          />
        )}
      </DetailGroup>

      <DetailGroup title={t('alerting.alert.evaluation', 'Evaluation')}>
        {isPaused ? (
          pausedIcon
        ) : (
          <>
            {hasEvaluationDuration && evaluationTimestamp && (
              <DetailText
                id="last-evaluated"
                label={t('alerting.alert.last-evaluated', 'Last evaluated')}
                value={
                  !isNullDate(evaluationTimestamp)
                    ? formatDistanceToNowStrict(new Date(evaluationTimestamp), { addSuffix: true })
                    : '-'
                }
                tooltipValue={!isNullDate(evaluationTimestamp) ? dateTimeFormat(evaluationTimestamp) : undefined}
              />
            )}
            {hasEvaluationDuration && (
              <DetailText
                id="last-evaluation-duration"
                label={t('alerting.alert.last-evaluation-duration', 'Last evaluation duration')}
                value={`${evaluationDuration} ms`}
              />
            )}
            {missingSeriesEvalsToResolve && (
              <DetailText
                id="missing-series-resolve"
                label={t('alerting.alert.missing-series-resolve', 'Missing series evaluations to resolve')}
                value={missingSeriesEvalsToResolve}
                tooltipValue={t(
                  'alerting.alert.description-missing-series-evaluations',
                  'The number of consecutive evaluation intervals a dimension must be missing before the alert instance becomes stale, and is then automatically resolved and evicted. Defaults to 2 if empty.'
                )}
              />
            )}
          </>
        )}

        {pendingPeriod && (
          <DetailText
            id="pending-period"
            label={t('alerting.alert.pending-period', 'Pending period')}
            value={pendingPeriod}
          />
        )}
        {keepFiringFor && (
          <DetailText
            id="keep-firing-for"
            label={t('alerting.alert.keep-firing-for', 'Keep firing for')}
            value={keepFiringFor}
          />
        )}
      </DetailGroup>

      {/* show simplified routing information for Grafana managed alert rules */}
      {rulerRuleType.grafana.alertingRule(rule.rulerRule) &&
        !isEmpty(rule.rulerRule.grafana_alert.notification_settings) && (
          <NotificationSettings rulerRule={rule.rulerRule} />
        )}

      {rulerRuleType.grafana.rule(rule.rulerRule) &&
        // grafana recording rules don't have these fields
        rule.rulerRule.grafana_alert.no_data_state &&
        rule.rulerRule.grafana_alert.exec_err_state && (
          <DetailGroup title={t('alerting.alert.alert-state', 'Alert state')}>
            {hasEvaluationDuration && (
              <DetailText
                id="alert-state-no-data"
                label={t('alerting.alert.state-no-data', 'Alert state if no data or all values are null')}
                value={rule.rulerRule.grafana_alert.no_data_state}
              />
            )}
            {pendingPeriod && (
              <DetailText
                id="alert-state-exec-err"
                label={t('alerting.alert.state-error-timeout', 'Alert state if execution error or timeout')}
                value={rule.rulerRule.grafana_alert.exec_err_state}
              />
            )}
          </DetailGroup>
        )}

      {annotations && (
        <DetailGroup title={t('alerting.alert.annotations', 'Annotations')}>
          {Object.keys(annotations).length === 0 ? (
            <div>
              <Text color="secondary" italic>
                <Trans i18nKey="alerting.alert.no-annotations">No annotations</Trans>
              </Text>
            </div>
          ) : (
            Object.entries(annotations).map(([name, value]) => {
              const id = `annotation-${name.replace(/\s/g, '-')}`;
              return <DetailText id={id} key={name} label={name} value={<AnnotationValue value={value} />} />;
            })
          )}
        </DetailGroup>
      )}
    </div>
  );
};

interface AnnotationValueProps {
  value: string;
}

export function AnnotationValue({ value }: AnnotationValueProps) {
  const needsExternalLink = value && value.startsWith('http');
  const tokenizeValue = <Tokenize input={value} delimiter={['{{', '}}']} />;

  if (needsExternalLink) {
    return (
      <TextLink href={value} external>
        {value}
      </TextLink>
    );
  }

  return <Text color="primary">{tokenizeValue}</Text>;
}

interface NotificationSettingsProps {
  rulerRule: RulerGrafanaRuleDTO<GrafanaAlertingRuleDefinition>;
}

const NotificationSettings = ({ rulerRule }: NotificationSettingsProps) => {
  const notificationSettings = rulerRule.grafana_alert.notification_settings;
  if (!notificationSettings) {
    return null;
  }

  return (
    <DetailGroup title={t('alerting.alert.notification-configuration.group-title', 'Notification configuration')}>
      <DetailText
        id="receiver"
        label={t('alerting.alert.notification-configuration.contact-point', 'Contact point')}
        value={<ContactPointLink name={notificationSettings.receiver} />}
      />

      {notificationSettings.mute_time_intervals && (
        <DetailText
          id="mute-timings"
          label={t('alerting.alert.notification-configuration.mute-timings', 'Mute timings')}
          value={
            <>
              {notificationSettings.mute_time_intervals.map((intervalName, index) => (
                <Fragment key={intervalName}>
                  <TextLink href={makeEditTimeIntervalLink(intervalName, { alertmanager: 'grafana' })}>
                    {intervalName}
                  </TextLink>
                  {index < notificationSettings.mute_time_intervals!.length - 1 && ', '}
                </Fragment>
              ))}
            </>
          }
        />
      )}

      {notificationSettings.active_time_intervals && (
        <DetailText
          id="active-time-intervals"
          label={t('alerting.alert.notification-configuration.active-timings', 'Active time intervals')}
          value={
            <>
              {notificationSettings.active_time_intervals.map((intervalName, index) => (
                <Fragment key={intervalName}>
                  <TextLink href={makeEditTimeIntervalLink(intervalName, { alertmanager: 'grafana' })}>
                    {intervalName}
                  </TextLink>
                  {index < notificationSettings.active_time_intervals!.length - 1 && ', '}
                </Fragment>
              ))}
            </>
          }
        />
      )}

      {/* override grouping */}
      {notificationSettings.group_by && (
        <DetailText
          id="group-by"
          label={t('alerting.alert.notification-configuration.group-by', 'Grouped by')}
          value={notificationSettings.group_by.join(', ')}
        />
      )}

      {/* override timings */}
      {(notificationSettings.group_interval ||
        notificationSettings.group_wait ||
        notificationSettings.repeat_interval) && (
        <DetailText
          id="timing-options"
          label={t('alerting.alert.notification-configuration.timing-options', 'Timings')}
          value={
            <TimingOptionsMeta
              timingOptions={{
                group_interval: notificationSettings.group_interval,
                group_wait: notificationSettings.group_wait,
                repeat_interval: notificationSettings.repeat_interval,
              }}
            />
          }
        />
      )}
    </DetailGroup>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  metadata: css({
    display: 'grid',
    gap: theme.spacing(4),
    gridTemplateColumns: '1fr 1fr 1fr',

    [theme.breakpoints.down('lg')]: {
      gridTemplateColumns: '1fr 1fr',
    },
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  }),
});
