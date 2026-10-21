import UserHelp from './user-help'
import { FormView } from '@alneas/appkit-react/tools/form'
import type { FieldCustomization } from './schema'
export { applyFieldCustomizations } from './schema'
export { FieldCustomizationPage, FieldCustomizationProvider, type FieldWorkspaceData } from './workspace'
/**
 * Renders a schema-driven plugin command form backed by a host callback.
 *
 * Saves one display override through the host command transport; host carries resource/revision.
 * @param props - save is an authenticated async host command and labels supplies field captions. Save receives display overrides; host closes over resource, field key and revision.
 * @returns A plugin help panel and Appkit React FormView in create mode.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Configure the form/schema providers required by Appkit React FormView. Callback rejection is handled by the form implementation; no database adapter is supplied here.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { FieldCustomizationForm } from '@alneas/eaos-plugins/field-customization/react';
 * export function Form({ save }: Pick<React.ComponentProps<typeof FieldCustomizationForm>, 'save'>) { return <FieldCustomizationForm save={save} labels={{ display_label: 'Label', placeholder: 'Placeholder', help_text: 'Help', is_hidden: 'Hidden', is_required: 'Required' }}/>; }
 * ```
 */
export function FieldCustomizationForm({ save, labels }: {
 /**
 * Authenticated host field override callback; closes over authorized resource/field/revision and resolves on completion.
 * @param values - Display overrides for the host-selected field/resource; the host supplies the current definition revision.
 * @returns Resolves without a value when the host command completes; the form handles its Promise outcome.
 * @throws Rejects host authorization, validation, transport or persistence failures; reload current state after uncertain write outcomes.
 *
 * @example
 * ```typescript
 * import { FieldCustomizationForm } from '@alneas/eaos-plugins/field-customization/react';
 * type HostCommand = Parameters<typeof FieldCustomizationForm>[0]['save'];
 * export async function runHostCommand(command: HostCommand, values: Parameters<HostCommand>[0]) {
 *  await command(values);
 * }
 * ```
 */
save(values: FieldCustomization): Promise<void>
 /**
 * Plugin field captions rendered by the command form.
 */
  labels: {
/**
 * Display-label input caption.
 */
  display_label: string;
/**
 * Placeholder input caption.
 */
  placeholder: string;
/**
 * Help-text input caption.
 */
  help_text: string;
/**
 * Hidden-state input caption.
 */
  is_hidden: string;
/**
 * Required-state input caption.
 */
  is_required: string }
}) {
 return <><UserHelp/><FormView collection="field-customization-command" mode="create" testId="field-customization" schema={{ type: 'object', properties: Object.fromEntries(Object.entries(labels).map(([key, title]) => [key, { type: key.startsWith('is_') ? 'boolean' : 'string', title }])) }} onSave={save} /></>
}
