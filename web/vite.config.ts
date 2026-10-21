import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {serviceWorkerSource} from './build/service-worker';

export default defineConfig({
  plugins:[react(),{
    name:'offline-shell',enforce:'post',
    generateBundle(_,bundle){
      const publicFiles=['icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'];
      const files=['/index.html',...publicFiles.map(k=>'/'+k),...Object.keys(bundle).filter(k=>/\.(js|css)$/.test(k)).map(k=>'/'+k)];
      const hash=createHash('sha256');
      for(const name of Object.keys(bundle).sort()){
        const file=bundle[name];hash.update(name);hash.update(file.type==='chunk'?file.code:file.source);
      }
      for(const file of publicFiles)hash.update(readFileSync(new URL('./public/'+file,import.meta.url)));
      this.emitFile({type:'asset',fileName:'sw.js',source:serviceWorkerSource(files,hash.digest('hex').slice(0,16))});
    }
  }],build:{sourcemap:false}
});
