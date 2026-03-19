export type EditorWorkbenchAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "find"
  | "replace"
  | "selectAll"
  | "expandSelection"
  | "shrinkSelection"
  | "copyLineUp"
  | "copyLineDown"
  | "moveLineUp"
  | "moveLineDown"
  | "addCursorAbove"
  | "addCursorBelow"
  | "addCursorsToLineEnds"
  | "addNextOccurrence"
  | "addPreviousOccurrence"
  | "selectAllOccurrences"
  | "toggleLineComment"
  | "toggleBlockComment"
  | "emmetExpand"
  | "quickOutline"
  | "goToDefinition"
  | "goToDeclaration"
  | "goToTypeDefinition"
  | "goToImplementation"
  | "goToReferences"
  | "goToLine"
  | "goToBracket"
  | "nextProblem"
  | "previousProblem"
  | "formatDocument";

export const EDITOR_WORKBENCH_EVENT = "ncode:editor-workbench-action";

export function dispatchEditorWorkbenchAction(action: EditorWorkbenchAction) {
  window.dispatchEvent(new CustomEvent<EditorWorkbenchAction>(EDITOR_WORKBENCH_EVENT, { detail: action }));
}
