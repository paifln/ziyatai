import type { Texts, UiLocale } from "../../lib/i18n";
export type GenerationEditorProps = {
  id: string;
  t: Texts;
  locale: UiLocale;
  jobs: any[];
  profileStyles: any;
  onError: (s: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  refresh: () => Promise<void>;
};
