import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('./firebase-sdk-entry.mjs', import.meta.url))], outfile: fileURLToPath(new URL('../src/firebase-sdk.mjs', import.meta.url)), bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'], legalComments: 'none' });
console.log('Firebase 브라우저 SDK를 로컬 모듈로 번들했습니다.');
