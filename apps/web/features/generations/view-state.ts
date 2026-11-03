import type { GenerationEditorModel } from "./useGenerationEditor";
import type { GenerationEditorProps } from "./types";
export type GenerationEditorViewState = Omit<
  GenerationEditorModel,
  "document"
> &
  GenerationEditorProps & {
    document: NonNullable<GenerationEditorModel["document"]>;
  };
