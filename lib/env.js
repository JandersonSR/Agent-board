// .env opcional na pasta do projeto (ex.: AGENT_BOARD_PORT=9999). Variáveis já definidas têm prioridade.
const path = require('path');
try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* sem .env */ }
