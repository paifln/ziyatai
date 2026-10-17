"use client";
import { useCallback, useState } from "react";
import { DraftGuard } from "../../../packages/domain/draft-guard";

/** Update the guard synchronously, before React commits the dirty indicator. */
export function useDraftState() {
  const [guard] = useState(() => new DraftGuard());
  const [dirty, updateDirty] = useState(false);
  const setDirty = useCallback(
    (value: boolean) => {
      guard.mark(value);
      updateDirty(value);
    },
    [guard],
  );
  return { dirty, setDirty, guard };
}
