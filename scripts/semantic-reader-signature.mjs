// Display compiler-produced callable types without guessing undocumented parameters.
export function callableSignature(text) {
  if (!text) return null;
  let quote='', angle=0, start=-1;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue;}
    if(['"',"'",'`'].includes(c)){quote=c;continue;}
    if(c==='<')angle++;else if(c==='>'&&text[i-1]!=='=')angle=Math.max(0,angle-1);
    else if(c==='('&&angle===0){start=i;break;}
    else if(c==='{'&&angle===0)return null;
  }
  if(start<0)return null;
  let depth=1,end=-1;quote='';
  for(let i=start+1;i<text.length;i++){const c=text[i];if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue;}if(['"',"'",'`'].includes(c)){quote=c;continue;}if(c==='(')depth++;if(c===')'&&!--depth){end=i;break;}}
  if(end<0||!text.slice(end+1).trim().startsWith('=>'))return null;
  const raw=text.slice(start+1,end),parts=[];let begin=0;const levels={'(':0,'[':0,'{':0,'<':0};quote='';
  for(let i=0;i<raw.length;i++){const c=raw[i];if(quote){if(c===quote&&raw[i-1]!=='\\')quote='';continue;}if(['"',"'",'`'].includes(c)){quote=c;continue;}if(c in levels)levels[c]++;else if(')]}>'.includes(c)&&!(c==='>'&&raw[i-1]==='=')){const open={')':'(',']':'[','}':'{','>':'<'}[c];levels[open]=Math.max(0,levels[open]-1);}if(c===','&&Object.values(levels).every(n=>n===0)){parts.push(raw.slice(begin,i).trim());begin=i+1;}}
  if(raw.slice(begin).trim())parts.push(raw.slice(begin).trim());
  return {inputs:parts.map(p=>{const m=p.match(/^(\.\.\.)?([\w$]+)(\?)?\s*:\s*([\s\S]+)$/);return m?{name:(m[1]??'')+m[2],optional:Boolean(m[3]),type:m[4]}:{name:p,optional:false,type:null};}),output:text.slice(end+1).trim().slice(2).trim(),raw:text};
}
