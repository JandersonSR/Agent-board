import { loadDotEnv, parseConfig } from './config.js';

loadDotEnv(); // antes de carregar lib/store.js do v2 (lê AGENT_BOARD_DIR na importação)

const { buildApp } = await import('./app.js');
const { HOST } = await import('./http/security.js');
const { PainelStore } = await import('./store/mongo.js');

const config = parseConfig();
const store = new PainelStore(config.mongo);
const app = await buildApp({ config, store, startSync: true });

// Mongo é opcional para subir: os blocos que dependem dele mostram o estado na tela.
store.connect().catch(() => app.log.warn({ mongo: store.status }, 'MongoDB indisponível'));

const shutdown = async () => { await app.close(); await store.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: HOST, port: config.port });
app.log.info(`Lead Deck em http://localhost:${config.port}`);
