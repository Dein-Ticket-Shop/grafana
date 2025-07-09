import { css } from '@emotion/css';
import { useMemo, useRef, useEffect, useState, lazy, Suspense } from 'react';

import { SelectableValue, GrafanaTheme2 } from '@grafana/data';
import { Trans } from '@grafana/i18n';
import { SQLEditor, LanguageDefinition } from '@grafana/plugin-ui';
import { config } from '@grafana/runtime';
import { useStyles2, Stack, Button, Text } from '@grafana/ui';

import { QueryUsageContext } from '../ai/sqlPromptConfig';
import { useSQLSuggestions, useSQLExplanations } from '../hooks';
import { SqlExpressionQuery } from '../types';

import { AIExplanationDrawer } from './AIExplanationDrawer';
import { AISuggestionsDrawer } from './AISuggestionsDrawer';

// Lazy load the GenAI components to avoid circular dependencies
const GenAISQLSuggestionsButton = lazy(() =>
  import('./GenAISQLSuggestionsButton').then((module) => ({
    default: module.GenAISQLSuggestionsButton,
  }))
);

const GenAISQLExplainButton = lazy(() =>
  import('./GenAISQLExplainButton').then((module) => ({
    default: module.GenAISQLExplainButton,
  }))
);

// Account for Monaco editor's border to prevent clipping
const EDITOR_BORDER_ADJUSTMENT = 2; // 1px border on top and bottom

// Define the language definition for MySQL syntax highlighting and autocomplete
const EDITOR_LANGUAGE_DEFINITION: LanguageDefinition = {
  id: 'mysql',
  // Additional properties could be added here in the future if needed
  // eg:
  // completionProvider: to autocomplete field (ie column) names when given
  // a table name (dataframe reference)
  // formatter: to format the SQL query and dashboard variables
};

interface Props {
  refIds: Array<SelectableValue<string>>;
  query: SqlExpressionQuery;
  onChange: (query: SqlExpressionQuery) => void;
  /** Should the `format` property be set to `alerting`? */
  alerting?: boolean;
  panelId?: string;
}

export const SqlExpr = ({ onChange, refIds, query, alerting = false, panelId }: Props) => {
  const vars = useMemo(() => refIds.map((v) => v.value!), [refIds]);
  const initialQuery = `SELECT *
  FROM ${vars[0]}
  LIMIT 10`;

  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ height: 0 });

  const {
    handleApplySuggestion,
    handleHistoryUpdate,
    handleCloseDrawer,
    handleOpenDrawer,
    isDrawerOpen,
    hasUnseenSuggestions,
    suggestions,
  } = useSQLSuggestions();

  const {
    explanation,
    handleCloseExplanation,
    handleOpenExplanation,
    handleExplain,
    isExplanationOpen,
    shouldShowViewExplanation,
    updatePrevExpression,
  } = useSQLExplanations(query.expression || '');

  const queryContext: QueryUsageContext = useMemo(
    () => ({
      alerting,
      panelId,
      // TODO: Add dashboard context when available
    }),
    [alerting, panelId]
  );

  const onEditorChange = (expression: string) => {
    onChange({
      ...query,
      expression,
      format: alerting ? 'alerting' : undefined,
    });
    updatePrevExpression(expression);
  };

  const onApplySuggestion = (suggestion: string) => {
    onEditorChange(suggestion);
    handleApplySuggestion(suggestion);
  };

  // Set up resize observer to handle container resizing
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const { height } = entries[0].contentRect;
      setDimensions({ height });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    // Call the onChange method once so we have access to the initial query in consuming components
    // But only if expression is empty
    if (!query.expression) {
      onEditorChange(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Stack direction="column" gap={1}>
        {config.featureToggles.sqlExpressions && (
          <Stack direction="row" gap={1} alignItems="center" justifyContent="end">
            <Stack direction="row" gap={1} alignItems="center" justifyContent="end">
              <Suspense fallback={null}>
                {shouldShowViewExplanation ? (
                  <Button
                    fill="outline"
                    variant="secondary"
                    size="sm"
                    onClick={handleOpenExplanation}
                    icon="gf-movepane-right"
                  >
                    <Trans i18nKey="sql-expressions.view-explanation">View explanation</Trans>
                  </Button>
                ) : (
                  <GenAISQLExplainButton
                    currentQuery={query.expression || ''}
                    onExplain={handleExplain}
                    refIds={vars}
                    queryContext={queryContext}
                    // schemas={schemas} // Will be added when schema extraction is implemented
                  />
                )}
              </Suspense>
              <Suspense fallback={null}>
                <GenAISQLSuggestionsButton
                  initialQuery={initialQuery}
                  currentQuery={query.expression || ''}
                  onGenerate={() => {}} // Noop - history is managed via onHistoryUpdate
                  onHistoryUpdate={handleHistoryUpdate}
                  refIds={vars}
                  queryContext={queryContext}
                  // schemas={schemas} // Will be added when schema extraction is implemented
                  // errorContext={errorContext} // Will be added when error tracking is implemented
                />
              </Suspense>
            </Stack>
            {suggestions.length > 0 && (
              <div className={styles.buttonWrapper}>
                <Button variant="secondary" size="sm" onClick={handleOpenDrawer} icon="list-ol">
                  <Stack direction="row" gap={1} alignItems="center">
                    <Trans i18nKey="sql-expressions.suggestions">Suggestions</Trans>
                    <span className={styles.countBadge}>
                      <Text variant="bodySmall" weight="bold">
                        {suggestions.length}
                      </Text>
                    </span>
                  </Stack>
                </Button>
                {hasUnseenSuggestions && <span className={styles.newDot} />}
              </div>
            )}
          </Stack>
        )}

        <div ref={containerRef} className={styles.editorContainer}>
          <SQLEditor
            query={query.expression || initialQuery}
            onChange={onEditorChange}
            height={dimensions.height - EDITOR_BORDER_ADJUSTMENT}
            language={EDITOR_LANGUAGE_DEFINITION}
          />
        </div>
      </Stack>
      <AISuggestionsDrawer
        isOpen={isDrawerOpen}
        onApplySuggestion={onApplySuggestion}
        onClose={handleCloseDrawer}
        suggestions={suggestions}
      />
      <AIExplanationDrawer isOpen={isExplanationOpen} onClose={handleCloseExplanation} explanation={explanation} />
    </>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  editorContainer: css({
    height: '240px',
    resize: 'vertical',
    overflow: 'auto',
    minHeight: '100px',
  }),
  countBadge: css({
    color: theme.colors.primary.text,
    fontWeight: 'bold',
  }),
  buttonWrapper: css({
    position: 'relative',
    display: 'inline-block',
  }),
  newDot: css({
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    width: theme.spacing(1),
    height: theme.spacing(1),
    backgroundColor: theme.colors.error.main,
    borderRadius: theme.shape.radius.pill,
    zIndex: 1,
  }),
});
