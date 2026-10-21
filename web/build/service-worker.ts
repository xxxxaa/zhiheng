// Only the immutable application shell is cached. Financial data stays in IndexedDB.
export function serviceWorkerSource(files:string[],version:string){
  return `const CACHE=${JSON.stringify('zhiheng-shell-v2-'+version)};
const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('zhiheng-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{
  if(event.data?.type!=='zhiheng-offline-status'||!event.ports[0])return;
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    const ready=(await Promise.all(FILES.map(file=>cache.match(file)))).every(Boolean);
    event.ports[0].postMessage({type:'zhiheng-offline-status',ready,version:${JSON.stringify(version)}});
  }).catch(()=>event.ports[0].postMessage({type:'zhiheng-offline-status',ready:false})));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
    event.respondWith(fetch(event.request).catch(async()=>{
      const cached=await (await caches.open(CACHE)).match('/index.html');
      return cached||new Response('离线页面尚未准备好，请联网后重新打开知衡。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }));
    return;
  }
  if(FILES.includes(url.pathname)&&!url.search)event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(cached=>cached||fetch(event.request)));
});`;
}
