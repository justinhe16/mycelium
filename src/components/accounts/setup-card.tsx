import { KeyRoundIcon } from "lucide-react";

/** Shown until Plaid keys and the encryption key are in .env.local. */
export function SetupCard({ problems }: { problems: string[] }) {
  return (
    <div className="border-border/70 bg-muted/30 flex flex-col gap-3 rounded-xl border p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <KeyRoundIcon className="text-muted-foreground size-4" /> Connect Plaid
      </div>
      <ul className="text-destructive list-disc pl-5 text-xs">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1.5 pl-5 text-xs leading-5">
        <li>
          Run <code className="text-foreground font-mono">npm run keygen</code>. It creates <code className="font-mono">.env.local</code>{" "}
          with an encryption key for your Plaid tokens.
        </li>
        <li>
          Sign up at{" "}
          <a className="text-foreground underline underline-offset-2" href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer">
            dashboard.plaid.com
          </a>
          , then copy your <em>client_id</em> and <em>Sandbox</em> secret into <code className="font-mono">PLAID_CLIENT_ID</code> and{" "}
          <code className="font-mono">PLAID_SECRET</code>.
        </li>
        <li>Restart <code className="text-foreground font-mono">npm run dev</code> and come back here.</li>
        <li>
          For real accounts, request Production access in the dashboard (Chase also needs OAuth registration there), then set{" "}
          <code className="font-mono">PLAID_ENV=production</code> and the Production secret.
        </li>
      </ol>
    </div>
  );
}
