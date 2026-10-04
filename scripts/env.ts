/** Load .env.local like Next does. Import this first in every script. */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
