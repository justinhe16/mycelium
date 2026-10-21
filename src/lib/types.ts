import type { Kind, TransferTag } from "./classify";
import type { NetWorthPoint } from "./net-worth";

export type ItemView = {
  id: string;
  institutionName: string;
  products: string[];
  status: "ok" | "login_required" | "error";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
};

export type AccountView = {
  id: string;
  itemId: string;
  institutionName: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  creditLimit: number | null;
  isoCurrency: string | null;
  isLiability: boolean;
  hidden: boolean;
  holdingsValue: number | null;
  holdingsCount: number;
};

export type SyncRunView = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  status: "running" | "ok" | "partial" | "error";
  added: number;
  modified: number;
  removed: number;
  error: string | null;
};

export type Snapshot = {
  today: string;
  setup: { problems: string[]; env: "sandbox" | "production" | null };
  items: ItemView[];
  accounts: AccountView[];
  series: NetWorthPoint[];
  totals: { assets: number; liabilities: number; netWorth: number };
  categories: string[];
  transactionCount: number;
  runs: SyncRunView[];
};

export type LedgerRow = {
  id: string;
  date: string;
  description: string;
  rawName: string;
  amount: number;
  currency: string | null;
  kind: Kind;
  transferTag: TransferTag | null;
  /** A card payment with no matching receipt on a linked card or loan. */
  unmatched: boolean;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  pending: boolean;
  paymentChannel: string | null;
  accountId: string;
  accountName: string;
  accountMask: string | null;
  institution: string;
};

export type LedgerPage = {
  rows: LedgerRow[];
  total: number;
  /** Money in and out, transfers excluded. */
  inflow: number;
  outflow: number;
  /** Moves between your own accounts, kept out of inflow/outflow. */
  transfers: {
    /** Sum of transfer outflows (each move counted once, on the sending side). */
    moved: number;
    /** Net into investment accounts (out minus withdrawals). */
    invested: number;
    /** Card and loan payments, on the paying side. */
    cardPayments: number;
    /** Card payments with no receipt on a linked card or loan. */
    unmatched: { count: number; total: number };
  };
  page: number;
  pageSize: number;
};
