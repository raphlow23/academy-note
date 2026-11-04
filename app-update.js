export function htmlBuild(html){
 const assets=[];
 for(const tag of html.match(/<(?:script|link)\b[^>]*>/gi)||[]){
  const attr=name=>tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\x27]([^"\x27]+)["\x27]','i'))?.[1]||'';
  if(/^<script/i.test(tag)&&attr('type')==='module'&&attr('src'))assets.push(attr('src'));
  if(/^<link/i.test(tag)&&attr('rel')==='stylesheet'&&attr('href'))assets.push(attr('href'));
 }
 return assets.some(a=>/app\.js(?:\?|$)/.test(a))?assets.sort().join('\n'):'';
}
export function freshAppUrl(href,stamp=Date.now()){
 const url=new URL(href);url.searchParams.set('_app',String(stamp));return url.href;
}
export async function latestBuild(href,fetcher=(...args)=>globalThis.fetch(...args),stamp=Date.now()){
 const url=new URL('./index.html',href);url.searchParams.set('_check',String(stamp));
 const response=await fetcher(url.href,{cache:'no-store',signal:globalThis.AbortSignal?.timeout?.(10000)});
 if(!response.ok)throw new Error('앱 버전을 확인하지 못했습니다.');
 return htmlBuild(await response.text());
}
