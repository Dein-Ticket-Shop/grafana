package notifier

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-openapi/strfmt"
	"k8s.io/apimachinery/pkg/util/sets"

	"github.com/grafana/grafana/pkg/apimachinery/errutil"
	"github.com/grafana/grafana/pkg/services/ngalert/api/tooling/definitions"
	"github.com/grafana/grafana/pkg/services/ngalert/models"
	"github.com/grafana/grafana/pkg/services/ngalert/notifier/legacy_storage"
	"github.com/grafana/grafana/pkg/services/ngalert/store"
	"github.com/grafana/grafana/pkg/services/secrets"
	"github.com/grafana/grafana/pkg/util"
)

var (
	// ErrAlertmanagerReceiverInUse is primarily meant for when a receiver is used by a rule and is being deleted.
	ErrAlertmanagerReceiverInUse = errutil.BadRequest("alerting.notifications.alertmanager.receiverInUse").MustTemplate("receiver [Name: {{ .Public.Receiver }}] is used by rule: {{ .Error }}",
		errutil.WithPublic(
			"receiver [Name: {{ .Public.Receiver }}] is used by rule",
		))
	// ErrAlertmanagerTimeIntervalInUse is primarily meant for when a time interval is used by a rule and is being deleted.
	ErrAlertmanagerTimeIntervalInUse = errutil.BadRequest("alerting.notifications.alertmanager.intervalInUse").MustTemplate("time interval [Name: {{ .Public.Interval }}] is used by rule: {{ .Error }}",
		errutil.WithPublic(
			"time interval [Name: {{ .Public.Interval }}] is used by rule",
		))

	msgAlertmanagerMultipleExtraConfigsUnsupported = "multiple extra configurations are not supported, found another configuration with identifier: {{ .Public.Identifier }}"
	ErrAlertmanagerMultipleExtraConfigsUnsupported = errutil.Conflict("alerting.notifications.alertmanager.multipleExtraConfigsUnsupported").MustTemplate(
		msgAlertmanagerMultipleExtraConfigsUnsupported,
		errutil.WithPublic(msgAlertmanagerMultipleExtraConfigsUnsupported),
	)
)

type UnknownReceiverError struct {
	UID string
}

func (e UnknownReceiverError) Error() string {
	return fmt.Sprintf("unknown receiver: %s", e.UID)
}

type AlertmanagerConfigRejectedError struct {
	Inner error
}

func (e AlertmanagerConfigRejectedError) Error() string {
	return fmt.Sprintf("failed to save and apply Alertmanager configuration: %s", e.Inner.Error())
}

type configurationStore interface {
	GetLatestAlertmanagerConfiguration(ctx context.Context, orgID int64) (*models.AlertConfiguration, error)
}

func (moa *MultiOrgAlertmanager) SaveAndApplyDefaultConfig(ctx context.Context, orgId int64) error {
	moa.alertmanagersMtx.RLock()
	defer moa.alertmanagersMtx.RUnlock()

	orgAM, err := moa.alertmanagerForOrg(orgId)
	if err != nil {
		return err
	}

	previousConfig, cleanPermissionsErr := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, orgId)

	err = orgAM.SaveAndApplyDefaultConfig(ctx)
	if err != nil {
		return err
	}

	// Attempt to cleanup permissions for receivers that are no longer defined and add defaults for new receivers.
	// Failure should not prevent the default config from being applied.
	if cleanPermissionsErr == nil {
		cleanPermissionsErr = func() error {
			defaultedConfig, err := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, orgId)
			if err != nil {
				return err
			}
			newReceiverNames, err := extractReceiverNames(defaultedConfig.AlertmanagerConfiguration)
			if err != nil {
				return err
			}
			return moa.cleanPermissions(ctx, orgId, previousConfig, newReceiverNames)
		}()
	}
	if cleanPermissionsErr != nil {
		moa.logger.Error("Failed to clean permissions for receivers", "error", cleanPermissionsErr)
	}

	return nil
}

// ApplyConfig will apply the given alertmanager configuration for a given org.
// Can be used to force regeneration of autogenerated routes.
func (moa *MultiOrgAlertmanager) ApplyConfig(ctx context.Context, orgId int64, dbConfig *models.AlertConfiguration) error {
	am, err := moa.AlertmanagerFor(orgId)
	if err != nil {
		// It's okay if the alertmanager isn't ready yet, we're changing its config anyway.
		if !errors.Is(err, ErrAlertmanagerNotReady) {
			return err
		}
	}

	err = am.ApplyConfig(ctx, dbConfig)
	if err != nil {
		return fmt.Errorf("failed to apply configuration: %w", err)
	}
	return nil
}

// GetAlertmanagerConfiguration returns the latest alertmanager configuration for a given org.
// If withAutogen is true, the configuration will be augmented with autogenerated routes.
func (moa *MultiOrgAlertmanager) GetAlertmanagerConfiguration(ctx context.Context, org int64, withAutogen bool) (definitions.GettableUserConfig, error) {
	amConfig, err := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, org)
	if err != nil {
		return definitions.GettableUserConfig{}, fmt.Errorf("failed to get latest configuration: %w", err)
	}

	cfg, err := moa.gettableUserConfigFromAMConfigString(ctx, org, amConfig.AlertmanagerConfiguration)
	if err != nil {
		return definitions.GettableUserConfig{}, err
	}

	if withAutogen {
		// We validate the notification settings in a similar way to when we POST.
		// Otherwise, broken settings (e.g. a receiver that doesn't exist) will cause the config returned here to be
		// different than the config currently in-use.
		// TODO: Preferably, we'd be getting the config directly from the in-memory AM so adding the autogen config would not be necessary.
		err := AddAutogenConfig(ctx, moa.logger, moa.configStore, org, &cfg.AlertmanagerConfig, true)
		if err != nil {
			return definitions.GettableUserConfig{}, err
		}
	}
	return cfg, nil
}

// ActivateHistoricalConfiguration will set the current alertmanager configuration to a previous value based on the provided
// alert_configuration_history id.
func (moa *MultiOrgAlertmanager) ActivateHistoricalConfiguration(ctx context.Context, orgId int64, id int64) error {
	config, err := moa.configStore.GetHistoricalConfiguration(ctx, orgId, id)
	if err != nil {
		return fmt.Errorf("failed to get historical alertmanager configuration: %w", err)
	}

	cfg, err := Load([]byte(config.AlertmanagerConfiguration))
	if err != nil {
		return fmt.Errorf("failed to unmarshal historical alertmanager configuration: %w", err)
	}

	am, err := moa.AlertmanagerFor(orgId)
	if err != nil {
		// It's okay if the alertmanager isn't ready yet, we're changing its config anyway.
		if !errors.Is(err, ErrAlertmanagerNotReady) {
			return err
		}
	}

	previousConfig, cleanPermissionsErr := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, orgId)

	if err := am.SaveAndApplyConfig(ctx, cfg); err != nil {
		moa.logger.Error("Unable to save and apply historical alertmanager configuration", "error", err, "org", orgId, "id", id)
		return AlertmanagerConfigRejectedError{err}
	}
	moa.logger.Info("Applied historical alertmanager configuration", "org", orgId, "id", id)

	// Attempt to cleanup permissions for receivers that are no longer defined and add defaults for new receivers.
	// Failure should not prevent the default config from being applied.
	if cleanPermissionsErr == nil {
		cleanPermissionsErr = func() error {
			newReceiverNames, err := extractReceiverNames(config.AlertmanagerConfiguration)
			if err != nil {
				return err
			}
			return moa.cleanPermissions(ctx, orgId, previousConfig, newReceiverNames)
		}()
	}
	if cleanPermissionsErr != nil {
		moa.logger.Error("Failed to clean permissions for receivers", "error", cleanPermissionsErr)
	}

	return nil
}

// GetAppliedAlertmanagerConfigurations returns the last n configurations marked as applied for a given org.
func (moa *MultiOrgAlertmanager) GetAppliedAlertmanagerConfigurations(ctx context.Context, org int64, limit int) ([]*definitions.GettableHistoricUserConfig, error) {
	configs, err := moa.configStore.GetAppliedConfigurations(ctx, org, limit)
	if err != nil {
		return []*definitions.GettableHistoricUserConfig{}, fmt.Errorf("failed to get applied configurations: %w", err)
	}

	gettableHistoricConfigs := make([]*definitions.GettableHistoricUserConfig, 0, len(configs))
	for _, config := range configs {
		appliedAt := strfmt.DateTime(time.Unix(config.LastApplied, 0).UTC())
		gettableConfig, err := moa.gettableUserConfigFromAMConfigString(ctx, org, config.AlertmanagerConfiguration)
		if err != nil {
			// If there are invalid records, skip them and return the valid ones.
			moa.logger.Warn("Invalid configuration found in alert configuration history table", "id", config.ID, "orgID", org)
			continue
		}

		gettableHistoricConfig := definitions.GettableHistoricUserConfig{
			ID:                      config.ID,
			TemplateFiles:           gettableConfig.TemplateFiles,
			TemplateFileProvenances: gettableConfig.TemplateFileProvenances,
			AlertmanagerConfig:      gettableConfig.AlertmanagerConfig,
			LastApplied:             &appliedAt,
		}
		gettableHistoricConfigs = append(gettableHistoricConfigs, &gettableHistoricConfig)
	}

	return gettableHistoricConfigs, nil
}

func (moa *MultiOrgAlertmanager) gettableUserConfigFromAMConfigString(ctx context.Context, orgID int64, config string) (definitions.GettableUserConfig, error) {
	cfg, err := Load([]byte(config))
	if err != nil {
		return definitions.GettableUserConfig{}, fmt.Errorf("failed to unmarshal alertmanager configuration: %w", err)
	}

	err = moa.Crypto.DecryptExtraConfigs(ctx, cfg)
	if err != nil {
		return definitions.GettableUserConfig{}, fmt.Errorf("failed to decrypt external configurations: %w", err)
	}

	result := definitions.GettableUserConfig{
		TemplateFiles: cfg.TemplateFiles,
		AlertmanagerConfig: definitions.GettableApiAlertingConfig{
			Config: cfg.AlertmanagerConfig.Config,
		},
		ExtraConfigs: cfg.ExtraConfigs,
	}

	// First we encrypt the secure settings.
	// This is done to ensure that any secure settings incorrectly stored in Settings are encrypted and moved to
	// SecureSettings. This can happen if an integration definition is updated to make a field secure.
	if err := EncryptReceiverConfigSettings(cfg.AlertmanagerConfig.Receivers, func(ctx context.Context, payload []byte) ([]byte, error) {
		return moa.Crypto.Encrypt(ctx, payload, secrets.WithoutScope())
	}); err != nil {
		return definitions.GettableUserConfig{}, fmt.Errorf("failed to encrypt receivers: %w", err)
	}

	for _, recv := range cfg.AlertmanagerConfig.Receivers {
		receivers := make([]*definitions.GettableGrafanaReceiver, 0, len(recv.GrafanaManagedReceivers))
		for _, pr := range recv.GrafanaManagedReceivers {
			secureFields := make(map[string]bool, len(pr.SecureSettings))
			for k := range pr.SecureSettings {
				decryptedValue, err := moa.Crypto.getDecryptedSecret(pr, k)
				if err != nil {
					return definitions.GettableUserConfig{}, fmt.Errorf("failed to decrypt stored secure setting: %w", err)
				}
				if decryptedValue == "" {
					continue
				}
				secureFields[k] = true
			}
			gr := definitions.GettableGrafanaReceiver{
				UID:                   pr.UID,
				Name:                  pr.Name,
				Type:                  pr.Type,
				DisableResolveMessage: pr.DisableResolveMessage,
				Settings:              pr.Settings,
				SecureFields:          secureFields,
			}
			receivers = append(receivers, &gr)
		}
		gettableApiReceiver := definitions.GettableApiReceiver{
			GettableGrafanaReceivers: definitions.GettableGrafanaReceivers{
				GrafanaManagedReceivers: receivers,
			},
		}
		gettableApiReceiver.Name = recv.Name
		result.AlertmanagerConfig.Receivers = append(result.AlertmanagerConfig.Receivers, &gettableApiReceiver)
	}

	result, err = moa.mergeProvenance(ctx, result, orgID)
	if err != nil {
		return definitions.GettableUserConfig{}, err
	}

	return result, nil
}

func (moa *MultiOrgAlertmanager) SaveAndApplyAlertmanagerConfiguration(ctx context.Context, org int64, config definitions.PostableUserConfig) error {
	// We cannot add this validation to PostableUserConfig as that struct is used for both
	// Grafana Alertmanager (where inhibition rules are not supported) and External Alertmanagers
	// (including Mimir) where inhibition rules are supported.
	if len(config.AlertmanagerConfig.InhibitRules) > 0 {
		return errors.New("inhibition rules are not supported")
	}

	// Get the last known working configuration
	previousConfig, err := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, org)
	if err != nil {
		// If we don't have a configuration there's nothing for us to know and we should just continue saving the new one
		if !errors.Is(err, store.ErrNoAlertmanagerConfiguration) {
			return fmt.Errorf("failed to get latest configuration %w", err)
		}
	}
	cleanPermissionsErr := err

	if err := moa.Crypto.ProcessSecureSettings(ctx, org, config.AlertmanagerConfig.Receivers); err != nil {
		return fmt.Errorf("failed to post process Alertmanager configuration: %w", err)
	}

	if err := assignReceiverConfigsUIDs(config.AlertmanagerConfig.Receivers); err != nil {
		return fmt.Errorf("failed to assign missing uids: %w", err)
	}

	am, err := moa.AlertmanagerFor(org)
	if err != nil {
		// It's okay if the alertmanager isn't ready yet, we're changing its config anyway.
		if !errors.Is(err, ErrAlertmanagerNotReady) {
			return err
		}
	}

	if err := am.SaveAndApplyConfig(ctx, &config); err != nil {
		moa.logger.Error("Unable to save and apply alertmanager configuration", "error", err)
		errReceiverDoesNotExist := ErrorReceiverDoesNotExist{}
		if errors.As(err, &errReceiverDoesNotExist) {
			return ErrAlertmanagerReceiverInUse.Build(errutil.TemplateData{Public: map[string]interface{}{"Receiver": errReceiverDoesNotExist.Reference}, Error: err})
		}
		errTimeIntervalDoesNotExist := ErrorTimeIntervalDoesNotExist{}
		if errors.As(err, &errTimeIntervalDoesNotExist) {
			return ErrAlertmanagerTimeIntervalInUse.Build(errutil.TemplateData{Public: map[string]interface{}{"Interval": errTimeIntervalDoesNotExist.Reference}, Error: err})
		}
		return AlertmanagerConfigRejectedError{err}
	}

	// Attempt to cleanup permissions for receivers that are no longer defined and add defaults for new receivers.
	// Failure should not prevent the default config from being applied.
	if cleanPermissionsErr == nil {
		cleanPermissionsErr = func() error {
			newReceiverNames := make(sets.Set[string], len(config.AlertmanagerConfig.Receivers))
			for _, r := range config.AlertmanagerConfig.Receivers {
				newReceiverNames.Insert(r.Name)
			}
			return moa.cleanPermissions(ctx, org, previousConfig, newReceiverNames)
		}()
	}
	if cleanPermissionsErr != nil {
		moa.logger.Error("Failed to clean permissions for receivers", "error", cleanPermissionsErr)
	}

	return nil
}

// modifyAndApplyExtraConfiguration is a helper function that loads the current configuration,
// applies a modification function to the ExtraConfigs, and saves the result.
func (moa *MultiOrgAlertmanager) modifyAndApplyExtraConfiguration(
	ctx context.Context,
	org int64,
	modifyFn func([]definitions.ExtraConfiguration) ([]definitions.ExtraConfiguration, error),
) error {
	currentCfg, err := moa.configStore.GetLatestAlertmanagerConfiguration(ctx, org)
	if err != nil {
		return fmt.Errorf("failed to get current configuration: %w", err)
	}

	cfg, err := Load([]byte(currentCfg.AlertmanagerConfiguration))
	if err != nil {
		return fmt.Errorf("failed to unmarshal current alertmanager configuration: %w", err)
	}

	cfg.ExtraConfigs, err = modifyFn(cfg.ExtraConfigs)
	if err != nil {
		return fmt.Errorf("failed to apply extra configuration: %w", err)
	}

	am, err := moa.AlertmanagerFor(org)
	if err != nil {
		// It's okay if the alertmanager isn't ready yet, we're changing its config anyway.
		if !errors.Is(err, ErrAlertmanagerNotReady) {
			return err
		}
	}

	if err := am.SaveAndApplyConfig(ctx, cfg); err != nil {
		moa.logger.Error("Unable to save and apply alertmanager configuration with extra config", "error", err, "org", org)
		return AlertmanagerConfigRejectedError{err}
	}

	moa.logger.Info("Applied alertmanager configuration with extra config", "org", org)
	return nil
}

// SaveAndApplyExtraConfiguration adds or replaces an ExtraConfiguration while preserving the main AlertmanagerConfig.
func (moa *MultiOrgAlertmanager) SaveAndApplyExtraConfiguration(ctx context.Context, org int64, extraConfig definitions.ExtraConfiguration) error {
	modifyFunc := func(configs []definitions.ExtraConfiguration) ([]definitions.ExtraConfiguration, error) {
		// for now we validate that after the update there will be just one extra config.
		for _, c := range configs {
			if c.Identifier != extraConfig.Identifier {
				return nil, ErrAlertmanagerMultipleExtraConfigsUnsupported.Build(errutil.TemplateData{Public: map[string]interface{}{"Identifier": c.Identifier}})
			}
		}

		return []definitions.ExtraConfiguration{extraConfig}, nil
	}

	err := moa.modifyAndApplyExtraConfiguration(ctx, org, modifyFunc)
	if err != nil {
		return err
	}

	moa.logger.Info("Applied alertmanager configuration with extra config", "org", org, "identifier", extraConfig.Identifier)
	return nil
}

// DeleteExtraConfiguration deletes an ExtraConfiguration by its identifier while preserving the main AlertmanagerConfig.
func (moa *MultiOrgAlertmanager) DeleteExtraConfiguration(ctx context.Context, org int64, identifier string) error {
	modifyFunc := func(configs []definitions.ExtraConfiguration) ([]definitions.ExtraConfiguration, error) {
		filtered := make([]definitions.ExtraConfiguration, 0, len(configs))
		for _, ec := range configs {
			if ec.Identifier != identifier {
				filtered = append(filtered, ec)
			}
		}
		return filtered, nil
	}

	return moa.modifyAndApplyExtraConfiguration(ctx, org, modifyFunc)
}

// assignReceiverConfigsUIDs assigns missing UUIDs to receiver configs.
func assignReceiverConfigsUIDs(c []*definitions.PostableApiReceiver) error {
	seenUIDs := make(map[string]struct{})
	// encrypt secure settings for storing them in DB
	for _, r := range c {
		switch r.Type() {
		case definitions.GrafanaReceiverType:
			for _, gr := range r.GrafanaManagedReceivers {
				if gr.UID == "" {
					retries := 5
					for i := 0; i < retries; i++ {
						gen := util.GenerateShortUID()
						_, ok := seenUIDs[gen]
						if !ok {
							gr.UID = gen
							break
						}
					}
					if gr.UID == "" {
						return fmt.Errorf("all %d attempts to generate UID for receiver have failed; please retry", retries)
					}
				}
				seenUIDs[gr.UID] = struct{}{}
			}
		default:
		}
	}
	return nil
}

type provisioningStore interface {
	GetProvenance(ctx context.Context, o models.Provisionable, org int64) (models.Provenance, error)
	GetProvenances(ctx context.Context, org int64, resourceType string) (map[string]models.Provenance, error)
	SetProvenance(ctx context.Context, o models.Provisionable, org int64, p models.Provenance) error
	DeleteProvenance(ctx context.Context, o models.Provisionable, org int64) error
}

func (moa *MultiOrgAlertmanager) mergeProvenance(ctx context.Context, config definitions.GettableUserConfig, org int64) (definitions.GettableUserConfig, error) {
	if config.AlertmanagerConfig.Route != nil {
		provenance, err := moa.ProvStore.GetProvenance(ctx, config.AlertmanagerConfig.Route, org)
		if err != nil {
			return definitions.GettableUserConfig{}, err
		}
		config.AlertmanagerConfig.Route.Provenance = definitions.Provenance(provenance)
	}

	cp := definitions.EmbeddedContactPoint{}
	cpProvs, err := moa.ProvStore.GetProvenances(ctx, org, cp.ResourceType())
	if err != nil {
		return definitions.GettableUserConfig{}, err
	}
	for _, receiver := range config.AlertmanagerConfig.Receivers {
		for _, contactPoint := range receiver.GrafanaManagedReceivers {
			if provenance, exists := cpProvs[contactPoint.UID]; exists {
				contactPoint.Provenance = definitions.Provenance(provenance)
			}
		}
	}

	tmpl := definitions.NotificationTemplate{}
	tmplProvs, err := moa.ProvStore.GetProvenances(ctx, org, tmpl.ResourceType())
	if err != nil {
		return definitions.GettableUserConfig{}, nil
	}
	config.TemplateFileProvenances = make(map[string]definitions.Provenance, len(tmplProvs))
	for key, provenance := range tmplProvs {
		config.TemplateFileProvenances[key] = definitions.Provenance(provenance)
	}

	mt := definitions.MuteTimeInterval{}
	mtProvs, err := moa.ProvStore.GetProvenances(ctx, org, mt.ResourceType())
	if err != nil {
		return definitions.GettableUserConfig{}, nil
	}
	config.AlertmanagerConfig.MuteTimeProvenances = make(map[string]definitions.Provenance, len(mtProvs))
	for key, provenance := range mtProvs {
		config.AlertmanagerConfig.MuteTimeProvenances[key] = definitions.Provenance(provenance)
	}

	return config, nil
}

// cleanPermissions will remove permissions for receivers that are no longer defined in the new configuration and
// set default permissions for new receivers.
func (moa *MultiOrgAlertmanager) cleanPermissions(ctx context.Context, orgID int64, previousConfig *models.AlertConfiguration, newReceiverNames sets.Set[string]) error {
	previousReceiverNames, err := extractReceiverNames(previousConfig.AlertmanagerConfiguration)
	if err != nil {
		return fmt.Errorf("failed to extract receiver names from previous configuration: %w", err)
	}

	var errs []error
	for receiverName := range previousReceiverNames.Difference(newReceiverNames) { // Deleted receivers.
		if err := moa.receiverResourcePermissions.DeleteResourcePermissions(ctx, orgID, legacy_storage.NameToUid(receiverName)); err != nil {
			errs = append(errs, fmt.Errorf("failed to delete permissions for receiver %s: %w", receiverName, err))
		}
	}

	for receiverName := range newReceiverNames.Difference(previousReceiverNames) { // Added receivers.
		moa.receiverResourcePermissions.SetDefaultPermissions(ctx, orgID, nil, legacy_storage.NameToUid(receiverName))
	}

	return errors.Join(errs...)
}

// extractReceiverNames extracts receiver names from the raw Alertmanager configuration. Unmarshalling ignores fields
// unrelated to receiver names, making it more resilient to invalid configurations.
func extractReceiverNames(rawConfig string) (sets.Set[string], error) {
	// Slimmed down version of the Alertmanager configuration to extract receiver names. This is more resilient to
	// invalid configurations when all we are interested in is the receiver names.
	type receiverUserConfig struct {
		AlertmanagerConfig struct {
			Receivers []struct {
				Name string `yaml:"name" json:"name"`
			} `yaml:"receivers,omitempty" json:"receivers,omitempty"`
		} `yaml:"alertmanager_config" json:"alertmanager_config"`
	}

	cfg := &receiverUserConfig{}
	if err := json.Unmarshal([]byte(rawConfig), cfg); err != nil {
		return nil, fmt.Errorf("unable to parse Alertmanager configuration: %w", err)
	}

	receiverNames := make(sets.Set[string], len(cfg.AlertmanagerConfig.Receivers))
	for _, r := range cfg.AlertmanagerConfig.Receivers {
		receiverNames[r.Name] = struct{}{}
	}

	return receiverNames, nil
}
