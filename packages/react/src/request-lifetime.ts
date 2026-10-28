import {useLayoutEffect,useMemo} from 'react'

// Shared operation lifetime; the Host's existing context remains the identity store.
export function useRequestLifetime(owner:unknown,key:string){
 const session=useMemo(()=>({controller:new AbortController(),active:true}),[owner,key])
 useLayoutEffect(()=>{
  if(session.controller.signal.aborted)session.controller=new AbortController()
  session.active=true
  return()=>{session.active=false;session.controller.abort()}
 },[session])
 return session
}
