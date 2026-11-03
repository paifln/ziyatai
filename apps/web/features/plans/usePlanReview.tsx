"use client";
import { useUnsavedChanges } from "../../lib/use-unsaved-changes";
import { useDraftState } from "../../lib/use-draft-state";
import { useConfirm } from "../../components/ui/ConfirmProvider";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAccountApi } from "../../lib/account-client";
import type { KtpRow } from "../../../../packages/contracts";
import { usePolling } from "../../lib/use-polling";
import {
  planIssues,
  normalizePlanRows,
  type PlanIssueField,
} from "../../../../packages/domain/plan-review";
import { rowGrade } from "../../../../packages/domain/grades";
import { type RevisionSnapshot } from "../../components/RevisionConflict";
import type { PlanDraft } from "../../../../packages/contracts/drafts";
import { useServerDraft } from "../../lib/use-server-draft";
import { compactPlanDraft } from "../../../../packages/domain/draft-payload";
import type { PlanReviewProps } from "./types";
export function usePlanReview({
  id,
  onError,
  onDirtyChange,
  onSaved,
}: PlanReviewProps) {
  const api = useAccountApi();
  const confirm = useConfirm();
  const [plan, setPlan] = useState<any>(),
    [rows, setRows] = useState<KtpRow[]>([]),
    [grade, setGrade] = useState<number | null>(null),
    [year, setYear] = useState(""),
    [working, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [quarter, setQuarter] = useState(""),
    [sort, setSort] = useState("original"),
    [showWarnings, setShowWarnings] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const { dirty, setDirty, guard } = useDraftState();
  const readController = useRef<AbortController | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const loadedPlan = useRef("");
  const [datesBeforeSkip, setDatesBeforeSkip] = useState<KtpRow[] | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [focusedRow, setFocusedRow] = useState("");
  const [focusIssue, setFocusIssue] = useState<{
    id: string;
    field: PlanIssueField;
  }>();
  const issues = useMemo(() => planIssues(rows, grade), [rows, grade]);
  const incomplete = useMemo(
    () => new Set(issues.map((issue) => issue.id)),
    [issues],
  );
  useEffect(() => {
    if (!focusIssue) return;
    const row = document.getElementById(`ktp-row-${focusIssue.id}`);
    const field = row?.querySelector<HTMLElement>(
      `[data-review-field="${focusIssue.field}"]`,
    );
    if (!field) return;
    const details = field.closest("details");
    if (details) details.open = true;
    field.focus();
    field.scrollIntoView({ block: "center" });
    setFocusIssue(undefined);
  }, [
    focusIssue,
    onlyIncomplete,
    page,
    query,
    quarter,
    sheet,
    classFilter,
    sort,
  ]);
  const [conflict, setConflict] = useState(false);
  const busy = working || conflict;
  const baseline = useRef<PlanDraft | undefined>(undefined);
  const draft = useMemo(
    () => ({ rows, grade, schoolYear: year }),
    [rows, grade, year],
  );
  const backup = useServerDraft({
    kind: "ktp",
    resourceId: id,
    revision: plan?.revision,
    draft,
    baseDraft: baseline.current,
    encodeDraft: compactPlanDraft,
    dirty,
    enabled: !busy,
  });
  const loadLatest = useCallback(
    async (signal: AbortSignal): Promise<RevisionSnapshot<PlanDraft>> => {
      const p = await api(`ktp/${id}`, "GET", undefined, undefined, signal);
      return {
        revision: p.revision,
        status: p.status,
        draft: {
          rows: p.rows ?? [],
          grade: p.grade,
          schoolYear: p.school_year ?? "",
        },
      };
    },
    [api, id],
  );
  const load = useCallback(
    async (savedDraft = false) => {
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const checkpoint = guard.checkpoint();
      setReadFailed(false);
      try {
        const p = await api(
          `ktp/${id}`,
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
        setPlan(p);
        baseline.current = {
          rows: p.rows ?? [],
          grade: p.grade,
          schoolYear: p.school_year ?? "",
        };
        setRows(p.rows ?? []);
        setGrade(p.grade);
        if (loadedPlan.current !== id) {
          setClassFilter(p.grade ? String(p.grade) : "");
          setSheet("");
          loadedPlan.current = id;
        }
        setYear(p.school_year ?? "");
        setDatesBeforeSkip(null);
        setDirty(false);
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
  usePolling(load, plan?.status === "extracting");
  useUnsavedChanges(dirty, onDirtyChange);

  function update(index: number, key: keyof KtpRow, value: string) {
    setRows(
      rows.map((r, i) =>
        i === index
          ? {
              ...normalizePlanRows([
                {
                  ...r,
                  [key]: value,
                  dateSkipped: key === "dateRaw" ? false : r.dateSkipped,
                  goalsSkipped: key === "goals" ? false : r.goalsSkipped,
                  source: { ...r.source, method: "manual", confidence: 0.5 },
                },
              ])[0],
              sourceOrder: i + 1,
            }
          : r,
      ),
    );
    setDirty(true);
  }
  function add(after?: number) {
    setOnlyIncomplete(false);
    setQuery("");
    setQuarter("");
    setSort("original");
    const following = after === undefined ? undefined : rows[after];
    const inheritedGrade = following
      ? rowGrade(following, grade)
      : classFilter && classFilter !== "unknown"
        ? Number(classFilter)
        : classFilter === "unknown"
          ? null
          : grade;
    const inheritedSheet = following?.source.sheet ?? (sheet || null);
    const matching = rows.filter(
      (r) =>
        (!sheet || r.source.sheet === sheet) &&
        (!classFilter ||
          String(rowGrade(r, grade) ?? "unknown") === classFilter),
    );
    const position = following
      ? matching.findIndex((r) => r.id === following.id) + 1
      : matching.length;
    setPage(Math.floor(position / 25));
    const r: KtpRow = {
      id: crypto.randomUUID(),
      grade: inheritedGrade,
      sourceOrder: rows.length + 1,
      lessonNumberRaw: "",
      section: "",
      quarter: "",
      topic: "",
      goals: "",
      objectiveCodes: [],
      lessonGoals: "",
      hours: "",
      dateRaw: "",
      dateStart: null,
      dateEnd: null,
      notes: "",
      warnings: [],
      source: {
        page: null,
        sheet: inheritedSheet,
        range: "manual",
        fragment: "",
        method: "manual",
        confidence: 0.5,
      },
    };
    const copy = [...rows];
    copy.splice(after === undefined ? copy.length : after + 1, 0, r);
    setRows(copy);
    setDirty(true);
  }
  async function save(confirm = false) {
    if (busy) return;
    setBusy(true);
    try {
      const canonicalRows = normalizePlanRows(rows);
      setRows(canonicalRows);
      const saved = await api(
        `ktp/${id}/${confirm ? "confirm" : "rows"}`,
        confirm ? "POST" : "PATCH",
        {
          revision: plan.revision,
          rows: canonicalRows,
          grade,
          schoolYear: year,
        },
      );
      // The write is committed even if the following read fails.
      setPlan((current: any) => ({
        ...current,
        revision: saved.revision,
        status: confirm ? "confirmed" : "review",
      }));
      setDirty(false);
      baseline.current = { rows: canonicalRows, grade, schoolYear: year };
      await load();
      onSaved();
    } catch (e) {
      if ((e as { code?: string }).code === "CONFLICT") setConflict(true);
      else onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    api,
    confirm,
    plan,
    setPlan,
    rows,
    setRows,
    grade,
    setGrade,
    year,
    setYear,
    working,
    setBusy,
    query,
    setQuery,
    quarter,
    setQuarter,
    sort,
    setSort,
    showWarnings,
    setShowWarnings,
    previewPage,
    setPreviewPage,
    sourceAvailable,
    setSourceAvailable,
    dirty,
    setDirty,
    readController,
    previewFailed,
    setPreviewFailed,
    readFailed,
    page,
    setPage,
    sheet,
    setSheet,
    classFilter,
    setClassFilter,
    datesBeforeSkip,
    setDatesBeforeSkip,
    onlyIncomplete,
    setOnlyIncomplete,
    focusedRow,
    setFocusedRow,
    setFocusIssue,
    issues,
    incomplete,
    conflict,
    setConflict,
    busy,
    baseline,
    draft,
    backup,
    loadLatest,
    load,
    update,
    add,
    save,
  };
}
export type PlanReviewModel = ReturnType<typeof usePlanReview>;
