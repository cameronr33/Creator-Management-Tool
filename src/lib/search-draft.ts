export interface SearchDraft { draft: string; url: string; pending: string[] }
export function searchDraft(state: SearchDraft, event: { type: "edit" | "submit" | "url"; value: string }): SearchDraft {
  if (event.type === "edit") return { ...state, draft: event.value };
  if (event.type === "submit") return { ...state, pending: [...state.pending, event.value] };
  const ownResponse = state.pending.indexOf(event.value);
  return ownResponse >= 0
    ? { ...state, url: event.value, pending: state.pending.slice(ownResponse + 1) }
    : { draft: event.value, url: event.value, pending: [] };
}
