import { NextResponse } from "next/server";
import type { GameState, RelayEvent, RelayEventWithIndex } from "@/lib/types";
import { addEvent, getEvents, getState, setState } from "@/lib/relayStore";

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/mongodb(\+srv)?:\/\/[^ \n)]+/gi, "mongodb://***")
    .slice(0, 300);
}

function requestId(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

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
    const id = requestId();
    console.error(`[${id}] GET /api/relay/events error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      { error: "internal_error", requestId: id, details: { name: err?.name, code: err?.code, message } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gameId?: string; event?: RelayEvent };
    if (!body.gameId || !body.event) {
      return NextResponse.json({ error: "gameId and event required" }, { status: 400 });
    }
    const event = body.event;

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

    // Simplify + stabilize: for JOIN events, also update lobby state server-side.
    // This prevents the "waiting for master" dead-end when the master isn't processing events quickly.
    if (event.type === "JOIN") {
      const current = await getState(body.gameId);
      if (current && current.phase === "LOBBY") {
        const already = current.players.some((p) => p.id === event.payload.playerId);
        if (!already) {
          const now = Date.now();
          const next: GameState = {
            ...current,
            // Keep existing master; don't replace it on join.
            players: [
              ...current.players,
              {
                id: event.payload.playerId,
                name: event.payload.name,
                alive: true,
                joinedAt: now,
                lastSeenAt: now,
              },
            ],
            version: current.version + 1,
            updatedAt: now,
          };
          await setState(body.gameId, next);
        }
      }
    }

    return NextResponse.json({ index });
  } catch (error) {
    const id = requestId();
    console.error(`[${id}] POST /api/relay/events error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      { error: "internal_error", requestId: id, details: { name: err?.name, code: err?.code, message } },
      { status: 500 },
    );
  }
}
