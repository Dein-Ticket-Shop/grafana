package provisioning

import (
	"context"
	"fmt"

	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/services/featuremgmt"
	"github.com/grafana/grafana/pkg/services/ngalert/api/tooling/definitions"
	"github.com/grafana/grafana/pkg/services/ngalert/models"
	"github.com/grafana/grafana/pkg/services/ngalert/notifier/legacy_storage"
	"github.com/grafana/grafana/pkg/services/ngalert/provisioning/validation"
	"github.com/grafana/grafana/pkg/setting"
)

type NotificationPolicyService struct {
	configStore     alertmanagerConfigStore
	provenanceStore ProvisioningStore
	xact            TransactionManager
	log             log.Logger
	settings        setting.UnifiedAlertingSettings
	validator       validation.ProvenanceStatusTransitionValidator
	FeatureToggles  featuremgmt.FeatureToggles
}

func NewNotificationPolicyService(
	am alertmanagerConfigStore,
	prov ProvisioningStore,
	xact TransactionManager,
	settings setting.UnifiedAlertingSettings,
	features featuremgmt.FeatureToggles,
	log log.Logger,
) *NotificationPolicyService {
	return &NotificationPolicyService{
		configStore:     am,
		provenanceStore: prov,
		xact:            xact,
		log:             log,
		settings:        settings,
		FeatureToggles:  features,
		validator:       validation.ValidateProvenanceRelaxed,
	}
}

func (nps *NotificationPolicyService) GetManagedRoute(ctx context.Context, orgID int64, name string) (legacy_storage.ManagedRoute, error) {
	// TODO: Keep this?
	if name == "" {
		name = legacy_storage.UserDefinedRoutingTreeName
	}

	rev, err := nps.configStore.Get(ctx, orgID)
	if err != nil {
		return legacy_storage.ManagedRoute{}, err
	}

	route := rev.GetManagedRoute(name)
	if route == nil {
		return legacy_storage.ManagedRoute{}, ErrRouteNotFound.Errorf("route %q not found", name)
	}

	provenance, err := nps.provenanceStore.GetProvenance(ctx, route, orgID)
	if err != nil {
		return legacy_storage.ManagedRoute{}, err
	}
	route.Provenance = provenance

	return *route, nil
}

func (nps *NotificationPolicyService) GetManagedRoutes(ctx context.Context, orgID int64) (legacy_storage.ManagedRoutes, error) {
	rev, err := nps.configStore.Get(ctx, orgID)
	if err != nil {
		return nil, err
	}

	provenances, err := nps.provenanceStore.GetProvenances(ctx, orgID, (&legacy_storage.ManagedRoute{}).ResourceType())
	if err != nil {
		return nil, err
	}

	managedRoutes := rev.GetManagedRoutes()
	for _, mr := range managedRoutes {
		provenance, ok := provenances[mr.ResourceID()]
		if !ok {
			provenance = models.ProvenanceNone
		}
		mr.Provenance = provenance
	}
	managedRoutes.Sort()
	return managedRoutes, nil
}

func (nps *NotificationPolicyService) DeleteManagedRoute(ctx context.Context, orgID int64, name string, p models.Provenance, version string) error {
	// TODO: Keep this?
	if name == "" {
		name = legacy_storage.UserDefinedRoutingTreeName
	}

	revision, err := nps.configStore.Get(ctx, orgID)
	if err != nil {
		return err
	}

	existing := revision.GetManagedRoute(name)
	if existing == nil {
		return ErrRouteNotFound.Errorf("")
	}

	err = nps.checkOptimisticConcurrency(existing, p, version, "delete")
	if err != nil {
		return err
	}

	storedProvenance, err := nps.provenanceStore.GetProvenance(ctx, existing, orgID)
	if err != nil {
		return err
	}
	if err := nps.validator(storedProvenance, p); err != nil {
		return err
	}

	if name == legacy_storage.UserDefinedRoutingTreeName {
		defaultCfg, err := legacy_storage.DeserializeAlertmanagerConfig([]byte(nps.settings.DefaultConfiguration))
		if err != nil {
			nps.log.Error("Failed to parse default alertmanager config: %w", err)
			return fmt.Errorf("failed to parse default alertmanager config: %w", err)
		}

		_, err = revision.UpdateNamedRoute(legacy_storage.UserDefinedRoutingTreeName, *defaultCfg.AlertmanagerConfig.Route)
		if err != nil {
			return err
		}
	} else {
		revision.DeleteManagedRoute(name)
	}

	_, err = revision.Config.GetMergedAlertmanagerConfig()
	if err != nil {
		return fmt.Errorf("new routing tree is not compatible with extra configuration: %w", err)
	}

	return nps.xact.InTransaction(ctx, func(ctx context.Context) error {
		if err := nps.configStore.Save(ctx, revision, orgID); err != nil {
			return err
		}
		return nps.provenanceStore.DeleteProvenance(ctx, existing, orgID)
	})
}

func (nps *NotificationPolicyService) CreateManagedRoute(ctx context.Context, orgID int64, name string, subtree definitions.Route, p models.Provenance) (*legacy_storage.ManagedRoute, error) {
	err := subtree.Validate()
	if err != nil {
		return nil, MakeErrRouteInvalidFormat(err)
	}

	revision, err := nps.configStore.Get(ctx, orgID)
	if err != nil {
		return nil, err
	}

	created, err := revision.CreateManagedRoute(name, subtree)
	if err != nil {
		return nil, err
	}

	_, err = revision.Config.GetMergedAlertmanagerConfig()
	if err != nil {
		return nil, fmt.Errorf("new routing tree is not compatible with extra configuration: %w", err)
	}

	err = nps.xact.InTransaction(ctx, func(ctx context.Context) error {
		if err := nps.configStore.Save(ctx, revision, orgID); err != nil {
			return err
		}
		return nps.provenanceStore.SetProvenance(ctx, created, orgID, p)
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

func (nps *NotificationPolicyService) UpdateManagedRoute(ctx context.Context, orgID int64, name string, subtree definitions.Route, p models.Provenance, version string) (*legacy_storage.ManagedRoute, error) {
	// TODO: Keep this?
	if name == "" {
		name = legacy_storage.UserDefinedRoutingTreeName
	}

	err := subtree.Validate()
	if err != nil {
		return nil, MakeErrRouteInvalidFormat(err)
	}

	revision, err := nps.configStore.Get(ctx, orgID)
	if err != nil {
		return nil, err
	}

	existing := revision.GetManagedRoute(name)
	if existing == nil {
		return nil, fmt.Errorf("failed to get existing named route %q: %w", name, err)
	}

	err = nps.checkOptimisticConcurrency(existing, p, version, "update")
	if err != nil {
		return nil, err
	}

	// check that provenance is not changed in an invalid way
	storedProvenance, err := nps.provenanceStore.GetProvenance(ctx, existing, orgID)
	if err != nil {
		return nil, err
	}
	if err := nps.validator(storedProvenance, p); err != nil {
		return nil, err
	}

	updated, err := revision.UpdateNamedRoute(name, subtree)
	if err != nil {
		return nil, err
	}
	updated.Provenance = storedProvenance

	_, err = revision.Config.GetMergedAlertmanagerConfig()
	if err != nil {
		return nil, fmt.Errorf("new routing tree is not compatible with extra configuration: %w", err)
	}

	err = nps.xact.InTransaction(ctx, func(ctx context.Context) error {
		if err := nps.configStore.Save(ctx, revision, orgID); err != nil {
			return err
		}
		return nps.provenanceStore.SetProvenance(ctx, updated, orgID, p)
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// TODO: Remove this method once the all callers support named routes.
func (nps *NotificationPolicyService) GetPolicyTree(ctx context.Context, orgID int64) (definitions.Route, string, error) {
	r, err := nps.GetManagedRoute(ctx, orgID, legacy_storage.UserDefinedRoutingTreeName)
	if err != nil {
		return definitions.Route{}, "", err
	}
	return r.AsAMRoute(), r.Version, nil
}

// TODO: Remove this method once the all callers support named routes.
func (nps *NotificationPolicyService) UpdatePolicyTree(ctx context.Context, orgID int64, tree definitions.Route, p models.Provenance, version string) (definitions.Route, string, error) {
	r, err := nps.UpdateManagedRoute(ctx, orgID, legacy_storage.UserDefinedRoutingTreeName, tree, p, version)
	if err != nil {
		return definitions.Route{}, "", err
	}
	return r.AsAMRoute(), r.Version, nil
}

// TODO: Remove this method once the all callers support named routes.
func (nps *NotificationPolicyService) ResetPolicyTree(ctx context.Context, orgID int64, provenance models.Provenance) (definitions.Route, error) {
	err := nps.DeleteManagedRoute(ctx, orgID, legacy_storage.UserDefinedRoutingTreeName, provenance, "")
	if err != nil {
		return definitions.Route{}, err
	}
	// If the tree was not found, we can just return the default route.
	defaultCfg, err := legacy_storage.DeserializeAlertmanagerConfig([]byte(nps.settings.DefaultConfiguration))
	if err != nil {
		nps.log.Error("Failed to parse default alertmanager config: %w", err)
		return definitions.Route{}, fmt.Errorf("failed to parse default alertmanager config: %w", err)
	}
	route := defaultCfg.AlertmanagerConfig.Route

	return *route, nil
}

func (nps *NotificationPolicyService) checkOptimisticConcurrency(current *legacy_storage.ManagedRoute, provenance models.Provenance, desiredVersion string, action string) error {
	if desiredVersion == "" {
		if provenance != models.ProvenanceFile {
			// if version is not specified and it's not a file provisioning, emit a log message to reflect that optimistic concurrency is disabled for this request
			nps.log.Debug("ignoring optimistic concurrency check because version was not provided", "operation", action)
		}
		return nil
	}
	if current.Version != desiredVersion {
		return ErrVersionConflict.Errorf("provided version %s of routing tree does not match current version %s", desiredVersion, current.Version)
	}
	return nil
}
