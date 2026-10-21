/** DBMS_METADATA emits trigger enablement after its PL/SQL definition. */
export function oracleMetadataStatements(object:{kind:string;ddl:string}):string[]{
 const ddl=object.ddl.trim()
 if(object.kind!=='TRIGGER')return[ddl]
 const enablement=/\n\s*(ALTER TRIGGER\s+"(?:[^"]|"")+"\s+(?:ENABLE|DISABLE)\s*;?)\s*$/i.exec(ddl)
 return enablement?[ddl.slice(0,enablement.index).replace(/\n\s*\/\s*$/,'').trim(),enablement[1].replace(/;$/,'').trim()]:[ddl]
}
/** Oracle may reorder inline CHECK/PK constraints when rebuilding a table.
 * Compare those independent constraints as a set; retain exact column order,
 * expressions, quoted literals, partition clauses and every other DDL object.
 */
export function canonicalOracleDdl(sql:string):unknown {
 if(!/^CREATE TABLE\s+"/.test(sql))return sql
 const start=sql.indexOf('(');if(start<0)throw Error('Invalid Oracle table metadata')
 const parts:string[]=[];let depth=1,quote='',alternative='',block=false,line=false,last=start+1,end=-1
 for(let i=start+1;i<sql.length;i++){
  const c=sql[i]
  if(line){if(c==='\n')line=false;continue}
  if(block){if(c==='*'&&sql[i+1]==='/'){block=false;i++}continue}
  if(alternative){if(c===alternative&&sql[i+1]==="'"){alternative='';i++}continue}
  if(!quote&&c==='-'&&sql[i+1]==='-'){line=true;i++;continue}
  if(!quote&&c==='/'&&sql[i+1]==='*'){block=true;i++;continue}
  if(!quote&&/[qQ]/.test(c)&&sql[i+1]==="'"){const open=sql[i+2];alternative=({'[':']','(':')','{':'}','<':'>'} as Record<string,string>)[open]??open;i+=2;continue}
  if(quote){if(c===quote){if(sql[i+1]===quote)i++;else quote=''}continue}
  if(c==="'"||c==='"'){quote=c;continue}
  if(c==='(')depth++
  if(c===')'&&--depth===0){parts.push(sql.slice(last,i).trim());end=i;break}
  if(c===','&&depth===1){parts.push(sql.slice(last,i).trim());last=i+1}
 }
 if(end<0||quote)throw Error('Unbalanced Oracle table metadata')
 const constraints=parts.filter(p=>/^(?:CONSTRAINT\b|CHECK\s*\(|PRIMARY\s+KEY\b|UNIQUE\s*\(|FOREIGN\s+KEY\b)/i.test(p)),columns=parts.filter(p=>!constraints.includes(p))
 return{table:sql.slice(0,start),columns,constraints:constraints.sort(),suffix:sql.slice(end+1)}
}
