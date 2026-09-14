export type LiveOrderEditorState = {
  editing: boolean;
  saving: boolean;
  quickSaving: boolean;
};

export function shouldApplyLiveOrderSnapshot(
  state: LiveOrderEditorState
): boolean {
  return !state.editing && !state.saving && !state.quickSaving;
}
