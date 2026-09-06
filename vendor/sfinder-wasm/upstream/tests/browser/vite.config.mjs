import {fileURLToPath} from 'node:url';
export default {
 root:fileURLToPath(new URL('.',import.meta.url)),
 build:{outDir:'dist',emptyOutDir:false},
 worker:{format:'es'},
};
