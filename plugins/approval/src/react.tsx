import UserHelp from './user-help'
import { FormView } from '@alneas/appkit-react/tools/form'
export { ApprovalPage, ApprovalProvider, type ApprovalList } from './workspace'
/**
 * Renders a schema-driven plugin command form backed by a host callback.
 *
 * Host supplies an authenticated command transport; no direct database writes.
 * @param props - submit is an authenticated async host command and labels supplies field captions. Submission values contain templateId/title/targetType/targetId; all four fields are required.
 * @returns A plugin help panel and Appkit React FormView in create mode.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Configure the form/schema providers required by Appkit React FormView. Callback rejection is handled by the form implementation; no database adapter is supplied here.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { ApprovalRequestForm } from '@alneas/eaos-plugins/approval/react';
 * export function Form({ submit }: Pick<React.ComponentProps<typeof ApprovalRequestForm>, 'submit'>) { return <ApprovalRequestForm submit={submit} labels={{ templateId: 'Approval rule', title: 'Title', targetType: 'Target type', targetId: 'Target ID' }}/>; }
 * ```
 */
export function ApprovalRequestForm({ submit, labels }: {
 /**
 * Authenticated host submission callback; receives the four required request fields and resolves on completion.
 * @param values - Four required approval request fields; the host must authorize the actual target and template.
 * @returns Resolves without a value when the host command completes; the form handles its Promise outcome.
 * @throws Rejects host authorization, validation, transport or persistence failures; reload current state after uncertain write outcomes.
 *
 * @example
 * ```typescript
 * import { ApprovalRequestForm } from '@alneas/eaos-plugins/approval/react';
 * type HostCommand = Parameters<typeof ApprovalRequestForm>[0]['submit'];
 * export async function runHostCommand(command: HostCommand, values: Parameters<HostCommand>[0]) {
 *  await command(values);
 * }
 * ```
 */
submit(values: {
/**
 * Host approval-template identifier.
 */
  templateId: string;
/**
 * Human-readable request title.
 */
  title: string;
/**
 * Host resource type being reviewed.
 */
  targetType: string;
/**
 * Host resource ID being reviewed.
 */
  targetId: string }): Promise<void>
 /**
 * Plugin field captions rendered by the command form.
 */
  labels: {
/**
 * Host approval-template identifier.
 */
  templateId: string;
/**
 * Human-readable request title.
 */
  title: string;
/**
 * Host resource type being reviewed.
 */
  targetType: string;
/**
 * Host resource ID being reviewed.
 */
  targetId: string }
}) {
 return <><UserHelp/><FormView collection="approval-command" mode="create" testId="approval-request" schema={{ type: 'object', properties: Object.fromEntries(Object.entries(labels).map(([key, title]) => [key, { type: 'string', title }])), required: ['templateId', 'title', 'targetType', 'targetId'] }} onSave={submit} /></>
}
/**
 * Renders a schema-driven plugin command form backed by a host callback.
 * @param props - decide is an authenticated async host command and labels supplies field captions. Decision values contain required action approve/reject and optional comment; host closes over request ID and revision.
 * @returns A plugin help panel and Appkit React FormView in create mode.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Configure the form/schema providers required by Appkit React FormView. Callback rejection is handled by the form implementation; no database adapter is supplied here.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { ApprovalDecisionForm } from '@alneas/eaos-plugins/approval/react';
 * export function Form({ decide }: Pick<React.ComponentProps<typeof ApprovalDecisionForm>, 'decide'>) { return <ApprovalDecisionForm decide={decide} labels={{ action: 'Decision', comment: 'Comment' }}/>; }
 * ```
 */
export function ApprovalDecisionForm({ decide, labels }: {
 /**
 * Authenticated host decision callback; closes over current request ID and revision and resolves on completion.
 * @param values - Approve/reject action and optional comment; the host closes over the current authorized request ID/revision.
 * @returns Resolves without a value when the host command completes; the form handles its Promise outcome.
 * @throws Rejects host authorization, validation, transport or persistence failures; reload current state after uncertain write outcomes.
 *
 * @example
 * ```typescript
 * import { ApprovalDecisionForm } from '@alneas/eaos-plugins/approval/react';
 * type HostCommand = Parameters<typeof ApprovalDecisionForm>[0]['decide'];
 * export async function runHostCommand(command: HostCommand, values: Parameters<HostCommand>[0]) {
 *  await command(values);
 * }
 * ```
 */
decide(values: {
/**
 * Approved action discriminator: approve or reject.
 */
  action: 'approve' | 'reject';
/**
 * Optional decision comment.
 */
  comment?: string }): Promise<void>
 /**
 * Plugin field captions rendered by the command form.
 */
  labels: {
/**
 * Approved action discriminator: approve or reject.
 */
  action: string;
/**
 * Optional decision comment.
 */
  comment: string }
}) {
 return <><UserHelp/><FormView collection="approval-decision-command" mode="create" testId="approval-decision" schema={{ type: 'object', properties: { action: { type: 'string', enum: ['approve', 'reject'], title: labels.action }, comment: { type: 'string', title: labels.comment } }, required: ['action'] }} onSave={decide} /></>
}
