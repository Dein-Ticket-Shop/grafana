package cloudwatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana/pkg/tsdb/cloudwatch/kinds/dataquery"
	"github.com/grafana/grafana/pkg/tsdb/cloudwatch/models"
)

const initialAlertPollPeriod = time.Second

var executeSyncLogQuery = func(ctx context.Context, ds *DataSource, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	resp := backend.NewQueryDataResponse()

	for _, q := range req.Queries {
		var logsQuery models.LogsQuery
		err := json.Unmarshal(q.JSON, &logsQuery)
		if err != nil {
			continue
		}

		logsQuery.Subtype = "StartQuery"
		if logsQuery.Expression != nil {
			logsQuery.QueryString = *logsQuery.Expression
		}

		region := logsQuery.Region
		if region == "" || region == defaultRegion {
			logsQuery.Region = ds.Settings.Region
		}

		logsClient, err := ds.getCWLogsClient(ctx, region)
		if err != nil {
			return nil, err
		}

		refId := "A"
		if q.RefID != "" {
			refId = q.RefID
		}

		getQueryResultsOutput, err := ds.syncQuery(ctx, logsClient, q, logsQuery, ds.Settings.LogsTimeout.Duration)
		var sourceError backend.ErrorWithSource
		if errors.As(err, &sourceError) {
			resp.Responses[refId] = backend.ErrorResponseWithErrorSource(sourceError)
			continue
		}
		if err != nil {
			return nil, err
		}

		dataframe, err := logsResultsToDataframes(getQueryResultsOutput, logsQuery.StatsGroups)
		if err != nil {
			return nil, err
		}

		var frames []*data.Frame
		if len(logsQuery.StatsGroups) > 0 && len(dataframe.Fields) > 0 {
			frames, err = groupResults(dataframe, logsQuery.StatsGroups, true)
			if err != nil {
				return nil, err
			}
		} else {
			frames = data.Frames{dataframe}
		}

		respD := resp.Responses[refId]
		respD.Frames = frames
		resp.Responses[refId] = respD
	}

	return resp, nil
}

func (ds *DataSource) syncQuery(ctx context.Context, logsClient models.CWLogsClient,
	queryContext backend.DataQuery, logsQuery models.LogsQuery, logsTimeout time.Duration) (*cloudwatchlogs.GetQueryResultsOutput, error) {
	startQueryOutput, err := ds.executeStartQuery(ctx, logsClient, logsQuery, queryContext.TimeRange)
	if err != nil {
		return nil, err
	}

	requestParams := models.LogsQuery{
		CloudWatchLogsQuery: dataquery.CloudWatchLogsQuery{
			Region: logsQuery.Region,
		},
		QueryId: *startQueryOutput.QueryId,
	}

	/*
		Unlike many other data sources, with Cloudwatch Logs query requests don't receive the results as the response
		to the query, but rather an ID is first returned. Following this, a client is expected to send requests along
		with the ID until the status of the query is complete, receiving (possibly partial) results each time. For
		queries made via dashboards and Explore, the logic of making these repeated queries is handled on the
		frontend, but because alerts and expressions are executed on the backend the logic needs to be reimplemented here.
	*/

	ticker := time.NewTicker(initialAlertPollPeriod)
	defer ticker.Stop()

	attemptCount := 1
	for range ticker.C {
		res, err := ds.executeGetQueryResults(ctx, logsClient, requestParams)
		if err != nil {
			return nil, err
		}
		if isTerminated(res.Status) {
			return res, err
		}
		if time.Duration(attemptCount)*time.Second >= logsTimeout {
			return res, fmt.Errorf("time to fetch query results exceeded logs timeout")
		}

		attemptCount++
	}

	return nil, nil
}
