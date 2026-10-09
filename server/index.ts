// Entry point: `npm run server` (dev) or `node dist-server/server.mjs` (built).
import { loadConfig } from './config';
import { createApp, openConfiguredDb } from './app';
import { hashPassword, newId } from './auth';
import type { Db } from './db';

const cfg = loadConfig();
const [cmd, ...args] = process.argv.slice(2);

/** A free serverless database may be resuming from sleep: retry the first connection for up to ~1 minute. */
async function connect(): Promise<Db> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await openConfiguredDb(cfg);
    } catch (e) {
      const transient = (e as Error)?.name === 'DbUnavailableError';
      if (!transient || attempt >= 8) throw e;
      console.error(`Database not reachable yet (attempt ${attempt}); retrying in ${attempt * 2}s`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

try {
  if (cmd === 'create-user') {
    // Usage: create-user <email> <display name>   (password read from MEDGUARD_NEW_USER_PASSWORD)
    const [email, ...name] = args;
    const pw = process.env.MEDGUARD_NEW_USER_PASSWORD ?? '';
    if (!email || !name.length || pw.length < 10) {
      console.error('Usage: MEDGUARD_NEW_USER_PASSWORD=<min 10 chars> create-user <email> <display name>');
      process.exit(1);
    }
    const db = await connect();
    await db.run('INSERT INTO users (id, email, display_name, password_hash) VALUES (?,?,?,?)', [newId('usr'), email.toLowerCase(), name.join(' '), await hashPassword(pw)]);
    await db.close();
    console.log(`Created user ${email}`);
    process.exit(0);
  }

  const db = await connect();
  const { server } = await createApp({ config: cfg, db });
  server.listen(cfg.port, cfg.host, () => {
    console.log(`MEDGUARD API listening on http://${cfg.host}:${cfg.port}`);
    console.log(`  database: PostgreSQL (${db.storage === 'external' ? 'external, DATABASE_URL' : `embedded PGlite in ${cfg.dataDir}/pgdata`})`);
    console.log(`  allowed origins: ${cfg.allowedOrigins.join(', ') || '(none)'}`);
    console.log(`  registration: ${cfg.allowRegistration ? 'open' : 'disabled'}; AI: ${cfg.anthropicApiKey ? `configured (${cfg.aiModel})` : 'not configured'}`);
  });
} catch (e) {
  // Never print the connection string or other configuration values.
  console.error(`MEDGUARD API failed to start: ${(e as Error)?.name === 'DbUnavailableError' ? 'the database could not be reached (check DATABASE_URL)' : (e as Error)?.message}`);
  process.exit(1);
}
