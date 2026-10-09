// Entry point: `npm run server` (dev) or `node dist-server/server.mjs` (built).
import { join } from 'node:path';
import { loadConfig } from './config';
import { createApp } from './app';
import { openDb } from './db';
import { hashPassword, newId } from './auth';

const cfg = loadConfig();
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'create-user') {
  // Usage: create-user <email> <display name>   (password read from MEDGUARD_NEW_USER_PASSWORD)
  const [email, ...name] = args;
  const pw = process.env.MEDGUARD_NEW_USER_PASSWORD ?? '';
  if (!email || !name.length || pw.length < 10) {
    console.error('Usage: MEDGUARD_NEW_USER_PASSWORD=<min 10 chars> create-user <email> <display name>');
    process.exit(1);
  }
  const db = openDb(join(cfg.dataDir, 'medguard.db'));
  db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?,?,?,?)').run(newId('usr'), email.toLowerCase(), name.join(' '), await hashPassword(pw));
  console.log(`Created user ${email}`);
  process.exit(0);
}

const { server } = createApp({ config: cfg });
server.listen(cfg.port, cfg.host, () => {
  console.log(`MEDGUARD API listening on http://${cfg.host}:${cfg.port}`);
  console.log(`  allowed origins: ${cfg.allowedOrigins.join(', ') || '(none)'}`);
  console.log(`  registration: ${cfg.allowRegistration ? 'open' : 'disabled'}; AI: ${cfg.anthropicApiKey ? `configured (${cfg.aiModel})` : 'not configured'}`);
});
