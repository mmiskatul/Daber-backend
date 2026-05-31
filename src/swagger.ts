import swaggerJsdoc from "swagger-jsdoc";

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Daber Backend API",
      version: "1.0.0",
      description: "Firebase-authenticated backend for storing Daber user records."
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Local development server"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        SyncUserRequest: {
          type: "object",
          properties: {
            firstName: { type: "string", nullable: true },
            lastName: { type: "string", nullable: true },
            phone: { type: "string", nullable: true },
            username: { type: "string", nullable: true },
            avatarUrl: { type: "string", nullable: true },
            displayName: { type: "string", nullable: true },
            photoURL: { type: "string", nullable: true }
          }
        },
        SyncUserResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                uid: { type: "string" },
                isNewUser: { type: "boolean" }
              }
            }
          }
        },
        ErrorResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: false },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                code: { type: "string" },
                cause: {}
              }
            }
          }
        },
        UserProfileData: {
          type: "object",
          properties: {
            uid: { type: "string" },
            email: { type: "string", nullable: true },
            emailVerified: { type: "boolean" },
            displayName: { type: "string", nullable: true },
            photoURL: { type: "string", nullable: true },
            provider: { type: "string", nullable: true },
            firstName: { type: "string", nullable: true },
            lastName: { type: "string", nullable: true },
            phone: { type: "string", nullable: true },
            username: { type: "string", nullable: true },
            avatarUrl: { type: "string", nullable: true }
          }
        },
        UserProfileResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              $ref: "#/components/schemas/UserProfileData"
            }
          }
        },
        OnboardingData: {
          type: "object",
          properties: {
            native: { type: "string", example: "English" },
            level: { type: "string", example: "A2" },
            goal: { type: "string", example: "travel" },
            voice: { type: "string", example: "dana" }
          }
        },
        OnboardingRequest: {
          $ref: "#/components/schemas/OnboardingData"
        },
        OnboardingResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              $ref: "#/components/schemas/OnboardingData"
            }
          }
        },
        ScenarioThemeData: {
          type: "object",
          properties: {
            id: { type: "string", example: "supermarket" },
            title: { type: "string", example: "Supermarket" },
            he: { type: "string", example: "בַּסּוּפֶּר" },
            heChar: { type: "string", example: "ס" },
            band: { type: "string", example: "A2–B1" },
            blurb: { type: "string" },
            locked: { type: "boolean" }
          }
        },
        ScenarioLaunchResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                provider: { type: "string", example: "openai" },
                providerConfigured: { type: "boolean" },
                theme: { $ref: "#/components/schemas/ScenarioThemeData" },
                tutorVoice: {
                  type: "object",
                  properties: {
                    id: { type: "string", example: "dana" },
                    name: { type: "string", example: "Dana" },
                    subtitle: { type: "string", example: "Warm, patient, direct." }
                  }
                },
                conversation: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    starterLine: { type: "string" },
                    promptSeed: { type: "string" }
                  }
                }
              }
            }
          }
        },
        ScenarioTurnData: {
          type: "object",
          properties: {
            role: { type: "string", example: "tutor" },
            text: { type: "string" },
            createdAt: { type: "string", example: "2026-05-26T12:00:00.000Z" },
            inputMode: { type: "string", nullable: true, example: "voice" },
            provider: { type: "string", nullable: true, example: "openai" },
            model: { type: "string", nullable: true, example: "gpt-4.1-mini" },
            liveModelCall: { type: "boolean", nullable: true, example: false },
            pronunciation: {
              nullable: true,
              $ref: "#/components/schemas/PronunciationData"
            }
          }
        },
        PronunciationData: {
          type: "object",
          properties: {
            overallScore: { type: "integer", example: 82 },
            accuracyScore: { type: "integer", example: 80 },
            fluencyScore: { type: "integer", example: 85 },
            feedback: { type: "string", example: "Stress the final word less and keep the vowel longer." },
            scoringMode: { type: "string", example: "audio" }
          }
        },
        ScenarioSessionResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              type: "object"
            }
          }
        },
        ScenarioMessageResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                provider: { type: "string", example: "openai" },
                providerConfigured: { type: "boolean" },
                model: { type: "string", example: "gpt-4.1-mini" },
                learnerTurn: { $ref: "#/components/schemas/ScenarioTurnData" },
                tutorTurn: { $ref: "#/components/schemas/ScenarioTurnData" }
              }
            }
          }
        },
        ScenarioVoiceResponse: {
          type: "object",
          properties: {
            status: { type: "boolean", example: true },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                provider: { type: "string", example: "openai" },
                providerConfigured: { type: "boolean" },
                model: { type: "string", example: "gpt-4o-mini-transcribe" },
                transcript: { type: "string", example: "Ani mevakesh beitzim bevakasha." },
                pronunciation: { $ref: "#/components/schemas/PronunciationData" },
                learnerTurn: { $ref: "#/components/schemas/ScenarioTurnData" },
                tutorTurn: { $ref: "#/components/schemas/ScenarioTurnData" }
              }
            }
          }
        }
      }
    }
  },
  apis: ["./src/server.ts", "./src/routes/*.ts"]
});

export default swaggerSpec;
