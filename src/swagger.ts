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
        }
      }
    }
  },
  apis: ["./src/server.ts", "./src/routes/*.ts"]
});

export default swaggerSpec;
