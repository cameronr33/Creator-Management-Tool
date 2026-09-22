import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { root } from './settings.mjs';
const url = process.env.DATABASE_URL;
await assert.rejects(fetch('https://example.com'), /External fetch disabled/);
await assert.rejects(fetch('https://localhost/sql', {method:'POST',headers:{'Neon-Connection-String':'postgresql://fake@production.invalid/db'}}), /non-preview database/);
const request = await fetch('https://localhost/sql', {method:'POST',headers:{'Neon-Connection-String':url},body:JSON.stringify({query:'SELECT 1 AS value',params:[]})});
assert.equal(request.status,200);
assert.equal((await request.json()).rows[0][0],'1');
const direct = await fetch('http://127.0.0.1:5544/sql', {method:'POST',headers:{'Neon-Connection-String':'postgresql://fake@production.invalid/db'},body:'{}'});
assert.equal(direct.status,403);
// A permitted loopback URL must not redirect around the host allowlist. The
// destination uses another loopback address, so this regression never leaves
// the machine even when the boundary is broken.
let destinationHits = 0;
const destination = createServer((_req,res) => { destinationHits++; res.end('redirect escaped guard'); });
await new Promise(accept => destination.listen(0,'127.0.0.2',accept));
const destinationUrl = `http://127.0.0.2:${destination.address().port}/blocked`;
const redirector = createServer((req,res) => {
  if (req.url === '/health') {res.end('ready');return;}
  res.writeHead(302,{Location:destinationUrl});res.end();
});
await new Promise(accept => redirector.listen(0,'127.0.0.1',accept));
const redirectUrl = `http://127.0.0.1:${redirector.address().port}/redirect`;
try {
  assert.equal((await fetch(redirectUrl.replace('/redirect','/health'))).status,200);
  await assert.rejects(fetch(destinationUrl), /External fetch disabled/);
  for (const request of [
    () => fetch(redirectUrl),
    () => fetch(redirectUrl,{redirect:'follow'}),
    () => fetch(new Request(redirectUrl,{redirect:'follow'})),
  ]) {
    await assert.rejects(request(), error => /redirect/i.test(String(error.cause?.message ?? error.message)));
  }
  assert.equal(destinationHits,0,'No redirect target may receive a request');
} finally {
  redirector.closeAllConnections(); destination.closeAllConnections();
  await Promise.all([new Promise(accept => redirector.close(accept)),new Promise(accept => destination.close(accept))]);
}
function rejected(args, env, message) {
  const child = spawnSync(process.execPath, args, {
    cwd: root, env: {...process.env, ...env}, encoding:'utf8', timeout:15000,
  });
  assert.notEqual(child.status, 0);
  assert.match(`${child.stdout}${child.stderr}`, message);
}
rejected(['--require', resolve(root,'scripts/preview/preload.cjs'), '-e', 'process.exit(0)'],
  {DATABASE_URL:'postgresql://fake@production.invalid/db',NODE_OPTIONS:''}, /non-preview DATABASE_URL/);
rejected([resolve(root,'scripts/preview/run.mjs'),'dev'], {NODE_ENV:'production',CREATOR_PREVIEW_BUILD:'1'}, /cannot run with NODE_ENV=production/);
rejected([resolve(root,'scripts/preview/run.mjs'),'script','scripts/apply-schema.ts'], {}, /Only existing scripts\/verify-/);
rejected(['--require','tsx/cjs','-e', `require('./next.config.ts').default('phase-production-server')`],
  {NODE_ENV:'production',CREATOR_PREVIEW_BUILD:'1'}, /cannot run as a production server/);
rejected([resolve(root,'scripts/preview/run.mjs'),'db'], {}, /EADDRINUSE/);
console.log('PASS: external fetch, redirects and foreign DB blocked; production serving, arbitrary scripts, and duplicate DB startup rejected; synthetic SQL works.');
