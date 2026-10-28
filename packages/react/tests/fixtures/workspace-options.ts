import type {WorkspaceFactoryOptions,WorkspaceBindingEnvironment,ConnectedWorkspacePage} from '../../src/workspace-binding'
const required=(_environment:WorkspaceBindingEnvironment,_options:{worker:string}):ConnectedWorkspacePage[]=>[]
const optional=(_environment:WorkspaceBindingEnvironment,_options?:{color:string}):ConnectedWorkspacePage[]=>[]
const plain=(_environment:WorkspaceBindingEnvironment):ConnectedWorkspacePage[]=>[]
const factories={required,optional,plain}
const valid:WorkspaceFactoryOptions<typeof factories>={required:{worker:'explicit'}}
// @ts-expect-error selected required factory ports cannot be omitted
const missing:WorkspaceFactoryOptions<typeof factories>={}
// @ts-expect-error unselected options cannot be supplied
const unknown:WorkspaceFactoryOptions<typeof factories>={required:{worker:'explicit'},other:{}}
void [valid,missing,unknown]
