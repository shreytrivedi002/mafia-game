import { Schema, model, models } from "mongoose";

const EventSchema = new Schema({
    id: String,
    type: String, // JOIN, ACTION, etc.
    createdAt: Number,
    payload: Schema.Types.Mixed,
    index: Number,
}, { _id: false });

const InboxSchema = new Schema({
    token: String,
    messages: [Schema.Types.Mixed],
}, { _id: false });

const GameSchema = new Schema({
    gameId: { type: String, required: true, unique: true, index: true },
    state: { type: Schema.Types.Mixed, default: null },
    events: { type: [EventSchema], default: [] },
    eventIds: { type: [String], default: [] },
    // Using a Map for inbox: keys are playerIds, values are { token, messages }
    inbox: { type: Map, of: InboxSchema, default: {} },
    nextEventIndex: { type: Number, default: 1 },
    updatedAt: { type: Number, default: Date.now },
});

// Avoid recompiling model during hot-reload
export const GameModel = models.Game || model("Game", GameSchema);
