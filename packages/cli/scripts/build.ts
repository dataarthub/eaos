import { readFile } from 'node:fs/promises'
import ts from 'typescript'
// Emit runtime once, then declarations in fresh workers to bound retained compiler memory.
const source=await readFile('tsup.config.ts','utf8'),ast=ts.createSourceFile('config.ts',source,ts.ScriptTarget.Latest,true)
let entries:string[]=[]
for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.name.text==='allEntries'&&declaration.initializer&&ts.isArrayLiteralExpression(declaration.initializer))entries=declaration.initializer.elements.map(item=>{if(!ts.isStringLiteral(item))throw Error('Literal CLI build entries required');return item.text})
if(!entries.length)throw Error('CLI build entries unavailable')
async function run(env:Record<string,string>,args:string[]=[]){const child=Bun.spawn(['bunx','--no-install','tsup',...args],{env:{...process.env,...env},stdout:'inherit',stderr:'inherit'});if(await child.exited)throw Error('CLI build failed')}
await run({EAOS_CLI_RUNTIME_ONLY:'1'})
for(const entry of entries)await run({EAOS_CLI_RUNTIME_ONLY:'0',EAOS_CLI_DTS_ENTRIES:entry},['--dts-only'])
