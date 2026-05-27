import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import {app} from "../../src/app";

setGlobalOptions({maxInstances: 10});

export const api = onRequest(
  {
    region: "us-central1",
    cors: true,
  },
  app,
);
