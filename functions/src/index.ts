import * as functions from "firebase-functions/v1";
import {app} from "../../src/app";

export const api = functions
  .region("us-central1")
  .runWith({
    memory: "1GB",
    timeoutSeconds: 540,
  })
  .https.onRequest(app);
