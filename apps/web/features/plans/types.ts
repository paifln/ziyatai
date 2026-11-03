import type { Texts, UiLocale } from "../../lib/i18n";
export type PlanReviewProps = {
  id: string;
  t: Texts;
  locale: UiLocale;
  onError: (s: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onGenerate: () => void;
  jobs: any[];
  refresh: () => Promise<void>;
  onBack: () => void;
};
