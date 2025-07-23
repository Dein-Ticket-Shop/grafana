package v0alpha1

import "time"

#PromDurationWMillis: time.Duration & =~"^((([0-9]+)y)?(([0-9]+)w)?(([0-9]+)d)?(([0-9]+)h)?(([0-9]+)m)?(([0-9]+)s)?(([0-9]+)ms)?|0)$"

#PromDuration: time.Duration & =~"^((([0-9]+)y)?(([0-9]+)w)?(([0-9]+)d)?(([0-9]+)h)?(([0-9]+)m)?(([0-9]+)s)?|0)$"

TemplateString: string                       // =~ figure out the regex for the template string
#DatasourceUID: string & =~"^[a-zA-Z0-9_]+$" // TODO(@moustafab): validate regex for datasource UID

#MuteTimeIntervalRef: string // TODO(@moustafab): validate regex for mute time interval ref

#RuleSpec: {
	title:   string
	paused?: bool
	data: {
		[string]: #Query
	}
	interval: #PromDuration
	labels: {
		[string]: TemplateString
	}
	...
}

#Json: {
	[string]: #Json | [...#Json] | string | bool | number | null
}

#RelativeTimeRange: {
	from: #PromDurationWMillis
	to:   #PromDurationWMillis
}

#Query: {
	queryType:         string
	relativeTimeRange: #RelativeTimeRange
	datasourceUID:     #DatasourceUID
	model:             #Json
	source?:           bool
}
