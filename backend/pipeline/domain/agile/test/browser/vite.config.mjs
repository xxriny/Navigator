import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('../../../../../../',import.meta.url)),plugins:[react()],
 resolve:{alias:[{find:/^.*\/serverClient(?:\.js)?$/,replacement:fileURLToPath(new URL('./serverClient.mjs',import.meta.url))}]},
 server:{host:'127.0.0.1',port:5197,strictPort:true,proxy:{'/api':'http://127.0.0.1:8897','/auth':'http://127.0.0.1:8897','/__test':'http://127.0.0.1:8897'}}
});
