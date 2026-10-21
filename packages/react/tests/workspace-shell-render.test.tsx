import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from '@alneas/appkit-react/tools/core'
import { SidebarProvider } from '@alneas/appkit-react/tools/sidebar'
import { WorkspaceHeader, WorkspaceSidebar } from '../src/workspace-shell'

const render = (content: React.ReactNode) => renderToStaticMarkup(<ThemeProvider><SidebarProvider>{content}</SidebarProvider></ThemeProvider>)
test('header standard controls are present by default and hosts may explicitly hide them', () => {
 const defaults=render(<WorkspaceHeader currentLanguage="en"/>)
 expect(defaults).toContain('EAOS')
 expect(defaults).not.toMatch(/<button[^>]*>\s*<button/)
 expect(defaults).toContain('Current color:')
 expect(defaults).toContain('Current spacing:')
 expect(defaults).toContain('日本語に切り替え')
 const hidden=render(<WorkspaceHeader showColorToggle={false} showSpaceToggle={false} showLanguageToggle={false}/>)
 expect(hidden).not.toContain('Current color:')
 expect(hidden).not.toContain('Current spacing:')
 expect(hidden).not.toContain('日本語に切り替え')
})
test('sidebar renders the verified signed-in account independently of business contributions', () => {
 const html=render(<WorkspaceSidebar user={{name:'Tester',email:'tester@example.test'}} onNavigate={()=>{}} onLogout={()=>{}}/>)
 expect(html).toContain('ログインユーザー: Tester')
 expect(html).toContain('tester@example.test')
 expect(html).toContain('ログアウト')
 const anonymous=render(<WorkspaceSidebar onNavigate={()=>{}}/>)
 expect(anonymous).not.toContain('ログインユーザー:')
})

test('Platform navigation is shown only when the verified host marks the user as a Platform admin', () => {
 expect(render(<WorkspaceSidebar isPlatformAdmin onNavigate={()=>{}}/>)).toContain('Platform管理')
 expect(render(<WorkspaceSidebar onNavigate={()=>{}}/>)).not.toContain('Platform管理')
})
