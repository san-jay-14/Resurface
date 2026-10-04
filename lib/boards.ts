import { api } from "@/lib/api";
import type {
  BoardMember,
  BoardReaction,
  BoardSave,
  BoardSummary,
  Collection,
  SaveCategory,
} from "@/lib/database.types";
import type { MapResult } from "@/lib/saves";

export async function listBoards(): Promise<BoardSummary[]> {
  const { boards } = await api.get<{ boards: BoardSummary[] }>("/boards");
  return boards;
}

export async function createBoard(
  name: string,
  opts: { description?: string; requiresLocation?: boolean } = {},
): Promise<Collection> {
  const { board } = await api.post<{ board: Collection }>("/boards", {
    name: name.trim(),
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.requiresLocation !== undefined ? { requires_location: opts.requiresLocation } : {}),
  });
  return board;
}

export const deleteBoard = (id: string) => api.delete(`/boards/${id}`);

export interface BoardDetail {
  board: BoardSummary;
  saves: BoardSave[];
  members: BoardMember[];
  reactions: BoardReaction[];
}

export const getBoard = (id: string) => api.get<BoardDetail>(`/boards/${id}`);

export const addSaveToBoard = (boardId: string, saveId: string) =>
  api.post(`/boards/${boardId}/saves`, { save_id: saveId });

export const removeSaveFromBoard = (boardId: string, saveId: string) =>
  api.delete(`/boards/${boardId}/saves/${saveId}`);

/** Turn a board into a shared one. The invite code is generated (and kept stable) server-side. */
export async function shareBoard(id: string): Promise<Collection> {
  const { board } = await api.post<{ board: Collection }>(`/boards/${id}/share`);
  return board;
}

/**
 * Category boards (Places, Recipes, ...) aren't real boards: to share one, the server finds or
 * creates a shadow board for that category, syncs the saves into it and shares it.
 */
export async function shareCategoryBoard(
  category: SaveCategory,
  label: string,
): Promise<Collection> {
  const { board } = await api.post<{ board: Collection }>("/boards/category-share", {
    category,
    label,
  });
  return board;
}

export interface JoinResult {
  status: "joined" | "already_member";
  board: { id: string; name: string; owner_id: string; is_shared: boolean; save_count: number };
}

/** Throws ApiError with code `invalid_invite_code` for an unknown code. */
export const joinBoard = (code: string) => api.post<JoinResult>("/boards/join", { code });

export const leaveBoard = (id: string) => api.delete(`/boards/${id}/members/me`);

export const setReaction = (boardId: string, saveId: string, reaction: "in" | "pass") =>
  api.put(`/boards/${boardId}/reactions`, { save_id: saveId, reaction });

export const removeReaction = (boardId: string, saveId: string) =>
  api.delete(`/boards/${boardId}/reactions/${saveId}`);

export async function fetchBoardMapSaves(id: string): Promise<MapResult> {
  const r = await api.get<{ mapped: MapResult["mapped"]; unmapped_count: number }>(
    `/boards/${id}/map`,
  );
  return { mapped: r.mapped, unmappedCount: r.unmapped_count };
}
