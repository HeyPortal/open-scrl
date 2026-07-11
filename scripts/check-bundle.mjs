import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

const html=await readFile('dist/index.html','utf8');
const source=html.match(/<script[^>]+src="([^"]+)"/)?.[1];
if(!source)throw new Error('Could not find the production entry script.');
const file=path.join('dist',source.replace(/^\//,''));const bytes=gzipSync(await readFile(file)).byteLength;const budget=120*1024;
const assets=await readdir('dist/assets');process.stdout.write(`Initial entry: ${(bytes/1024).toFixed(1)} KiB gzip (${path.basename(file)})\nGenerated chunks: ${assets.length}\n`);
if(bytes>budget)throw new Error(`Initial entry exceeds 120 KiB gzip budget by ${((bytes-budget)/1024).toFixed(1)} KiB.`);
