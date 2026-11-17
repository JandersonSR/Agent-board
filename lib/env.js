// Optional .env in the project folder (e.g. AGENT_BOARD_PORT=9999). Variables already set take precedence.
const path = require('path');
try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* sem .env */ }
