// soulscape: run `npm start` (or `node server.js`). Settings come from
// environment variables or a .env file; see .env.example and DEPLOY.md.
import { start } from './server/index.js';

start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
