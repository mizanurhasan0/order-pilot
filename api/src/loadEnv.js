// Loads .env into process.env. Imported first by every entry module (app.js, server.js, bot.js),
// because ES modules run their imports before their own code and bot.js reads the Redis settings
// on import. On Vercel there is no .env file and the project's environment variables are used as is.
//
// Never under `node --test` (it sets NODE_TEST_CONTEXT): the tests set every value they need and
// must not pick up real secrets from a developer's .env.
import dotenv from 'dotenv';

if (!process.env.NODE_TEST_CONTEXT) dotenv.config({ quiet: true });
