"use client";

import { useEffect } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";

/**
 * Mounted only while a link token exists: loads Plaid's script, opens Link as
 * soon as it's ready, and reports back. Unmount it to reset.
 */
export function PlaidLinkLauncher({
  token,
  onSuccess,
  onDone,
}: {
  token: string;
  onSuccess: (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => void;
  onDone: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => {
      onSuccess(publicToken, metadata);
      onDone();
    },
    onExit: () => onDone(),
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}
