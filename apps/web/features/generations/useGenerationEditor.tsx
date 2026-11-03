"use client";
import { useUnsavedChanges } from "../../lib/use-unsaved-changes";
import { useDraftState } from "../../lib/use-draft-state";
import { useConfirm } from "../../components/ui/ConfirmProvider";
import { useCallback, useEffect, useState, useRef } from "react";
import { useAccountApi } from "../../lib/account-client";
import {
  Styles,
  type GenerationDocument,
  type TaskDocument,
} from "../../../../packages/contracts";
import { usePolling } from "../../lib/use-polling";
import { type RevisionSnapshot } from "../../components/RevisionConflict";
import { useServerDraft } from "../../lib/use-server-draft";
import type { GenerationEditorProps } from "./types";
export function useGenerationEditor({
  id,
  t,
  locale,
  profileStyles,
  onError,
  onDirtyChange,
  onSaved,
  refresh,
}: GenerationEditorProps) {
  const api = useAccountApi();
  const confirm = useConfirm();
  const [generation, setGeneration] = useState<any>(),
    [document, setDocument] = useState<GenerationDocument>(),
    [versions, setVersions] = useState<any[]>([]),
    [working, setBusy] = useState(false),
    [mode, setMode] = useState<"review" | "edit" | "print">("review"),
    [audience, setAudience] = useState<"full" | "student">("full"),
    [styles, setStyles] = useState(Styles.parse(profileStyles)),
    [exportJobs, setExportJobs] = useState<any[]>([]),
    [report, setReport] = useState<any>();
  const [regenerationJob, setRegenerationJob] = useState("");
  const { dirty, setDirty, guard } = useDraftState();
  const readController = useRef<AbortController | null>(null);
  const [activeTask, setActiveTask] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  const [teacherReviewed, setTeacherReviewed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const busy = working || conflict;
  const baseline = useRef<GenerationDocument | undefined>(undefined);
  const backup = useServerDraft({
    kind: "generation",
    resourceId: id,
    revision: generation?.revision,
    draft: document,
    dirty,
    enabled: !busy,
  });
  const loadLatest = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<RevisionSnapshot<GenerationDocument>> => {
      const g = await api(
        `generations/${id}`,
        "GET",
        undefined,
        undefined,
        signal,
      );
      if (!g.document)
        throw new Error(
          locale === "ru"
            ? "Сохранённые задания пока недоступны."
            : "Сақталған тапсырмалар әзірге қолжетімсіз.",
        );
      return {
        revision: g.revision,
        status: g.status,
        reviewedAt: g.reviewed_at,
        validation: g.validation,
        draft: g.document,
      };
    },
    [api, id, locale],
  );
  useEffect(() => {
    setTeacherReviewed(false);
  }, [generation?.revision]);
  useEffect(() => {
    if (dirty) setTeacherReviewed(false);
  }, [dirty]);
  const requestKeys = useRef(new Map<string, string>());
  function requestKey(data: unknown) {
    const signature = JSON.stringify(data);
    if (!requestKeys.current.has(signature))
      requestKeys.current.set(signature, crypto.randomUUID());
    return requestKeys.current.get(signature)!;
  }
  const load = useCallback(
    async (savedDraft = false) => {
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const checkpoint = guard.checkpoint();
      setReadFailed(false);
      try {
        const g = await api(
          `generations/${id}`,
          "GET",
          undefined,
          undefined,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          !guard.canReplace(checkpoint, savedDraft)
        )
          return;
        setGeneration(g);
        setDirty(false);
        if (g.document) {
          baseline.current = g.document;
          setDocument(g.document);
          setReport(g.validation);
          const history = await api(
            `generations/${id}/versions`,
            "GET",
            undefined,
            undefined,
            controller.signal,
          );
          if (!controller.signal.aborted) setVersions(history);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setReadFailed(true);
          onError((e as Error).message);
        }
      }
    },
    [guard, api, id, setDirty, onError],
  );
  useEffect(() => {
    void load();
    return () => readController.current?.abort();
  }, [load]);
  usePolling(load, ["queued", "running"].includes(generation?.status));
  async function refreshExports(all = false) {
    const next = await Promise.all(
      exportJobs
        .filter((job) => all || ["queued", "running"].includes(job.status))
        .map(async (job) => ({ ...job, ...(await api(`jobs/${job.id}`)) })),
    );
    const byId = new Map(next.map((job) => [job.id, job]));
    setExportJobs((current) => current.map((job) => byId.get(job.id) ?? job));
  }
  usePolling(
    async () => {
      try {
        await refreshExports();
      } catch (e) {
        onError((e as Error).message);
      }
    },
    exportJobs.some((j) => ["queued", "running"].includes(j.status)),
  );
  useUnsavedChanges(dirty, onDirtyChange);
  usePolling(async () => {
    try {
      const result = await api(`jobs/${regenerationJob}`);
      if (["succeeded", "failed", "cancelled"].includes(result.status)) {
        setRegenerationJob("");
        setBusy(false);
        if (result.status === "succeeded") {
          await load();
          onSaved();
        } else onError(result.error?.message ?? t.failed);
        await refresh();
      }
    } catch (e) {
      setRegenerationJob("");
      setBusy(false);
      onError((e as Error).message);
    }
  }, !!regenerationJob);

  function changeTask(index: number, update: Partial<TaskDocument>) {
    setDocument({
      ...document!,
      tasks: document!.tasks.map((task, i) =>
        i === index ? { ...task, ...update } : task,
      ),
    });
    setDirty(true);
    setReport({ ...report, stale: true });
  }
  async function save() {
    if (!document || busy) return;
    setBusy(true);
    try {
      const saved = await api(`generations/${id}/document`, "PATCH", {
        revision: generation.revision,
        document,
      });
      // A failed refresh must not roll back the acknowledged revision.
      setGeneration((current: any) => ({
        ...current,
        revision: saved.revision,
        status: "needs_review",
        reviewed_at: null,
      }));
      setDirty(false);
      baseline.current = document;
      await load();
      onSaved();
    } catch (e) {
      if ((e as { code?: string }).code === "CONFLICT") setConflict(true);
      else onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: string) {
    setBusy(true);
    try {
      const data = {
        generationId: id,
        revision: generation.revision,
        format,
        audience,
        styles,
        teacherReviewed: !!generation.reviewed_at && !dirty,
      };
      const result = await api("exports", "POST", data, requestKey(data));
      setExportJobs((current) => [
        ...current.filter((job) => job.id !== result.jobId),
        {
          id: result.jobId,
          status: "queued",
          kind: "export",
          stage: "queued",
          result: { exportId: result.id },
          format,
        },
      ]);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!teacherReviewed || dirty || !document) return;
    setBusy(true);
    try {
      await api(`generations/${id}/approve`, "POST", {
        revision: generation.revision,
        teacherReviewed: true,
      });
      await load();
      onSaved();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function regenerate(task: TaskDocument) {
    if (dirty) return;
    setBusy(true);
    try {
      const j = await api(
        `generations/${id}/tasks/${task.id}/regenerate`,
        "POST",
        { revision: generation.revision },
        requestKey({ taskId: task.id, revision: generation.revision }),
      );
      setRegenerationJob(j.jobId);
      await refresh();
    } catch (e) {
      setBusy(false);
      onError((e as Error).message);
    }
  }
  function editTask(taskId: string) {
    setActiveTask(taskId);
    setMode("edit");
    requestAnimationFrame(() =>
      window.document
        .getElementById(`task-${taskId}`)
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus(),
    );
  }
  async function restoreVersion(revision: number) {
    if (busy) return;
    if (
      dirty &&
      !(await confirm(
        locale === "ru"
          ? "Заменить несохранённые правки выбранной версией? Текущие правки будут потеряны."
          : "Сақталмаған өзгерістерді таңдалған нұсқамен ауыстыру керек пе? Қазіргі өзгерістер жоғалады.",
      ))
    )
      return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const checkpoint = guard.checkpoint();
    setBusy(true);
    try {
      const old = await api(
        `generations/${id}?revision=${revision}`,
        "GET",
        undefined,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || !guard.canReplace(checkpoint, true))
        return;
      setDocument(old.document);
      setDirty(true);
      setReport({ ...old.validation, stale: true });
    } catch (error) {
      if (!controller.signal.aborted) onError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return {
    api,
    generation,
    setGeneration,
    document,
    setDocument,
    versions,
    working,
    setBusy,
    mode,
    setMode,
    audience,
    setAudience,
    styles,
    setStyles,
    exportJobs,
    report,
    setReport,
    regenerationJob,
    dirty,
    setDirty,
    readController,
    activeTask,
    setActiveTask,
    readFailed,
    teacherReviewed,
    setTeacherReviewed,
    conflict,
    setConflict,
    busy,
    baseline,
    backup,
    loadLatest,
    load,
    refreshExports,
    changeTask,
    save,
    exportFile,
    approve,
    regenerate,
    editTask,
    restoreVersion,
  };
}
export type GenerationEditorModel = ReturnType<typeof useGenerationEditor>;
