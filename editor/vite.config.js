import * as pkg from './package.json';
import path from 'path';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';


const NODE_ENV = process.argv.mode || 'development';
const VERSION = pkg.version;

export default {
    build: {
        copyPublicDir: false,
        lib: {
            entry: path.resolve(__dirname, 'quill.ts'),
            name: 'Editor',
            filename: 'quill'
        }
    },
    define: {
        'NODE_ENV': JSON.stringify(NODE_ENV),
        'VERSION': JSON.stringify(VERSION),
    },
    server: {
        port: 3303,
    },  
    plugins: [cssInjectedByJsPlugin()] 
}