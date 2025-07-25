import { useMemo } from 'react';

import { contextSrv as ctx } from 'app/core/services/context_srv';
import { PERMISSIONS_CONTACT_POINTS_READ } from 'app/features/alerting/unified/components/contact-points/permissions';
import {
  PERMISSIONS_TIME_INTERVALS_MODIFY,
  PERMISSIONS_TIME_INTERVALS_READ,
} from 'app/features/alerting/unified/components/mute-timings/permissions';
import {
  PERMISSIONS_NOTIFICATION_POLICIES_MODIFY,
  PERMISSIONS_NOTIFICATION_POLICIES_READ,
} from 'app/features/alerting/unified/components/notification-policies/permissions';
import { useFolder } from 'app/features/alerting/unified/hooks/useFolder';
import { AlertmanagerChoice } from 'app/plugins/datasource/alertmanager/types';
import { AccessControlAction } from 'app/types/accessControl';
import { CombinedRule, RuleGroupIdentifierV2 } from 'app/types/unified-alerting';
import { GrafanaPromRuleDTO, RulerRuleDTO } from 'app/types/unified-alerting-dto';

import { alertmanagerApi } from '../api/alertmanagerApi';
import { useAlertmanager } from '../state/AlertmanagerContext';
import { getInstancesPermissions, getNotificationsPermissions, getRulesPermissions } from '../utils/access-control';
import { getGroupOriginName, groupIdentifier } from '../utils/groupIdentifier';
import { isAdmin } from '../utils/misc';
import {
  isPluginProvidedRule,
  isProvisionedPromRule,
  isProvisionedRule,
  prometheusRuleType,
  rulerRuleType,
} from '../utils/rules';

import { useIsRuleEditable } from './useIsRuleEditable';

/**
 * These hooks will determine if
 *  1. the action is supported in the current context (alertmanager, alert rule or general context)
 *  2. user is allowed to perform actions based on their set of permissions / assigned role
 */

// this enum lists all of the available actions we can perform within the context of an alertmanager
export enum AlertmanagerAction {
  // configuration
  ViewExternalConfiguration = 'view-external-configuration',
  UpdateExternalConfiguration = 'update-external-configuration',

  // contact points
  CreateContactPoint = 'create-contact-point',
  ViewContactPoint = 'view-contact-point',
  UpdateContactPoint = 'edit-contact-points',
  DeleteContactPoint = 'delete-contact-point',
  ExportContactPoint = 'export-contact-point',

  // notification templates
  CreateNotificationTemplate = 'create-notification-template',
  ViewNotificationTemplate = 'view-notification-template',
  UpdateNotificationTemplate = 'edit-notification-template',
  DeleteNotificationTemplate = 'delete-notification-template',
  DecryptSecrets = 'decrypt-secrets',

  // notification policies
  CreateNotificationPolicy = 'create-notification-policy',
  ViewNotificationPolicyTree = 'view-notification-policy-tree',
  UpdateNotificationPolicyTree = 'update-notification-policy-tree',
  DeleteNotificationPolicy = 'delete-notification-policy',
  ExportNotificationPolicies = 'export-notification-policies',
  ViewAutogeneratedPolicyTree = 'view-autogenerated-policy-tree',

  // silences – these cannot be deleted only "expired" (updated)
  CreateSilence = 'create-silence',
  ViewSilence = 'view-silence',
  UpdateSilence = 'update-silence',
  PreviewSilencedInstances = 'preview-silenced-alerts',

  // time intervals
  ViewTimeInterval = 'view-time-interval',
  CreateTimeInterval = 'create-time-interval',
  UpdateTimeInterval = 'update-time-interval',
  DeleteTimeInterval = 'delete-time-interval',
  ExportTimeIntervals = 'export-time-intervals',

  // Alert groups
  ViewAlertGroups = 'view-alert-groups',
}

// this enum lists all of the available actions we can take on a single alert rule
export enum AlertRuleAction {
  Duplicate = 'duplicate-alert-rule',
  View = 'view-alert-rule',
  Update = 'update-alert-rule',
  Delete = 'delete-alert-rule',
  Explore = 'explore-alert-rule',
  Silence = 'silence-alert-rule',
  ModifyExport = 'modify-export-rule',
  Pause = 'pause-alert-rule',
  Restore = 'restore-alert-rule',
  DeletePermanently = 'delete-alert-rule-permanently',
}

// this enum list all of the bulk actions we can perform on a folder
export enum FolderBulkAction {
  Pause = 'pause-folder', // unpause permissions are the same as pause
  Delete = 'delete-folder',
}

// this enum lists all of the actions we can perform within alerting in general, not linked to a specific
// alert source, rule or alertmanager
export enum AlertingAction {
  // internal (Grafana managed)
  CreateAlertRule = 'create-alert-rule',
  ViewAlertRule = 'view-alert-rule',
  UpdateAlertRule = 'update-alert-rule',
  DeleteAlertRule = 'delete-alert-rule',
  ExportGrafanaManagedRules = 'export-grafana-managed-rules',
  ReadConfigurationStatus = 'read-configuration-status',

  // external (any compatible alerting data source)
  CreateExternalAlertRule = 'create-external-alert-rule',
  ViewExternalAlertRule = 'view-external-alert-rule',
  UpdateExternalAlertRule = 'update-external-alert-rule',
  DeleteExternalAlertRule = 'delete-external-alert-rule',
}

// these just makes it easier to read the code :)
const AlwaysSupported = true;
const NotSupported = false;

export type Action = AlertmanagerAction | AlertingAction | AlertRuleAction | FolderBulkAction;
export type Ability = [actionSupported: boolean, actionAllowed: boolean];
export type Abilities<T extends Action> = Record<T, Ability>;

/**
 * This one will check for folder abilities
 */
export const useFolderBulkActionAbilities = (): Abilities<FolderBulkAction> => {
  return {
    [FolderBulkAction.Pause]: [AlwaysSupported, isAdmin()],
    [FolderBulkAction.Delete]: [AlwaysSupported, isAdmin()],
  };
};

export const useFolderBulkActionAbility = (action: FolderBulkAction): Ability => {
  const allAbilities = useFolderBulkActionAbilities();
  return allAbilities[action];
};

/**
 * This one will check for alerting abilities that don't apply to any particular alert source or alert rule
 */
export const useAlertingAbilities = (): Abilities<AlertingAction> => {
  return {
    // internal (Grafana managed)
    [AlertingAction.CreateAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleCreate),
    [AlertingAction.ViewAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleRead),
    [AlertingAction.UpdateAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleUpdate),
    [AlertingAction.DeleteAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleDelete),
    [AlertingAction.ExportGrafanaManagedRules]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleRead),
    [AlertingAction.ReadConfigurationStatus]: [
      AlwaysSupported,
      ctx.hasPermission(AccessControlAction.AlertingInstanceRead) ||
        ctx.hasPermission(AccessControlAction.AlertingNotificationsRead),
    ],

    // external
    [AlertingAction.CreateExternalAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleExternalWrite),
    [AlertingAction.ViewExternalAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleExternalRead),
    [AlertingAction.UpdateExternalAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleExternalWrite),
    [AlertingAction.DeleteExternalAlertRule]: toAbility(AlwaysSupported, AccessControlAction.AlertingRuleExternalWrite),
  };
};

export const useAlertingAbility = (action: AlertingAction): Ability => {
  const allAbilities = useAlertingAbilities();
  return allAbilities[action];
};

/**
 * This hook will check if we support the action and have sufficient permissions for it on a single alert rule
 */
export function useAlertRuleAbility(rule: CombinedRule, action: AlertRuleAction): Ability {
  const abilities = useAllAlertRuleAbilities(rule);

  return useMemo(() => {
    return abilities[action];
  }, [abilities, action]);
}

export function useAlertRuleAbilities(rule: CombinedRule, actions: AlertRuleAction[]): Ability[] {
  const abilities = useAllAlertRuleAbilities(rule);

  return useMemo(() => {
    return actions.map((action) => abilities[action]);
  }, [abilities, actions]);
}

export function useRulerRuleAbility(
  rule: RulerRuleDTO | undefined,
  groupIdentifier: RuleGroupIdentifierV2,
  action: AlertRuleAction
): Ability {
  const abilities = useAllRulerRuleAbilities(rule, groupIdentifier);

  return useMemo(() => {
    return abilities[action];
  }, [abilities, action]);
}

export function useRulerRuleAbilities(
  rule: RulerRuleDTO | undefined,
  groupIdentifier: RuleGroupIdentifierV2,
  actions: AlertRuleAction[]
): Ability[] {
  const abilities = useAllRulerRuleAbilities(rule, groupIdentifier);

  return useMemo(() => {
    return actions.map((action) => abilities[action]);
  }, [abilities, actions]);
}

/**
 * @deprecated Use {@link useAllRulerRuleAbilities} instead
 */
export function useAllAlertRuleAbilities(rule: CombinedRule): Abilities<AlertRuleAction> {
  // This hook is being called a lot in different places
  // In some cases multiple times for ~80 rules (e.g. on the list page)
  // We need to investigate further if some of these calls are redundant
  // In the meantime, memoizing the result helps
  const groupIdentifierV2 = useMemo(() => groupIdentifier.fromCombinedRule(rule), [rule]);
  return useAllRulerRuleAbilities(rule.rulerRule, groupIdentifierV2);
}

export function useAllRulerRuleAbilities(
  rule: RulerRuleDTO | undefined,
  groupIdentifier: RuleGroupIdentifierV2
): Abilities<AlertRuleAction> {
  const rulesSourceName = getGroupOriginName(groupIdentifier);

  const { isEditable, isRemovable, isRulerAvailable = false, loading } = useIsRuleEditable(rulesSourceName, rule);
  const [_, exportAllowed] = useAlertingAbility(AlertingAction.ExportGrafanaManagedRules);
  const canSilence = useCanSilence(rule);

  const abilities = useMemo<Abilities<AlertRuleAction>>(() => {
    const isProvisioned = rule ? isProvisionedRule(rule) : false;
    // TODO: Add support for federated rules
    // const isFederated = isFederatedRuleGroup();
    const isFederated = false;
    const isGrafanaManagedAlertRule = rulerRuleType.grafana.rule(rule);
    const isPluginProvided = isPluginProvidedRule(rule);

    // if a rule is either provisioned, federated or provided by a plugin rule, we don't allow it to be removed or edited
    const immutableRule = isProvisioned || isFederated || isPluginProvided;

    // while we gather info, pretend it's not supported
    const MaybeSupported = loading ? NotSupported : isRulerAvailable;
    const MaybeSupportedUnlessImmutable = immutableRule ? NotSupported : MaybeSupported;

    // Creating duplicates of plugin-provided rules does not seem to make a lot of sense
    const duplicateSupported = isPluginProvided ? NotSupported : MaybeSupported;

    const rulesPermissions = getRulesPermissions(rulesSourceName);

    const abilities: Abilities<AlertRuleAction> = {
      [AlertRuleAction.Duplicate]: toAbility(duplicateSupported, rulesPermissions.create),
      [AlertRuleAction.View]: toAbility(AlwaysSupported, rulesPermissions.read),
      [AlertRuleAction.Update]: [MaybeSupportedUnlessImmutable, isEditable ?? false],
      [AlertRuleAction.Delete]: [MaybeSupportedUnlessImmutable, isRemovable ?? false],
      [AlertRuleAction.Explore]: toAbility(AlwaysSupported, AccessControlAction.DataSourcesExplore),
      [AlertRuleAction.Silence]: canSilence,
      [AlertRuleAction.ModifyExport]: [isGrafanaManagedAlertRule, exportAllowed],
      [AlertRuleAction.Pause]: [MaybeSupportedUnlessImmutable && isGrafanaManagedAlertRule, isEditable ?? false],
      [AlertRuleAction.Restore]: [MaybeSupportedUnlessImmutable && isGrafanaManagedAlertRule, isEditable ?? false],
      [AlertRuleAction.DeletePermanently]: [
        MaybeSupportedUnlessImmutable && isGrafanaManagedAlertRule,
        (isRemovable && isAdmin()) ?? false,
      ],
    };

    return abilities;
  }, [rule, loading, isRulerAvailable, rulesSourceName, isEditable, isRemovable, canSilence, exportAllowed]);

  return abilities;
}

/**
 * Hook for checking abilities on Grafana Prometheus rules (GrafanaPromRuleDTO)
 * This is the next version of useAllRulerRuleAbilities designed to work with GrafanaPromRuleDTO
 */
export function useAllGrafanaPromRuleAbilities(rule: GrafanaPromRuleDTO | undefined): Abilities<AlertRuleAction> {
  // For GrafanaPromRuleDTO, we use useIsGrafanaPromRuleEditable instead
  const { isEditable, isRemovable, loading } = useIsGrafanaPromRuleEditable(rule); // duplicate
  const [_, exportAllowed] = useAlertingAbility(AlertingAction.ExportGrafanaManagedRules);

  const silenceSupported = useGrafanaRulesSilenceSupport();
  const canSilenceInFolder = useCanSilenceInFolder(rule?.folderUid);

  const abilities = useMemo<Abilities<AlertRuleAction>>(() => {
    const isProvisioned = rule ? isProvisionedPromRule(rule) : false;

    // Note: Grafana managed rules can't be federated - this is strictly a Mimir feature
    // See: https://grafana.com/docs/mimir/latest/references/architecture/components/ruler/#federated-rule-groups
    const isFederated = false;
    // All GrafanaPromRuleDTO rules are Grafana-managed by definition
    const isAlertingRule = prometheusRuleType.grafana.alertingRule(rule);
    const isPluginProvided = isPluginProvidedRule(rule);

    // if a rule is either provisioned, federated or provided by a plugin rule, we don't allow it to be removed or edited
    const immutableRule = isProvisioned || isFederated || isPluginProvided;

    // GrafanaPromRuleDTO rules are always supported (no loading state for ruler availability)
    const MaybeSupported = loading ? NotSupported : AlwaysSupported;
    const MaybeSupportedUnlessImmutable = immutableRule ? NotSupported : MaybeSupported;

    // Creating duplicates of plugin-provided rules does not seem to make a lot of sense
    const duplicateSupported = isPluginProvided ? NotSupported : MaybeSupported;

    const rulesPermissions = getRulesPermissions('grafana');

    const abilities: Abilities<AlertRuleAction> = {
      [AlertRuleAction.Duplicate]: toAbility(duplicateSupported, rulesPermissions.create),
      [AlertRuleAction.View]: toAbility(AlwaysSupported, rulesPermissions.read),
      [AlertRuleAction.Update]: [MaybeSupportedUnlessImmutable, isEditable ?? false],
      [AlertRuleAction.Delete]: [MaybeSupportedUnlessImmutable, isRemovable ?? false],
      [AlertRuleAction.Explore]: toAbility(AlwaysSupported, AccessControlAction.DataSourcesExplore),
      [AlertRuleAction.Silence]: [silenceSupported, canSilenceInFolder && isAlertingRule],
      [AlertRuleAction.ModifyExport]: [isAlertingRule, exportAllowed],
      [AlertRuleAction.Pause]: [MaybeSupportedUnlessImmutable && isAlertingRule, isEditable ?? false],
      [AlertRuleAction.Restore]: [MaybeSupportedUnlessImmutable && isAlertingRule, isEditable ?? false],
      [AlertRuleAction.DeletePermanently]: [
        MaybeSupportedUnlessImmutable && isAlertingRule,
        (isRemovable && isAdmin()) ?? false,
      ],
    };

    return abilities;
  }, [rule, loading, isEditable, isRemovable, canSilenceInFolder, exportAllowed, silenceSupported]);

  return abilities;
}

interface IsGrafanaPromRuleEditableResult {
  isEditable: boolean;
  isRemovable: boolean;
  loading: boolean;
}

/**
 * Hook for checking if a GrafanaPromRuleDTO is editable
 * Adapted version of useIsRuleEditable for GrafanaPromRuleDTO
 */
function useIsGrafanaPromRuleEditable(rule?: GrafanaPromRuleDTO): IsGrafanaPromRuleEditableResult {
  const folderUID = rule?.folderUid;
  const { folder, loading } = useFolder(folderUID);

  return useMemo(() => {
    if (!rule || !folderUID) {
      return { isEditable: false, isRemovable: false, loading: false };
    }

    if (!folder) {
      // Loading or invalid folder UID
      return {
        isEditable: false,
        isRemovable: false,
        loading,
      };
    }

    // For Grafana-managed rules, check folder permissions
    const rulesPermissions = getRulesPermissions('grafana');
    const canEditGrafanaRules = ctx.hasPermissionInMetadata(rulesPermissions.update, folder);
    const canRemoveGrafanaRules = ctx.hasPermissionInMetadata(rulesPermissions.delete, folder);

    return {
      isEditable: canEditGrafanaRules,
      isRemovable: canRemoveGrafanaRules,
      loading,
    };
  }, [rule, folderUID, folder, loading]);
}

export const skipToken = Symbol('ability-skip-token');
type SkipToken = typeof skipToken;

/**
 * Hook for checking a single ability on a GrafanaPromRuleDTO
 */
export function useGrafanaPromRuleAbility(rule: GrafanaPromRuleDTO | SkipToken, action: AlertRuleAction): Ability {
  const abilities = useAllGrafanaPromRuleAbilities(rule === skipToken ? undefined : rule);

  return useMemo(() => {
    return abilities[action];
  }, [abilities, action]);
}

/**
 * Hook for checking multiple abilities on a GrafanaPromRuleDTO
 */
export function useGrafanaPromRuleAbilities(
  rule: GrafanaPromRuleDTO | SkipToken,
  actions: AlertRuleAction[]
): Ability[] {
  const abilities = useAllGrafanaPromRuleAbilities(rule === skipToken ? undefined : rule);

  return useMemo(() => {
    return actions.map((action) => abilities[action]);
  }, [abilities, actions]);
}

export function useAllAlertmanagerAbilities(): Abilities<AlertmanagerAction> {
  const {
    selectedAlertmanager,
    hasConfigurationAPI,
    isGrafanaAlertmanager: isGrafanaFlavoredAlertmanager,
  } = useAlertmanager();

  // These are used for interacting with Alertmanager resources where we apply alert.notifications:<name> permissions.
  // There are different permissions based on wether the built-in alertmanager is selected (grafana) or an external one.
  const notificationsPermissions = getNotificationsPermissions(selectedAlertmanager!);
  const instancePermissions = getInstancesPermissions(selectedAlertmanager!);

  // list out all of the abilities, and if the user has permissions to perform them
  const abilities: Abilities<AlertmanagerAction> = {
    // -- configuration --
    [AlertmanagerAction.ViewExternalConfiguration]: toAbility(
      AlwaysSupported,
      AccessControlAction.AlertingNotificationsExternalRead
    ),
    [AlertmanagerAction.UpdateExternalConfiguration]: toAbility(
      hasConfigurationAPI,
      AccessControlAction.AlertingNotificationsExternalWrite
    ),
    // -- contact points --
    [AlertmanagerAction.CreateContactPoint]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.create,
      // TODO: Move this into the permissions config and generalise that code to allow for an array of permissions
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingReceiversCreate] : [])
    ),
    [AlertmanagerAction.ViewContactPoint]: toAbility(
      AlwaysSupported,
      notificationsPermissions.read,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_CONTACT_POINTS_READ : [])
    ),
    [AlertmanagerAction.UpdateContactPoint]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.update,
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingReceiversWrite] : [])
    ),
    [AlertmanagerAction.DeleteContactPoint]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.delete,
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingReceiversWrite] : [])
    ),
    // At the time of writing, only Grafana flavored alertmanager supports exporting,
    // and if a user can view the contact point, then they can also export it
    // So the only check we make is if the alertmanager is Grafana flavored
    [AlertmanagerAction.ExportContactPoint]: [isGrafanaFlavoredAlertmanager, isGrafanaFlavoredAlertmanager],
    // -- notification templates --
    [AlertmanagerAction.CreateNotificationTemplate]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.create,
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingTemplatesWrite] : [])
    ),
    [AlertmanagerAction.ViewNotificationTemplate]: toAbility(
      AlwaysSupported,
      notificationsPermissions.read,
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingTemplatesRead] : [])
    ),
    [AlertmanagerAction.UpdateNotificationTemplate]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.update,
      ...(isGrafanaFlavoredAlertmanager ? [AccessControlAction.AlertingTemplatesWrite] : [])
    ),
    [AlertmanagerAction.DeleteNotificationTemplate]: toAbility(hasConfigurationAPI, notificationsPermissions.delete),
    // -- notification policies --
    [AlertmanagerAction.CreateNotificationPolicy]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.create,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_NOTIFICATION_POLICIES_MODIFY : [])
    ),
    [AlertmanagerAction.ViewNotificationPolicyTree]: toAbility(
      AlwaysSupported,
      notificationsPermissions.read,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_NOTIFICATION_POLICIES_READ : [])
    ),
    [AlertmanagerAction.UpdateNotificationPolicyTree]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.update,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_NOTIFICATION_POLICIES_MODIFY : [])
    ),
    [AlertmanagerAction.DeleteNotificationPolicy]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.delete,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_NOTIFICATION_POLICIES_MODIFY : [])
    ),
    [AlertmanagerAction.ExportNotificationPolicies]: toAbility(
      isGrafanaFlavoredAlertmanager,
      notificationsPermissions.read
    ),
    [AlertmanagerAction.DecryptSecrets]: toAbility(
      isGrafanaFlavoredAlertmanager,
      notificationsPermissions.provisioning.readSecrets
    ),
    [AlertmanagerAction.ViewAutogeneratedPolicyTree]: [isGrafanaFlavoredAlertmanager, isAdmin()],
    // -- silences --
    // for now, all supported Alertmanager flavors have API endpoints for managing silences
    [AlertmanagerAction.CreateSilence]: toAbility(AlwaysSupported, instancePermissions.create),
    [AlertmanagerAction.ViewSilence]: toAbility(AlwaysSupported, instancePermissions.read),
    [AlertmanagerAction.UpdateSilence]: toAbility(AlwaysSupported, instancePermissions.update),
    [AlertmanagerAction.PreviewSilencedInstances]: toAbility(AlwaysSupported, instancePermissions.read),
    // -- time intervals --
    [AlertmanagerAction.CreateTimeInterval]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.create,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_TIME_INTERVALS_MODIFY : [])
    ),
    [AlertmanagerAction.ViewTimeInterval]: toAbility(
      AlwaysSupported,
      notificationsPermissions.read,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_TIME_INTERVALS_READ : [])
    ),
    [AlertmanagerAction.UpdateTimeInterval]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.update,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_TIME_INTERVALS_MODIFY : [])
    ),
    [AlertmanagerAction.DeleteTimeInterval]: toAbility(
      hasConfigurationAPI,
      notificationsPermissions.delete,
      ...(isGrafanaFlavoredAlertmanager ? PERMISSIONS_TIME_INTERVALS_MODIFY : [])
    ),
    [AlertmanagerAction.ExportTimeIntervals]: toAbility(isGrafanaFlavoredAlertmanager, notificationsPermissions.read),
    [AlertmanagerAction.ViewAlertGroups]: toAbility(AlwaysSupported, instancePermissions.read),
  };

  return abilities;
}

export function useAlertmanagerAbility(action: AlertmanagerAction): Ability {
  const abilities = useAllAlertmanagerAbilities();

  return useMemo(() => {
    return abilities[action];
  }, [abilities, action]);
}

export function useAlertmanagerAbilities(actions: AlertmanagerAction[]): Ability[] {
  const abilities = useAllAlertmanagerAbilities();

  return useMemo(() => {
    return actions.map((action) => abilities[action]);
  }, [abilities, actions]);
}

const { useGetGrafanaAlertingConfigurationStatusQuery } = alertmanagerApi;
/**
 * We don't want to show the silence button if either
 * 1. the user has no permissions to create silences
 * 2. the admin has configured to only send instances to external AMs
 */
function useCanSilence(rule?: RulerRuleDTO): [boolean, boolean] {
  const folderUID = rulerRuleType.grafana.rule(rule) ? rule.grafana_alert.namespace_uid : undefined;
  const { loading: folderIsLoading, folder } = useFolder(folderUID);

  const isGrafanaManagedRule = rule && rulerRuleType.grafana.rule(rule);
  const isGrafanaRecording = rulerRuleType.grafana.recordingRule(rule);

  const silenceSupported = useGrafanaRulesSilenceSupport();
  const canSilenceInFolder = useCanSilenceInFolder(folderUID);

  if (!rule) {
    return [false, false];
  }

  // we don't support silencing when the rule is not a Grafana managed alerting rule
  // we simply don't know what Alertmanager the ruler is sending alerts to
  if (!isGrafanaManagedRule || isGrafanaRecording || folderIsLoading || !folder) {
    return [false, false];
  }

  return [silenceSupported, canSilenceInFolder];
}

function useCanSilenceInFolder(folderUID?: string) {
  const folderPermissions = useFolderPermissions(folderUID);

  const hasFolderSilencePermission = folderPermissions[AccessControlAction.AlertingSilenceCreate] ?? false;
  const hasGlobalSilencePermission = ctx.hasPermission(AccessControlAction.AlertingInstanceCreate);

  // User is permitted to silence if they either have the "global" permissions of "AlertingInstanceCreate",
  // or the folder specific access control of "AlertingSilenceCreate"
  const allowedToSilence = hasGlobalSilencePermission || hasFolderSilencePermission;
  return allowedToSilence;
}

function useGrafanaRulesSilenceSupport() {
  const { currentData: amConfigStatus, isLoading } = useGetGrafanaAlertingConfigurationStatusQuery(undefined);

  const interactsOnlyWithExternalAMs = amConfigStatus?.alertmanagersChoice === AlertmanagerChoice.External;
  const interactsWithAll = amConfigStatus?.alertmanagersChoice === AlertmanagerChoice.All;
  const silenceSupported = !interactsOnlyWithExternalAMs || interactsWithAll;

  return isLoading ? false : silenceSupported;
}

function useFolderPermissions(folderUID?: string): Record<string, boolean> {
  const { folder } = useFolder(folderUID);
  return folder?.accessControl ?? {};
}

// just a convenient function
const toAbility = (
  supported: boolean,
  /** If user has any of these permissions, then they are allowed to perform the action */
  ...actions: AccessControlAction[]
): Ability => [supported, actions.some((action) => action && ctx.hasPermission(action))];
