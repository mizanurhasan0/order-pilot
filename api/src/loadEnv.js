// Loads .env into process.env. Imported first by app.js and server.js, because ES modules run
// their imports before their own code and bot.js reads the Redis settings on import.
// On Vercel there is no .env file and the project's environment variables are used as is.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
