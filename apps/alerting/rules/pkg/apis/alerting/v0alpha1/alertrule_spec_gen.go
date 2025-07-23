// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v0alpha1

// +k8s:openapi-gen=true
type AlertRuleQuery struct {
	QueryType         string                     `json:"queryType"`
	RelativeTimeRange AlertRuleRelativeTimeRange `json:"relativeTimeRange"`
	DatasourceUID     AlertRuleDatasourceUID     `json:"datasourceUID"`
	Model             interface{}                `json:"model"`
	Source            *bool                      `json:"source,omitempty"`
}

// NewAlertRuleQuery creates a new AlertRuleQuery object.
func NewAlertRuleQuery() *AlertRuleQuery {
	return &AlertRuleQuery{
		RelativeTimeRange: *NewAlertRuleRelativeTimeRange(),
	}
}

// +k8s:openapi-gen=true
type AlertRuleRelativeTimeRange struct {
	From AlertRulePromDurationWMillis `json:"from"`
	To   AlertRulePromDurationWMillis `json:"to"`
}

// NewAlertRuleRelativeTimeRange creates a new AlertRuleRelativeTimeRange object.
func NewAlertRuleRelativeTimeRange() *AlertRuleRelativeTimeRange {
	return &AlertRuleRelativeTimeRange{}
}

// +k8s:openapi-gen=true
type AlertRulePromDurationWMillis string

// TODO(@moustafab): validate regex for datasource UID
// +k8s:openapi-gen=true
type AlertRuleDatasourceUID string

// +k8s:openapi-gen=true
type AlertRulePromDuration string

// +k8s:openapi-gen=true
type AlertRuleNotificationSettings struct {
	Receiver          string                         `json:"receiver"`
	GroupBy           []string                       `json:"groupBy,omitempty"`
	GroupWait         *string                        `json:"groupWait,omitempty"`
	GroupInterval     *string                        `json:"groupInterval,omitempty"`
	RepeatInterval    *string                        `json:"repeatInterval,omitempty"`
	MuteTimeIntervals []AlertRuleMuteTimeIntervalRef `json:"muteTimeIntervals,omitempty"`
}

// NewAlertRuleNotificationSettings creates a new AlertRuleNotificationSettings object.
func NewAlertRuleNotificationSettings() *AlertRuleNotificationSettings {
	return &AlertRuleNotificationSettings{}
}

// TODO(@moustafab): validate regex for mute time interval ref
// +k8s:openapi-gen=true
type AlertRuleMuteTimeIntervalRef string

// =~ figure out the regex for the template string
// +k8s:openapi-gen=true
type AlertRuleTemplateString string

// +k8s:openapi-gen=true
type AlertRuleSpec struct {
	Title                       string                             `json:"title"`
	Paused                      *bool                              `json:"paused,omitempty"`
	Data                        map[string]AlertRuleQuery          `json:"data"`
	Interval                    AlertRulePromDuration              `json:"interval"`
	NoDataState                 string                             `json:"noDataState"`
	ExecErrState                string                             `json:"execErrState"`
	NotificationSettings        []AlertRuleNotificationSettings    `json:"notificationSettings,omitempty"`
	For                         string                             `json:"for"`
	MissingSeriesEvalsToResolve *int64                             `json:"missingSeriesEvalsToResolve,omitempty"`
	Labels                      map[string]AlertRuleTemplateString `json:"labels"`
	Annotations                 map[string]AlertRuleTemplateString `json:"annotations"`
}

// NewAlertRuleSpec creates a new AlertRuleSpec object.
func NewAlertRuleSpec() *AlertRuleSpec {
	return &AlertRuleSpec{
		Data:         map[string]AlertRuleQuery{},
		NoDataState:  "NoData",
		ExecErrState: "Error",
		Labels:       map[string]AlertRuleTemplateString{},
		Annotations:  map[string]AlertRuleTemplateString{},
	}
}
