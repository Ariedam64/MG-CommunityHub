// ariesModAPI/endpoints/rooms.ts
// Endpoints pour les rooms publiques

import { httpGet } from "../client/http";
import type { Room } from "../types";
import { mapRoomDto, type RoomDto } from "../roomPrivacy";

/**
 * Récupère la liste des rooms publiques disponibles
 * @param limit - Nombre maximum de rooms à récupérer (défaut: 50)
 * @returns Liste des rooms publiques
 */
export async function fetchAvailableRooms(limit = 50): Promise<Room[]> {
  const { data } = await httpGet<RoomDto[]>("rooms", { limit });
  if (!data || !Array.isArray(data)) return [];

  return data.map((r) => mapRoomDto(r));
}
