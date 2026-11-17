import { loadDotEnv, parseConfig } from './config.js';

loadDotEnv(); // before loading v2's lib/store.js (reads AGENT_BOARD_DIR on import)

const { buildApp } = await import('./app.js');
const { HOST } = await import('./http/security.js');
const { DeckStore } = await import('./store/store.js');

const config = parseConfig();
const store = new DeckStore(config.mongo);
const app = await buildApp({ config, store, startSync: true });

// Mongo is optional to start: the blocks that depend on it show their state on screen.
store.connect().then(() => {
  const r = store.renameReport;
  if (r.renamed.length) app.log.info({ renamed: r.renamed }, 'renamed collections to the new names');
  if (r.conflicts.length) app.log.warn({ conflicts: r.conflicts }, 'old and new collections both hold data; the old ones were left untouched');
}).catch(() => app.log.warn({ mongo: store.status }, 'storage unavailable'));

const shutdown = async () => { await app.close(); await store.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: HOST, port: config.port });
app.log.info(`TLDeck at http://localhost:${config.port}`);
