/** A read may replace a draft only if no edits have happened since it began. */
export class DraftGuard {
  private edits = 0;
  private dirty = false;
  mark(dirty: boolean) {
    this.dirty = dirty;
    if (dirty) this.edits++;
  }
  checkpoint() {
    return this.edits;
  }
  canReplace(checkpoint: number, savedDraft = false) {
    return checkpoint === this.edits && (savedDraft || !this.dirty);
  }
}
