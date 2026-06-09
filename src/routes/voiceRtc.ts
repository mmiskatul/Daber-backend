import { Router } from "express";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";
import { config } from "../config";
import { allocateVoiceRtcSession } from "../voice/gatewayAllocator";
import { voiceSessionStore } from "../voice/sessionStore";
import { ReconnectVoiceRtcSessionInput } from "../voice/types";

type CreateSessionBody = {
  scenarioSessionId?: string;
  offerSdp?: string;
  referenceText?: string;
};

type ReconnectSessionBody = {
  offerSdp?: string;
};

const router = Router();

function getRequiredString(value: unknown, code: string, message: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : (() => {
    throw new AppError(400, code, message);
  })();
}

router.post(
  "/rtc/session",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    if (!config.voiceFeatureRtcEnabled) {
      throw new AppError(501, "VOICE_RTC_DISABLED", "RTC voice scaffolding is present but disabled.");
    }

    const body = (req.body ?? {}) as CreateSessionBody;
    const scenarioSessionId = getRequiredString(
      body.scenarioSessionId,
      "MISSING_SCENARIO_SESSION_ID",
      "RTC voice session requires a scenarioSessionId."
    );
    const offerSdp = getRequiredString(body.offerSdp, "MISSING_OFFER_SDP", "RTC voice session requires an offerSdp.");

    const details = await allocateVoiceRtcSession({
      uid: req.firebaseUser.uid,
      scenarioSessionId,
      offerSdp,
      referenceText: typeof body.referenceText === "string" ? body.referenceText.trim() : undefined
    });

    res.status(200).json({
      status: true,
      message: "RTC voice session scaffold created.",
      details
    });
  })
);

router.post(
  "/rtc/session/:voiceSessionId/reconnect",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const body = (req.body ?? {}) as ReconnectSessionBody;
    const reconnectInput: ReconnectVoiceRtcSessionInput = {
      voiceSessionId: getRequiredString(req.params.voiceSessionId, "MISSING_VOICE_SESSION_ID", "Missing voiceSessionId."),
      offerSdp: getRequiredString(body.offerSdp, "MISSING_OFFER_SDP", "RTC reconnect requires an offerSdp.")
    };

    const session = await voiceSessionStore.get(reconnectInput.voiceSessionId);

    if (!session || session.uid !== req.firebaseUser.uid) {
      throw new AppError(404, "VOICE_SESSION_NOT_FOUND", "RTC voice session was not found.");
    }

    res.status(501).json({
      status: false,
      message: "RTC reconnect scaffold exists but is not implemented yet.",
      details: {
        code: "VOICE_RTC_RECONNECT_NOT_IMPLEMENTED",
        cause: {
          voiceSessionId: reconnectInput.voiceSessionId
        }
      }
    });
  })
);

router.delete(
  "/rtc/session/:voiceSessionId",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const voiceSessionId = getRequiredString(req.params.voiceSessionId, "MISSING_VOICE_SESSION_ID", "Missing voiceSessionId.");
    const session = await voiceSessionStore.get(voiceSessionId);

    if (session && session.uid === req.firebaseUser.uid) {
      await voiceSessionStore.delete(voiceSessionId);
    }

    res.status(200).json({
      status: true,
      message: "RTC voice session scaffold closed.",
      details: {
        voiceSessionId
      }
    });
  })
);

export default router;
