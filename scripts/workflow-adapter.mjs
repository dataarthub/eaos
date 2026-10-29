import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),phase=process.argv[2];
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))});
if(phase==='hooks-status'){console.log('Configured hooks path: '+(spawnSync('git',['config','--get','core.hooksPath'],{cwd:root,encoding:'utf8'}).stdout.trim()||'default (.git/hooks)'));console.log('Hooks are not installed by workflow adoption. Run quality:commit / quality:push explicitly.');}
else if(phase==='documentation-safety'){for(const script of ['lint','check:public','check:release-impact']){const r=spawnSync('bun',['run',script],{cwd:root,stdio:'inherit'});assert.equal(r.status,0,'Documentation safety gate failed: '+script);}}
else if(phase==='commit'){
 for(const file of ['biome.json','.gitleaks.toml'])assert.equal(git(['show',':'+file]),readFileSync(join(root,file),'utf8'),'Staged verifier configuration differs: '+file);
 const {localGitleaks,gitleaksVersion}=await import('./quality-tools.mjs');assert.equal(execFileSync(localGitleaks,['version'],{encoding:'utf8'}).trim(),gitleaksVersion,'Run secrets:setup explicitly');
 const scan=spawnSync(localGitleaks,['git',root,'--staged','--redact=100','--no-banner','--config',join(root,'.gitleaks.toml'),'--report-format=json','--report-path=-'],{encoding:'utf8'});assert.equal(scan.status,0,'Staged secret scan failed; scanner output suppressed');
 const names=git(['diff','--cached','--name-only','--diff-filter=ACMR','-z']).split('\0').filter(name=>/\.[cm]?[jt]sx?$|\.jsonc?$/.test(name));
 const binary=join(root,'node_modules/.bin/biome'),temporary=mkdtempSync(join(tmpdir(),'eaos-index-lint-'));
 try{
  const config=JSON.parse(git(['show',':biome.json']));assert(!config.extends,'Staged lint requires self-contained indexed Biome configuration');
  // The isolated index snapshot has no Git metadata; preserve all actual lint rules and path overrides.
  config.vcs={...config.vcs,enabled:false};writeFileSync(join(temporary,'biome.json'),JSON.stringify(config));
  for(const name of names){const relative=name.replace(/(^|\/)(biome\.jsonc?)$/,'$1staged-$2'),destination=join(temporary,relative);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,git(['show',':'+name]));
   const r=spawnSync(binary,['lint','--config-path',temporary,'--files-ignore-unknown=true','--no-errors-on-unmatched','--',destination],{cwd:temporary,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)console.error(r.stderr??'');assert.equal(r.status,0,'Staged lint failed');
  }
 }finally{rmSync(temporary,{recursive:true,force:true});}

}else throw Error('Use commit or hooks-status');
