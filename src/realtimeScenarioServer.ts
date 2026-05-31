import { randomUUID } from "crypto";
import type { Server as HttpServer } from "http";
import { FieldValue } from "firebase-admin/firestore";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { config } from "./config";
import admin from "./firebaseAdmin";
import { verifyJwt } from "./jwt";
import { generateScenarioTutorReply, generateScenarioVoiceReplyFromTranscript, transcribeScenarioVoice } from "./scenarioProviders";

const db = admin.firestore();

type AuthedSocket = Socket & {
  data: {
    user?: {
      uid: string;
      [key: string]: unknown;
    };
  };
};

function getSocketToken(socket: Socket): string {
  const authToken = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "";
  if (authToken) {
    return authToken;
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return "";
}

async function getOwnedSession(uid: string, sessionId: string) {
  const sessionRef = db.collection("users").doc(uid).collection("scenarioSessions").doc(sessionId);
  const snapshot = await sessionRef.get();

  if (!snapshot.exists) {
    throw new Error("Scenario session not found.");
  }

  return { sessionRef, session: snapshot.data() || {} };
}

function sessionRoom(uid: string, sessionId: string) {
  return `scenario:${uid}:${sessionId}`;
}

export function attachRealtimeScenarioServer(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    maxHttpBufferSize: 25e6,
    cors: {
      origin: "*"
    },
    transports: ["websocket", "polling"]
  });

  io.use((socket, next) => {
    try {
      const token = getSocketToken(socket);
      if (!token) {
        next(new Error("Missing access token."));
        return;
      }

      const decoded = verifyJwt(token, config.jwtAccessSecret);
      (socket as AuthedSocket).data.user = decoded;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Socket authentication failed."));
    }
  });

  io.on("connection", (socket) => {
    const authedSocket = socket as AuthedSocket;

    socket.on("scenario:join", async (payload: { sessionId?: string }, ack?: (value: { ok: boolean; error?: string }) => void) => {
      try {
        const uid = authedSocket.data.user?.uid;
        const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";

        if (!uid || !sessionId) {
          throw new Error("Missing sessionId.");
        }

        await getOwnedSession(uid, sessionId);
        await socket.join(sessionRoom(uid, sessionId));
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed to join session." });
      }
    });

    socket.on(
      "scenario:text_turn",
      async (
        payload: { sessionId?: string; requestId?: string; message?: string },
        ack?: (value: { ok: boolean; error?: string }) => void
      ) => {
        const uid = authedSocket.data.user?.uid;
        const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : randomUUID();
        const message = typeof payload?.message === "string" ? payload.message.trim() : "";

        try {
          if (!uid || !sessionId || !message) {
            throw new Error("Missing scenario text turn fields.");
          }

          const { sessionRef, session } = await getOwnedSession(uid, sessionId);
          const provider = session.provider === "openai" ? "openai" : config.scenarioProviderDefault;
          const tutorVoice = session.tutorVoice || { name: "Dana", subtitle: "Warm, patient, direct." };
          const theme = session.theme || { id: "supermarket", title: "Scenario" };
          const model = provider === "openai" ? config.openAiModel : config.geminiModel;

          const learnerTurn = {
            role: "learner",
            text: message,
            createdAt: new Date().toISOString(),
            inputMode: "text"
          };

          io.to(sessionRoom(uid, sessionId)).emit("scenario:learner_turn", { requestId, learnerTurn });
          io.to(sessionRoom(uid, sessionId)).emit("scenario:tutor_pending", {
            requestId,
            tutorName: tutorVoice.name || "Dana"
          });
          ack?.({ ok: true });

          let tutorReply;
          try {
            tutorReply = await generateScenarioTutorReply({
              provider,
              tutorName: tutorVoice.name || "Dana",
              tutorSubtitle: tutorVoice.subtitle || "",
              voice: tutorVoice.name || null,
              themeTitle: theme.title || "Scenario",
              themeId: theme.id || "supermarket",
              situation: session.variation?.situation || "",
              level: session.learnerProfile?.level || null,
              goal: session.learnerProfile?.goal || null,
              native: session.learnerProfile?.native || null,
              starterLine: session.conversation?.starterLine || "",
              priorTurns: Array.isArray(session.turns) ? session.turns : [],
              learnerMessage: message
            });
          } catch (providerError) {
            console.error("[realtime:text_turn] AI provider call failed:", providerError instanceof Error ? providerError.message : providerError);

            throw providerError instanceof Error ? providerError : new Error("Failed to process text turn.");

          }

          const tutorTurn = {
            role: "tutor",
            text: tutorReply.text,
            translation: tutorReply.translation || null,
            createdAt: new Date().toISOString(),
            provider,
            model: tutorReply.model || model,
            liveModelCall: tutorReply.liveModelCall
          };

          await sessionRef.set(
            {
              turns: FieldValue.arrayUnion(learnerTurn, tutorTurn),
              updatedAt: FieldValue.serverTimestamp(),
              lastLearnerMessage: message,
              lastTutorReply: tutorTurn.text
            },
            { merge: true }
          );

          io.to(sessionRoom(uid, sessionId)).emit("scenario:tutor_turn", { requestId, tutorTurn });
        } catch (error) {
          io.to(sessionRoom(uid || "", sessionId)).emit("scenario:error", {
            requestId,
            message: error instanceof Error ? error.message : "Failed to process text turn."
          });
          ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed to process text turn." });
        }
      }
    );

    socket.on(
      "scenario:voice_turn",
      async (
        payload: {
          sessionId?: string;
          requestId?: string;
          audioBase64?: string;
          mimeType?: string;
          fileName?: string;
          referenceText?: string;
        },
        ack?: (value: { ok: boolean; error?: string }) => void
      ) => {
        const uid = authedSocket.data.user?.uid;
        const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : randomUUID();
        const audioBase64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64.trim() : "";
        const mimeType = typeof payload?.mimeType === "string" && payload.mimeType.trim() ? payload.mimeType.trim() : "audio/mp4";
        const fileName = typeof payload?.fileName === "string" && payload.fileName.trim() ? payload.fileName.trim() : "learner-audio.m4a";
        const referenceText = typeof payload?.referenceText === "string" ? payload.referenceText.trim() : "";

        try {
          if (!uid || !sessionId || !audioBase64) {
            throw new Error("Missing scenario voice turn fields.");
          }

          const { sessionRef, session } = await getOwnedSession(uid, sessionId);
          const provider = session.provider === "openai" ? "openai" : config.scenarioProviderDefault;
          const tutorVoice = session.tutorVoice || { name: "Dana", subtitle: "Warm, patient, direct." };
          const theme = session.theme || { id: "supermarket", title: "Scenario" };
          const model = provider === "openai" ? config.openAiTranscriptionModel : config.geminiAudioModel;

          const transcriptResult = await transcribeScenarioVoice({
            provider,
            tutorName: tutorVoice.name || "Dana",
            tutorSubtitle: tutorVoice.subtitle || "",
            themeTitle: theme.title || "Scenario",
            themeId: theme.id || "supermarket",
            situation: session.variation?.situation || "",
            level: session.learnerProfile?.level || null,
            goal: session.learnerProfile?.goal || null,
            native: session.learnerProfile?.native || null,
            starterLine: session.conversation?.starterLine || "",
            priorTurns: Array.isArray(session.turns) ? session.turns : [],
            learnerMessage: "",
            audioBase64,
            mimeType,
            fileName,
            referenceText
          });

          const learnerBaseTurn = {
            role: "learner",
            text: transcriptResult.transcript,
            createdAt: new Date().toISOString(),
            inputMode: "voice"
          };

          io.to(sessionRoom(uid, sessionId)).emit("scenario:learner_turn", { requestId, learnerTurn: learnerBaseTurn });
          io.to(sessionRoom(uid, sessionId)).emit("scenario:tutor_pending", {
            requestId,
            tutorName: tutorVoice.name || "Dana"
          });
          ack?.({ ok: true });

          let pronunciation;
          let tutorReply;

          try {
            const result = await generateScenarioVoiceReplyFromTranscript({
              provider,
              tutorName: tutorVoice.name || "Dana",
              tutorSubtitle: tutorVoice.subtitle || "",
              voice: tutorVoice.name || null,
              themeTitle: theme.title || "Scenario",
              themeId: theme.id || "supermarket",
              situation: session.variation?.situation || "",
              level: session.learnerProfile?.level || null,
              goal: session.learnerProfile?.goal || null,
              native: session.learnerProfile?.native || null,
              starterLine: session.conversation?.starterLine || "",
              priorTurns: Array.isArray(session.turns) ? session.turns : [],
              transcript: transcriptResult.transcript,
              referenceText
            });
            pronunciation = result.pronunciation;
            tutorReply = result.tutorReply;
          } catch (providerError) {
            console.error("[realtime:voice_turn] AI provider call failed:", providerError instanceof Error ? providerError.message : providerError);

            throw providerError instanceof Error ? providerError : new Error("Failed to process voice turn.");

            pronunciation = {
              overallScore: 75,
              accuracyScore: 74,
              fluencyScore: 77,
              feedback: "Keep the target sound tighter and repeat the phrase more clearly.",
              scoringMode: "transcript" as const
            };
          }

          const learnerTurn = {
            ...learnerBaseTurn,
            pronunciation
          };

          const tutorTurn = {
            role: "tutor",
            text: tutorReply.text,
            translation: tutorReply.translation || null,
            createdAt: new Date().toISOString(),
            provider,
            model: tutorReply.model || model,
            liveModelCall: tutorReply.liveModelCall
          };

          await sessionRef.set(
            {
              turns: FieldValue.arrayUnion(learnerTurn, tutorTurn),
              updatedAt: FieldValue.serverTimestamp(),
              lastLearnerMessage: learnerTurn.text,
              lastTutorReply: tutorTurn.text,
              lastPronunciation: pronunciation
            },
            { merge: true }
          );

          io.to(sessionRoom(uid, sessionId)).emit("scenario:learner_turn_update", { requestId, learnerTurn });
          io.to(sessionRoom(uid, sessionId)).emit("scenario:tutor_turn", { requestId, tutorTurn });
        } catch (error) {
          io.to(sessionRoom(uid || "", sessionId)).emit("scenario:error", {
            requestId,
            message: error instanceof Error ? error.message : "Failed to process voice turn."
          });
          ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed to process voice turn." });
        }
      }
    );
  });

  return io;
}




