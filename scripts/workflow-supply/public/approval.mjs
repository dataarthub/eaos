import assert from 'node:assert/strict';
export async function observeApproval(artifacts,{readVersion,verifyArtifact,revalidate,dispatch,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeout=1800000,interval=30000}){
 assert(Array.isArray(artifacts)&&artifacts.length&&Number.isFinite(timeout)&&timeout>0&&timeout<=1800000&&interval>0,'Invalid approval observation inputs');
 const deadline=now()+timeout;
 while(now()<deadline){let ready=true;for(const a of artifacts){const left=deadline-now();if(left<=0)return 'approval-pending';const v=await readVersion(a,left);if(v===null){ready=false;continue;}assert(v.name===a.name&&v.version===a.version&&v.dist?.integrity===a.integrity,'Approved public package identity/integrity differs');}
  if(ready){for(const a of artifacts){if(now()>=deadline)return 'approval-pending';await verifyArtifact(a,deadline-now());}if(now()>=deadline)return 'approval-pending';await revalidate();if(now()>=deadline)return 'approval-pending';await dispatch();return 'completion-requested';}
  if(now()<deadline)await sleep(Math.min(interval,deadline-now()));
 }
 return 'approval-pending';
}
export async function requestCompletionOnce(evidence,{request}){
 assert(Number.isSafeInteger(evidence.runId)&&evidence.runId>0&&Number.isFinite(Date.parse(evidence.createdAt)),'Missing original staging identity');
 const q=new URLSearchParams({event:'workflow_dispatch',branch:'main',per_page:'100',created:'>='+evidence.createdAt});const listed=await request('/actions/workflows/publish.yml/runs?'+q);assert(Array.isArray(listed.workflow_runs)&&listed.total_count<=100,'Completion history requires inspection');
 const title=`Complete npm staging run ${evidence.runId}`;
 if(listed.workflow_runs.some(r=>r.event==='workflow_dispatch'&&r.path==='.github/workflows/publish.yml'&&r.head_branch==='main'&&r.head_repository?.full_name===evidence.repository&&r.display_title===title))return 'completion-already-requested';
 await request('/actions/workflows/publish.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main',inputs:{staged_run:String(evidence.runId)}})});return 'completion-requested';
}
