import type { ComponentProps, ReactNode } from 'react'
import { Card, CardContent } from '@alneas/appkit-react/tools/ui'
import { LoginForm } from '@alneas/appkit-react/tools/auth'
import { CoreWorkspaceHelp } from './user-guide'

/**
 * Login page presentation and host-selected authentication controls.
 *
 * @see WorkspaceLoginScreen for a complete host integration example.
 */
export interface WorkspaceLoginScreenProps {
  /**
 * Page heading.
 * @defaultValue 'ワークスペースへログイン'
 */
  title?: string
  /**
 * Optional content above the login form.
 */
  description?: ReactNode
  /**
 * Whether react-tools displays email login.
 * @defaultValue true
 */
  showEmailLogin?: boolean
  /**
 * Whether react-tools displays registration navigation.
 * @defaultValue true
 */
  showRegisterLink?: boolean
  /**
 * Optional host callback invoked by the registration control.
 */
  onRegisterClick?: () => void
  /**
 * Host-configured LoginForm social provider controls and callbacks.
 */
  socialProviders?: ComponentProps<typeof LoginForm>['socialProviders']
  /**
 * Post-login destination passed to LoginForm.
 * @defaultValue '/'
 */
  redirectTo?: string
}
/**
 * Composes workspace help and the react-tools login form in a centered card.
 *
 * Shared login page composition; the host chooses which authentication methods are enabled.
 * @param props - WorkspaceLoginScreenProps; title defaults to the Japanese workspace login title, email/register visibility to true and redirectTo to /.
 * @returns A login page element with optional description and host-selected social providers.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. The host must configure the authentication provider required by react-tools LoginForm; this component does not authenticate by itself.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceLoginScreen } from '@alneas/eaos-react/workspace-login';
 * // Mount inside the host authentication setup required by react-tools LoginForm.
 * export function Login() { return <WorkspaceLoginScreen title="Sign in" showRegisterLink={false}/>; }
 * ```
 */
export function WorkspaceLoginScreen({
  title='ワークスペースへログイン', description, showEmailLogin=true, showRegisterLink=true,
  onRegisterClick, socialProviders, redirectTo='/',
}:WorkspaceLoginScreenProps) {
  return <main className="min-h-screen flex items-center justify-center p-6">
    <Card className="w-full max-w-md"><CardContent className="p-6">
      <h1 className="text-xl font-semibold mb-4">{title}</h1><CoreWorkspaceHelp/>
      {description&&<div className="mb-4">{description}</div>}
      <LoginForm showEmailLogin={showEmailLogin} showRegisterLink={showRegisterLink} onRegisterClick={onRegisterClick} socialProviders={socialProviders} redirectTo={redirectTo}/>
    </CardContent></Card>
  </main>
}
