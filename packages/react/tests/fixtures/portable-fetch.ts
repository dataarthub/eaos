import {createWorkspaceApi,type BrowserFetch} from '../../src/client/index'
import {fetchVerifiedComputeAsset} from '../../src/client/compute'

// Model Bun's static extension without requiring Bun types in this public fixture.
declare global {namespace fetch {function preconnect(url:string):void}}
const request:BrowserFetch=async()=>new Response(new Uint8Array([0]))
export const api=createWorkspaceApi({endpoint:'/api/plugins',fetch:request})
export const readAsset=()=>fetchVerifiedComputeAsset({url:'https://assets.example.test/a',sha256:'0'.repeat(64)},request)
