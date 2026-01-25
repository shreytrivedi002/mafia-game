import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/relayStore";
import clientPromise from "@/lib/mongodb";

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/mongodb(\+srv)?:\/\/[^ \n)]+/gi, "mongodb://***")
    .slice(0, 300);
}

function requestId(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

const MASTER_STALE_MS = 15000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gameId?: string;
      playerId?: string;
      token?: string;
    };

    if (!body.gameId || !body.playerId || !body.token) {
      return NextResponse.json(
        { error: "gameId, playerId, token required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Validate token against inbox registration
    const client = await clientPromise;
    const db = client.db("mafia");
    const inbox = await db.collection<{ _id: string; token: string }>("inbox").findOne({
      _id: `${body.gameId}:${body.playerId}`,
    });
    if (!inbox || inbox.token !== body.token) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const current = await getState(body.gameId);
    if (!current) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // If already master, just return.
    if (current.masterPlayerId === body.playerId) {
      return NextResponse.json(
        { state: current },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const now = Date.now();
    const stale = now - current.updatedAt > MASTER_STALE_MS;
    if (!stale) {
      return NextResponse.json(
        { error: "master_active", masterPlayerId: current.masterPlayerId },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Compare-and-set takeover: only succeed if master & updatedAt unchanged.
    const result = await db.collection<{ _id: string }>("games").updateOne(
      { _id: body.gameId, "state.masterPlayerId": current.masterPlayerId, "state.updatedAt": current.updatedAt },
      {
        $set: {
          "state.masterPlayerId": body.playerId,
          "state.updatedAt": now,
          updatedAt: now,
          gameId: body.gameId,
        },
        $inc: { "state.version": 1 },
      },
    );

    if (result.matchedCount !== 1) {
      const latest = await getState(body.gameId);
      return NextResponse.json(
        { error: "takeover_failed", state: latest ?? current },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const updated = await getState(body.gameId);
    if (!updated) {
      return NextResponse.json(
        { error: "internal_error" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { state: updated },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const id = requestId();
    console.error(`[${id}] POST /api/relay/master error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      { error: "internal_error", requestId: id, details: { name: err?.name, code: err?.code, message } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

