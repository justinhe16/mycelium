import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

/*
 * Plaid client factory. Mycelium only ever asks for read products
 * (transactions, investments) -- never auth, transfer or payment initiation --
 * so no credential stored here can move money.
 */

export type PlaidEnv = "sandbox" | "production";

export type PlaidSettings = { clientId: string; secret: string; env: PlaidEnv };

/** The Plaid calls the app uses; tests pass a fake with the same shape. */
export type PlaidClient = Pick<
  PlaidApi,
  | "accountsGet"
  | "transactionsSync"
  | "investmentsHoldingsGet"
  | "itemGet"
  | "itemRemove"
  | "linkTokenCreate"
  | "itemPublicTokenExchange"
  | "institutionsGetById"
>;

export const COUNTRY_CODES = [CountryCode.Us];

/** Link flavors: a bank/card login must support transactions; an investment login must support holdings. */
export const LINK_MODES = {
  bank: { products: [Products.Transactions], optional: [Products.Investments] },
  investment: { products: [Products.Investments], optional: [Products.Transactions] },
} as const;
export type LinkMode = keyof typeof LINK_MODES;

export function plaidSettings(env: NodeJS.ProcessEnv = process.env): PlaidSettings | null {
  const clientId = env.PLAID_CLIENT_ID?.trim();
  const secret = env.PLAID_SECRET?.trim();
  if (!clientId || !secret) return null;
  const plaidEnv = (env.PLAID_ENV?.trim() || "sandbox") as PlaidEnv;
  if (plaidEnv !== "sandbox" && plaidEnv !== "production") {
    throw new Error(`PLAID_ENV must be "sandbox" or "production" (got "${plaidEnv}").`);
  }
  return { clientId, secret, env: plaidEnv };
}

/** What's missing before linking can work, for the setup card in the UI. */
export function setupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (!env.PLAID_CLIENT_ID?.trim() || !env.PLAID_SECRET?.trim()) problems.push("PLAID_CLIENT_ID and PLAID_SECRET are not set.");
  if (!/^[0-9a-fA-F]{64}$/.test(env.MYCELIUM_ENC_KEY?.trim() ?? "")) problems.push("MYCELIUM_ENC_KEY is missing or not 64 hex characters.");
  return problems;
}

const globalForPlaid = globalThis as unknown as { __myceliumPlaid?: { key: string; client: PlaidApi } };

export function plaidClient(): PlaidApi {
  const settings = plaidSettings();
  if (!settings) throw new Error("Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local.");
  const key = `${settings.env}:${settings.clientId}`;
  if (globalForPlaid.__myceliumPlaid?.key === key) return globalForPlaid.__myceliumPlaid.client;

  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[settings.env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": settings.clientId,
          "PLAID-SECRET": settings.secret,
          "Plaid-Version": "2020-09-14",
        },
        timeout: 60_000,
      },
    }),
  );
  globalForPlaid.__myceliumPlaid = { key, client };
  return client;
}

export type PlaidErrorInfo = { code: string; type: string | null; message: string };

/** Pull Plaid's structured error out of an axios failure, if there is one. Never includes tokens. */
export function plaidError(err: unknown): PlaidErrorInfo | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data as
    | { error_code?: string; error_type?: string; error_message?: string; display_message?: string | null }
    | undefined;
  if (!data?.error_code) return null;
  return {
    code: data.error_code,
    type: data.error_type ?? null,
    message: data.display_message || data.error_message || data.error_code,
  };
}

export function describeError(err: unknown): string {
  const p = plaidError(err);
  if (p) return `${p.code}: ${p.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** Errors that mean "re-link this login" rather than "something broke". */
export const RELINK_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "ACCESS_NOT_GRANTED"]);
