/**
 * Sandbox only: link Plaid's fake "First Platypus Bank" without clicking through
 * Link, then sync it. Handy for trying the app before you have real accounts.
 *
 *   npm run sandbox:link
 */
import "./env";
import { Products } from "plaid";
import { db } from "../src/lib/db";
import { exchangePublicToken } from "../src/lib/link";
import { describeError, plaidClient, plaidSettings, setupProblems } from "../src/lib/plaid";
import { syncNow } from "../src/lib/server-sync";

async function main() {
  const problems = setupProblems();
  if (problems.length) throw new Error(problems.join(" "));
  if (plaidSettings()?.env !== "sandbox") throw new Error("PLAID_ENV must be sandbox for this script.");

  const plaid = plaidClient();
  const { public_token } = (
    await plaid.sandboxPublicTokenCreate({
      institution_id: "ins_109508",
      initial_products: [Products.Transactions, Products.Investments],
    })
  ).data;
  const res = await exchangePublicToken({ db, plaid }, public_token);
  if (res.status === "duplicate") {
    console.log(`${res.institutionName} is already linked (${res.existingItemId}); discarded the duplicate.`);
    return;
  }
  const { itemId, institutionName } = res;
  console.log(`Linked ${institutionName} (${itemId}). Syncing…`);
  const summary = await syncNow("link", { itemIds: [itemId] });
  console.log(JSON.stringify(summary, null, 2));
  console.log("Sandbox transactions can take a minute to appear; run `npm run sync` again if the count is 0.");
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
