import { NextResponse } from "next/server";
import type { GameState } from "@/lib/types";
import { getEvents, getState, setState } from "@/lib/relayStore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    if (!gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const state = await getState(gameId);
    if (!state) {
      // If state isn't present (common after serverless cold starts or transient writes),
      // reconstruct a minimal lobby state from JOIN events so clients can proceed.
      const events = await getEvents(gameId, 0);
      const joins = events
        .filter((e) => e.type === "JOIN")
        .map((e) => ({ playerId: e.payload.playerId, name: e.payload.name }));

      if (joins.length === 0) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }

      const now = Date.now();
      const playersById = new Map<string, { id: string; name: string }>();
      for (const join of joins) {
        if (!playersById.has(join.playerId)) {
          playersById.set(join.playerId, { id: join.playerId, name: join.name });
        }
      }

      const firstJoin = joins[0];
      const reconstructed: GameState = {
        id: gameId,
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
        masterPlayerId: firstJoin.playerId,
        version: 0,
        players: [...playersById.values()].map((p) => ({
          id: p.id,
          name: p.name,
          alive: true,
          joinedAt: now,
          lastSeenAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      };

      await setState(gameId, reconstructed);
      return NextResponse.json({ state: reconstructed });
    }

    return NextResponse.json({ state });
  } catch (error) {
    console.error("GET /api/relay/state error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gameId?: string; state?: GameState };
    if (!body.gameId || !body.state) {
      return NextResponse.json({ error: "gameId and state required" }, { status: 400 });
    }

    const current = await getState(body.gameId);
    if (current && body.state.version <= current.version) {
      return NextResponse.json({ state: current, ignored: true }, { status: 200 });
    }

    const nextState = {
      ...body.state,
      updatedAt: Date.now(),
    };
    await setState(body.gameId, nextState);

    return NextResponse.json({ state: nextState });
  } catch (error) {
    console.error("POST /api/relay/state error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
