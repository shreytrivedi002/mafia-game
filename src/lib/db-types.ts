import type { Action, GameState, SecretMessage, Vote } from "./types";

export type GameDoc = {
  _id: string;
  gameId: string;
  state: GameState;
  actions: Action[];
  rituals: Array<{ playerId: string; nightNumber: number; createdAt: number }>;
  votes: Vote[];
  nextEventIndex: number;
  updatedAt: number;
};

export type InboxDoc = {
  _id: string;
  gameId: string;
  playerId: string;
  token: string;
  messages: SecretMessage[];
  updatedAt: number;
};
