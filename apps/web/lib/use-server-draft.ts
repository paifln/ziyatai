"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import { draftsEqual } from "../../../packages/domain/merge-drafts";
import type {
  DraftKind,
  DraftSummary,
  StoredDraft,
} from "../../../packages/contracts/drafts";

type Stage = "idle" | "pending" | "saving" | "saved" | "error";
export function useServerDraft<T>({
  kind,
  resourceId,
  revision,
  draft,
  baseDraft,
  encodeDraft,
  dirty,
  enabled = true,
}: {
  kind: DraftKind;
  resourceId: string;
  revision?: number;
  draft?: T;
  baseDraft?: T;
  encodeDraft?: (base: T, value: T) => unknown;
  dirty: boolean;
  enabled?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("idle"),
    [error, setError] = useState("");
  const [candidates, setCandidates] = useState<DraftSummary[]>([]),
    [listError, setListError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const mounted = useRef(false),
    read = useRef<AbortController | null>(null);
  const owned = useRef({
    id: crypto.randomUUID(),
    sequence: 0,
    attempted: false,
  });
  const recovered = useRef<DraftSummary | null>(null);
  const current = useRef({ revision, draft, dirty, baseDraft, encodeDraft });
  current.current = { revision, draft, dirty, baseDraft, encodeDraft };
  const acknowledged = useRef<{ revision: number; draft: T } | null>(null);
  const failed = useRef<{ revision: number; draft: T } | null>(null);
  const writing = useRef(false),
    lastAttempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    try {
      const rows = (await api(
        `drafts?kind=${kind}&resourceId=${resourceId}`,
        "GET",
        undefined,
        undefined,
        controller.signal,
      )) as DraftSummary[];
      if (!controller.signal.aborted && mounted.current) {
        setCandidates(rows.filter((row) => row.id !== owned.current.id));
        setListError("");
      }
    } catch (e) {
      if (!controller.signal.aborted && mounted.current)
        setListError((e as Error).message);
    }
  }, [kind, resourceId]);
  const ready = revision !== undefined;
  useEffect(() => {
    mounted.current = true;
    if (ready) void refresh();
    return () => {
      mounted.current = false;
      read.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ready, refresh]);

  const discard = useCallback(
    async (id: string, expectedSequence?: number) => {
      await api(`drafts/${id}/discard`, "POST", {
        kind,
        resourceId,
        ...(expectedSequence === undefined ? {} : { expectedSequence }),
      });
    },
    [kind, resourceId],
  );
  const clear = useCallback(async () => {
    const previous = owned.current,
      used = recovered.current;
    owned.current = { id: crypto.randomUUID(), sequence: 0, attempted: false };
    recovered.current = null;
    acknowledged.current = null;
    failed.current = null;
    writing.current = false;
    if (timer.current) clearTimeout(timer.current);
    setStage("idle");
    setError("");
    setSavedAt("");
    try {
      if (previous.attempted) await discard(previous.id);
      if (used) {
        try {
          await discard(used.id, used.sequence);
        } catch (e) {
          if ((e as { code?: string }).code !== "CONFLICT") throw e;
        }
      }
      if (mounted.current) await refresh();
    } catch {
      if (mounted.current)
        setError(
          document.documentElement.lang === "ru"
            ? "Материал сохранён, но резервная копия пока осталась в аккаунте. Её можно удалить из списка."
            : "Материал сақталды, бірақ сақтық көшірме аккаунтта қалды. Оны тізімнен жоюға болады.",
        );
    }
  }, [discard, refresh]);

  const saveNow = useCallback(async () => {
    const snapshot = current.current;
    if (
      !snapshot.dirty ||
      !snapshot.draft ||
      !snapshot.revision ||
      writing.current ||
      !mounted.current
    )
      return;
    if (timer.current) clearTimeout(timer.current);
    const slot = owned.current;
    slot.attempted = true;
    slot.sequence++;
    writing.current = true;
    lastAttempt.current = Date.now();
    failed.current = null;
    setStage("saving");
    setError("");
    try {
      const result = (await api("drafts", "POST", {
        id: slot.id,
        sequence: slot.sequence,
        kind,
        resourceId,
        baseRevision: snapshot.revision,
        draft:
          snapshot.baseDraft && snapshot.encodeDraft
            ? snapshot.encodeDraft(snapshot.baseDraft, snapshot.draft)
            : snapshot.draft,
      })) as DraftSummary;
      if (!mounted.current || owned.current !== slot) return;
      acknowledged.current = {
        revision: snapshot.revision,
        draft: snapshot.draft,
      };
      setSavedAt(result.savedAt);
      setStage(
        current.current.revision === snapshot.revision &&
          draftsEqual(current.current.draft, snapshot.draft)
          ? "saved"
          : "pending",
      );
    } catch (e) {
      if (!mounted.current || owned.current !== slot) return;
      failed.current = { revision: snapshot.revision, draft: snapshot.draft };
      setError((e as Error).message);
      setStage("error");
    } finally {
      if (owned.current === slot) writing.current = false;
    }
  }, [kind, resourceId]);

  useEffect(() => {
    if (!ready) return;
    if (!dirty) {
      if (owned.current.attempted || recovered.current) void clear();
      return;
    }
    if (!enabled || !draft || !revision || writing.current) return;
    const same = (value: typeof acknowledged.current) =>
      value?.revision === revision && draftsEqual(value.draft, draft);
    if (same(acknowledged.current) || same(failed.current)) return;
    timer.current = setTimeout(
      () => {
        void saveNow();
      },
      Math.max(1500, lastAttempt.current + 5000 - Date.now()),
    );
    if (stage !== "pending") setStage("pending");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ready, dirty, draft, revision, enabled, stage, clear, saveNow]);

  const restore = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const result = (await api(
        `drafts/${id}`,
        "GET",
        undefined,
        undefined,
        signal,
      )) as StoredDraft<T>;
      if (signal?.aborted || !mounted.current)
        throw new DOMException("Recovery cancelled", "AbortError");
      if (result.kind !== kind || result.resourceId !== resourceId)
        throw new Error(
          document.documentElement.lang === "ru"
            ? "Не удалось открыть выбранный черновик. Обновите список."
            : "Таңдалған нобай ашылмады. Тізімді жаңартыңыз.",
        );
      recovered.current = result;
      return result;
    },
    [kind, resourceId],
  );
  const remove = useCallback(
    async (row: DraftSummary) => {
      await discard(row.id, row.sequence);
      setError("");
      await refresh();
    },
    [discard, refresh],
  );
  return {
    stage:
      dirty &&
      stage === "saved" &&
      (acknowledged.current?.revision !== revision ||
        !draftsEqual(acknowledged.current?.draft, draft))
        ? ("pending" as const)
        : stage,
    error,
    savedAt,
    candidates,
    listError,
    refresh,
    saveNow,
    restore,
    remove,
  };
}
