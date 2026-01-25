import { NextResponse } from "next/server";
import type { GameState, RelayEvent, RelayEventWithIndex } from "@/lib/types";
import { addEvent, getEvents, getState, setState } from "@/lib/relayStore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    const after = Number(searchParams.get("after") ?? "0");
    if (!gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const events = await getEvents(gameId, Number.isNaN(after) ? 0 : after);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("GET /api/relay/events error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gameId?: string; event?: RelayEvent };
    if (!body.gameId || !body.event) {
      return NextResponse.json({ error: "gameId and event required" }, { status: 400 });
    }

    // If a JOIN happens before the creator successfully publishes state (common with QR joins),
    // create a placeholder lobby state (version 0). The creator's real state (version 1+)
    // can safely overwrite it later.
    if (body.event.type === "JOIN") {
      const existing = await getState(body.gameId);
      if (!existing) {
        const now = Date.now();
        const placeholder: GameState = {
          id: body.gameId,
          status: "ACTIVE",
          phase: "LOBBY",
          currentNight: 0,
          phaseId: undefined,
          phaseStartedAt: now,
          settings: {
            nightSeconds: 60,
            daySeconds: 120,
            votingSeconds: 60,
            autoAdvance: true,
            revealRoleOnDeath: false,
          },
          masterPlayerId: body.event.payload.playerId,
          version: 0,
          players: [
            {
              id: body.event.payload.playerId,
              name: body.event.payload.name,
              alive: true,
              joinedAt: now,
              lastSeenAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };
        await setState(body.gameId, placeholder);
      }
    }

    const index = await addEvent(body.gameId, body.event);
    if (index === null) {
      return NextResponse.json({ duplicated: true }, { status: 200 });
    }

    return NextResponse.json({ index });
  } catch (error) {
    console.error("POST /api/relay/events error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
