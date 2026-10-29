import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function runPushChecks({cwd=process.cwd(),run=execFileSync}={}){
 for(const [bin,...args] of [["bun", "run", "secrets:check", "--", "--history"], ["bun", "run", "check:release-impact"], ["node", "scripts/workflow-supply/public/supply.mjs", "check", "--project-root", "."]])run(bin,args,{cwd,stdio:'inherit'});
 console.log('Fresh history/change-record and workflow checks passed. Source suites remain owned by Source quality CI.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runPushChecks();
