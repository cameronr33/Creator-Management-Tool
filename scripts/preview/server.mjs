import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { root, runtime } from './settings.mjs';

const allowedConnection = 'postgresql://preview:preview@localhost:5544/creator_preview';
if (process.env.DATABASE_URL !== allowedConnection) throw new Error('Refusing non-preview database');
// Reserve the port before opening the data directory: two writers cannot start.
let handler = (_req, res) => { res.writeHead(503); res.end('Preview database is starting'); };
const server = createServer((req, res) => handler(req, res));
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(5544, '127.0.0.1', accept);
});
const pg = new PGlite(resolve(runtime, 'pgdata'));
await pg.waitReady;

// This is a brand-new isolated schema. Shared table definitions are fixtures here.
const migrations = resolve(root, 'src/lib/db/migrations');
for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
  for (const statement of readFileSync(resolve(migrations, name), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
    try { await pg.exec(statement); }
    catch (error) { if (!['42P07', '42710', '42701', '42P06', '42P16'].includes(error.code)) throw error; }
  }
}

await pg.query(`INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'admin') ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash`,
  [process.env.ADMIN_NAME, process.env.ADMIN_EMAIL, await hash(process.env.ADMIN_PASSWORD, 10)]);
await pg.query(`INSERT INTO sa_clients (name,slug) VALUES ('HELLA','hella') ON CONFLICT(slug) DO NOTHING`);
const client = (await pg.query(`SELECT id FROM sa_clients WHERE slug='hella'`)).rows[0].id;
await pg.query(`INSERT INTO cm_campaigns (client_id,name,description) VALUES ($1,'Everyday adventures','Synthetic preview campaign') ON CONFLICT(client_id,name) DO NOTHING`, [client]);
const campaign = (await pg.query(`SELECT id FROM cm_campaigns WHERE client_id=$1 AND name='Everyday adventures'`, [client])).rows[0].id;
const fixtures = [
  ['Maya Park','maya.trails','shortlisted','Overlanding',84000],
  ['Theo Brooks','theo.garage','in_conversation','Garage builds',126000],
  ['Nora Fields','nora.drives','awaiting_address','Automotive',47000],
  ['Eli Chen','eli.offroad','fulfilling','Off-road',93000],
  ['Ava Rivera','ava.racing','content_pending','Motorsport',158000],
];
for (const [name,username,stage,pillar,followers] of fixtures) {
  await pg.query(`INSERT INTO cm_creators(client_id,name,username,profile_url,business_email,content_pillar,followers,avg_views,max_views,views_source,content_type_summary,notes) VALUES($1,$2,$3,$4,$5,$6,$7,18000,87000,'apify',$8,'Synthetic preview record; no real creator data.') ON CONFLICT(client_id,username) DO NOTHING`,
    [client,name,username,`https://www.instagram.com/${username}`,`${username}@example.test`,pillar,followers,`${pillar} tutorials and project stories.`]);
  const creator = (await pg.query(`SELECT id FROM cm_creators WHERE client_id=$1 AND username=$2`, [client,username])).rows[0].id;
  await pg.query(`INSERT INTO cm_creator_socials(creator_id,platform,url,handle,is_primary) VALUES($1,'instagram',$2,$3,true) ON CONFLICT(creator_id,url) DO NOTHING`, [creator,`https://www.instagram.com/${username}`,username]);
  await pg.query(`INSERT INTO cm_partnerships(creator_id,campaign_id,stage,agreement_type,compensation_type,fee_amount,agreed_terms,outreach_reason,recipient_name,address_line1,city,region,postal_code) VALUES($1,$2,$3,$4,'hybrid','750.00','One Instagram reel and two stories. Synthetic example.','your hands-on installation walkthroughs',$5,$6,$7,$8,$9) ON CONFLICT(creator_id,campaign_id) DO NOTHING`,
    [creator,campaign,stage,['fulfilling','content_pending'].includes(stage)?'signed':null,stage==='fulfilling'||stage==='content_pending'?name:null,stage==='fulfilling'||stage==='content_pending'?'123 Example Street':null,stage==='fulfilling'||stage==='content_pending'?'Sample City':null,stage==='fulfilling'||stage==='content_pending'?'CA':null,stage==='fulfilling'||stage==='content_pending'?'90000':null]);
  const partnership = (await pg.query(`SELECT id FROM cm_partnerships WHERE creator_id=$1 AND campaign_id=$2`, [creator,campaign])).rows[0].id;
  if (['fulfilling','content_pending'].includes(stage)) {
    await pg.query(`INSERT INTO cm_products_requested(partnership_id,product_name,quantity) SELECT $1,'HELLA auxiliary lighting kit',1 WHERE NOT EXISTS (SELECT 1 FROM cm_products_requested WHERE partnership_id=$1)`, [partnership]);
    await pg.query(`INSERT INTO cm_shipments(partnership_id,status,carrier,tracking_number,delivered_at) SELECT $1,$2,'UPS','PREVIEW-TRACKING',$3 WHERE NOT EXISTS(SELECT 1 FROM cm_shipments WHERE partnership_id=$1)`, [partnership,stage==='content_pending'?'delivered':'ready',stage==='content_pending'?new Date(Date.now()-3*86400000).toISOString():null]);
  }
  if (stage === 'in_conversation') {
    await pg.query(`INSERT INTO cm_outreach_events(partnership_id,direction,channel,kind,body,subject,external_id,occurred_at) VALUES($1,'inbound','email','reply','Thanks for reaching out. Could you share the lighting kit details?','Re: HELLA collaboration','preview-theo-reply',now()-interval '1 day') ON CONFLICT DO NOTHING`,[partnership]);
  }
}

const {rows: typeRows} = await pg.query('SELECT oid FROM pg_type');
const identity = value => value;
const parsers = Object.fromEntries(typeRows.map(({oid}) => [oid, identity]));
const serializers = Object.fromEntries(typeRows.map(({oid}) => [oid, identity]));
async function query(client, request) {
  const result = await client.query(request.query, request.params || [], {rowMode:'array', parsers, serializers});
  return {...result, rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length};
}
handler = async (req,res) => {
  if(req.method==='GET' && req.url==='/health') {res.end('isolated-preview-ready');return;}
  if(req.method!=='POST' || req.url!=='/sql' || req.headers['neon-connection-string']!==allowedConnection) {
    res.writeHead(403);res.end('Only the isolated preview database is accepted');return;
  }
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) { chunks.push(chunk); bytes += chunk.length; if(bytes>2000000) throw new Error('Query too large'); }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const output = request.queries ? {results:await pg.transaction(async tx => {
      const rows=[];for(const item of request.queries) rows.push(await query(tx,item));return rows;
    })} : await query(pg,request);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(output));
  } catch(error) {
    res.writeHead(400,{'Content-Type':'application/json'});
    res.end(JSON.stringify({message:error.message,code:error.code,detail:error.detail,constraint:error.constraint}));
  }
};
console.log('Isolated synthetic PostgreSQL preview ready at 127.0.0.1:5544');
const close = () => server.close(async()=>{await pg.close();process.exitCode = 0;});
process.on('SIGINT', close);
process.on('SIGTERM', close);
