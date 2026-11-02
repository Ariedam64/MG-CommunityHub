// api/roomPrivacy.ts
// Pure helpers for the public room lists and the hideNameInRoomLists setting.
// Imports types only, so it bundles under node for the checks.

import type { Room, RoomUserSlot } from "./types";

/**
 * A room as GET /rooms sends it. The public answer may leave out
 * last_updated_by_player_id, and never carries player_id or coins: the hub
 * reads none of them. A player who hides their name comes as
 * { name: "Anonymous", avatar_url: null }.
 */
export interface RoomDto {
  id: string;
  is_private: boolean;
  players_count?: number | null;
  last_updated_at: string;
  last_updated_by_player_id?: string | null;
  user_slots?: Array<{
    name: string;
    avatar_url?: string | null;
  }>;
}

export function mapRoomDto(r: RoomDto): Room {
  return {
    id: r.id,
    isPrivate: r.is_private,
    playersCount: r.players_count ?? 0,
    lastUpdatedAt: r.last_updated_at,
    lastUpdatedByPlayerId: r.last_updated_by_player_id ?? null,
    userSlots: Array.isArray(r.user_slots)
      ? r.user_slots.map((slot) => ({
          name: slot.name,
          avatarUrl: slot.avatar_url ?? null,
        }))
      : undefined,
  };
}

export interface RoomSlotView {
  kind: "avatar" | "placeholder" | "empty";
  avatarUrl: string | null;
  title: string | null;
}

/**
 * How one avatar slot of a room row looks. Accepts both avatarUrl (from
 * GET /rooms) and avatar_url (from the welcome payload).
 */
export function describeRoomSlot(
  slot: (Partial<RoomUserSlot> & { avatar_url?: string | null }) | null | undefined,
  index: number,
  playersCount: number,
): RoomSlotView {
  const avatarUrl = slot?.avatarUrl || slot?.avatar_url || null;
  if (slot && avatarUrl) {
    return { kind: "avatar", avatarUrl, title: slot.name || "Player" };
  }
  if (index < playersCount) {
    return { kind: "placeholder", avatarUrl: null, title: slot?.name || null };
  }
  return { kind: "empty", avatarUrl: null, title: null };
}

/**
 * The saved hideNameInRoomLists, or null when the backend does not send it
 * (the toggle then stays hidden).
 */
export function readHideNameInRoomLists(privacy: unknown): boolean | null {
  if (!privacy || typeof privacy !== "object") return null;
  const value = (privacy as { hideNameInRoomLists?: unknown }).hideNameInRoomLists;
  return typeof value === "boolean" ? value : null;
}
