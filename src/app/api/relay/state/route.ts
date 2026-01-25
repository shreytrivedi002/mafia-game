import { NextResponse } from "next/server";
import type { GameState } from "@/lib/types";
import { getEvents, getState, setState } from "@/lib/relayStore";

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/mongodb(\+srv)?:\/\/[^ \n)]+/gi, "mongodb://***")
    .slice(0, 300);
}

function requestId(): string {
  // crypto.randomUUID is available in modern runtimes; fallback if not.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function mergePlayers(
  current: GameState["players"] | undefined,
  incoming: GameState["players"] | undefined,
): GameState["players"] {
  const byId = new Map<string, GameState["players"][number]>();
  for (const p of current ?? []) {
    byId.set(p.id, p);
  }
  for (const p of incoming ?? []) {
    byId.set(p.id, p); // incoming wins for same id
  }
  return [...byId.values()];
}

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
    const id = requestId();
    console.error(`[${id}] GET /api/relay/state error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      {
        error: "internal_error",
        requestId: id,
        details: { name: err?.name, code: err?.code, message },
      },
      { status: 500 },
    );
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

    const now = Date.now();
    const nextState: GameState = {
      ...body.state,
      // Never allow a publish to "drop" players that already joined.
      players: current ? mergePlayers(current.players, body.state.players) : body.state.players,
      // If settings are missing for any reason, preserve existing.
      settings: (body.state as any).settings ?? (current as any)?.settings,
      // Preserve phaseStartedAt if missing.
      phaseStartedAt: (body.state as any).phaseStartedAt ?? (current as any)?.phaseStartedAt ?? now,
      updatedAt: now,
    };
    await setState(body.gameId, nextState);

    return NextResponse.json({ state: nextState });
  } catch (error) {
    const id = requestId();
    console.error(`[${id}] POST /api/relay/state error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      {
        error: "internal_error",
        requestId: id,
        details: { name: err?.name, code: err?.code, message },
      },
      { status: 500 },
    );
  }
}
