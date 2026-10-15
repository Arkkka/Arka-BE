type OpenApiObject = Record<string, unknown>;

const ref = (name: string): OpenApiObject => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name: string): OpenApiObject => ({ $ref: `#/components/responses/${name}` });
const parameterRef = (name: string): OpenApiObject => ({ $ref: `#/components/parameters/${name}` });
const jsonContent = (schema: OpenApiObject, example?: unknown): OpenApiObject => ({
  content: {
    'application/json': {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});
const success = (description: string, schema: OpenApiObject, example?: unknown): OpenApiObject => ({
  description,
  ...jsonContent(schema, example),
});
const body = (schema: OpenApiObject, example?: unknown): OpenApiObject => ({
  required: true,
  ...jsonContent(schema, example),
});
const pdfSuccess = (description: string): OpenApiObject => ({
  description,
  headers: {
    'Content-Disposition': { schema: { type: 'string' } },
    'Content-Length': { schema: { type: 'integer' } },
  },
  content: {
    'application/pdf': { schema: { type: 'string', format: 'binary' } },
  },
});

const security = [{ sessionCookie: [] }];
const standardErrors = {
  '400': responseRef('BadRequest'),
  '401': responseRef('Unauthorized'),
  '429': responseRef('RateLimited'),
  '500': responseRef('InternalError'),
};
const institutionErrors = {
  ...standardErrors,
  '403': responseRef('Forbidden'),
};
const mutationParameters = [parameterRef('CsrfToken')];
const publicParticipantId = 'participant_ZjR3M1RjV2F5dTVKcGx3';
const sessionId = '018f2f6e-7b23-7f6b-9238-0242ac120002';
const timestamp = '2026-07-29T12:00:00.000Z';

export const arkaOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Arka API',
    version: '0.1.0',
    summary: 'Server-authoritative rehabilitation session API',
    description:
      'REST API for institution-scoped participants, devices, preparations, game sessions, dashboards, and onboarding. Authentication endpoints are documented in the Authentication schema available from the selector. Protected endpoints use the Better Auth HTTP-only session cookie. Mutations also require the X-CSRF-Token returned by GET /api/v1/me or GET /api/v1/auth/onboarding. WebSocket contracts are exposed as component schemas and under x-websocket-endpoints because OpenAPI does not define WebSocket frame semantics.',
  },
  servers: [{ url: '/', description: 'Current Arka backend origin' }],
  tags: [
    { name: 'System', description: 'Liveness, dependency readiness, and API capabilities.' },
    { name: 'Account', description: 'Current account and institution onboarding.' },
    { name: 'Dashboard', description: 'Institution-scoped operational summaries.' },
    { name: 'Participants', description: 'Opaque participant identity, profile, and history.' },
    { name: 'Devices', description: 'Institution device inventory and readiness.' },
    { name: 'Games', description: 'Server-authoritative preparation and game lifecycle.' },
  ],
  paths: {
    '/healthz': {
      get: {
        tags: ['System'],
        summary: 'Check process liveness',
        operationId: 'getHealth',
        security: [],
        responses: {
          '200': success('The backend process is alive.', ref('HealthStatus'), { status: 'ok' }),
          '500': responseRef('InternalError'),
        },
      },
    },
    '/readyz': {
      get: {
        tags: ['System'],
        summary: 'Check PostgreSQL and Redis readiness',
        operationId: 'getReadiness',
        security: [],
        responses: {
          '200': success('All required dependencies are ready.', ref('ReadinessStatus'), {
            status: 'ready',
          }),
          '503': success('At least one required dependency is unavailable.', ref('ReadinessStatus'), {
            status: 'unavailable',
          }),
        },
      },
    },
    '/api/v1/auth/capabilities': {
      get: {
        tags: ['System'],
        summary: 'Get enabled authentication methods',
        operationId: 'getAuthCapabilities',
        security: [],
        responses: {
          '200': success('Authentication capabilities.', ref('AuthCapabilities'), {
            emailPassword: true,
            registration: true,
            socialProviders: { google: true },
          }),
          '500': responseRef('InternalError'),
        },
      },
    },
    '/api/v1/me': {
      get: {
        tags: ['Account'],
        summary: 'Get the current onboarded account',
        description: 'Returns the active institution and a CSRF token for subsequent mutations.',
        operationId: 'getCurrentAccount',
        security,
        responses: {
          '200': success('Current account context.', ref('Me'), {
            user: {
              id: 'user_01K1ABCDEF',
              email: 'owner@example.org',
              name: 'Panti Sejahtera',
              image: null,
            },
            institution: {
              id: '018f2f6e-7b23-7f6b-9238-0242ac120003',
              name: 'Panti Sejahtera',
              status: 'ACTIVE',
            },
            session: { id: 'session_01K1ABCDEF', expiresAt: timestamp },
            csrfToken: 'replace-with-token-returned-by-the-api',
          }),
          '401': responseRef('Unauthorized'),
          '403': responseRef('OnboardingRequired'),
          '429': responseRef('RateLimited'),
          '500': responseRef('InternalError'),
        },
      },
    },
    '/api/v1/auth/onboarding': {
      get: {
        tags: ['Account'],
        summary: 'Get institution onboarding status',
        operationId: 'getInstitutionOnboarding',
        security,
        responses: {
          '200': success('Current onboarding status.', ref('InstitutionOnboardingStatus'), {
            required: true,
            user: { email: 'owner@example.org', name: 'Owner', image: null },
            institution: null,
            csrfToken: 'replace-with-token-returned-by-the-api',
          }),
          '401': responseRef('Unauthorized'),
          '429': responseRef('RateLimited'),
          '500': responseRef('InternalError'),
        },
      },
      post: {
        tags: ['Account'],
        summary: 'Complete institution onboarding',
        description: 'Creates the institution for a signed-in Google account that has not been onboarded.',
        operationId: 'completeInstitutionOnboarding',
        security,
        parameters: mutationParameters,
        requestBody: body(ref('InstitutionOnboardingRequest'), {
          institutionName: 'Panti Sejahtera',
        }),
        responses: {
          '200': success('Onboarding completed.', ref('InstitutionOnboardingStatus')),
          ...standardErrors,
          '403': responseRef('Forbidden'),
          '409': responseRef('Conflict'),
        },
      },
    },
    '/api/v1/profile': {
      patch: {
        tags: ['Auth'],
        summary: 'Update the current user profile and institution name',
        operationId: 'updateProfile',
        security,
        parameters: mutationParameters,
        requestBody: body(ref('UpdateProfileRequest'), {
          name: 'Adrian',
          image: 'https://images.example.com/profile.jpg',
          institutionName: 'Panti Sejahtera',
        }),
        responses: {
          '204': { description: 'Profile updated.' },
          ...institutionErrors,
        },
      },
    },
    '/api/v1/dashboard/summary': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get device readiness summary',
        operationId: 'getDashboardSummary',
        security,
        responses: {
          '200': success('Device readiness summary.', ref('DashboardSummary'), {
            readyDevices: 1,
            onlineDevices: 2,
            totalActiveDevices: 3,
            readinessMessage: '1 perangkat siap digunakan.',
          }),
          ...institutionErrors,
        },
      },
    },
    '/api/v1/dashboard/activity': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get participant and session activity',
        operationId: 'getDashboardActivity',
        security,
        responses: {
          '200': success('Institution activity summary.', ref('DashboardActivity')),
          ...institutionErrors,
        },
      },
    },
    '/api/v1/dashboard/progress': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get the institution rehabilitation progress board',
        description: 'Returns active participants alphabetically with personal progress and consistency. It does not rank participants or expose absolute scores.',
        operationId: 'getDashboardProgress',
        security,
        responses: {
          '200': success('Institution progress board.', ref('DashboardProgress')),
          ...institutionErrors,
        },
      },
    },
    '/api/v1/participants': {
      get: {
        tags: ['Participants'],
        summary: 'Search active participants',
        operationId: 'searchParticipants',
        security,
        parameters: [
          {
            in: 'query',
            name: 'query',
            required: false,
            schema: { type: 'string', maxLength: 100, default: '' },
          },
        ],
        responses: {
          '200': success('Matching active participants.', {
            type: 'array',
            maxItems: 20,
            items: ref('Participant'),
          }),
          ...institutionErrors,
        },
      },
      post: {
        tags: ['Participants'],
        summary: 'Create a participant with a generated reference',
        operationId: 'createParticipant',
        security,
        parameters: mutationParameters,
        requestBody: body(ref('CreateParticipantRequest'), { displayName: 'Andrian' }),
        responses: {
          '201': success('Participant created.', ref('Participant')),
          ...institutionErrors,
          '409': responseRef('Conflict'),
        },
      },
    },
    '/api/v1/participants/resolve': {
      post: {
        tags: ['Participants'],
        summary: 'Resolve a facility participant reference',
        description: 'Returns an opaque public participant handle without exposing the database UUID.',
        operationId: 'resolveParticipant',
        security,
        parameters: mutationParameters,
        requestBody: body(ref('ResolveParticipantRequest'), { participantReference: 'PST-001' }),
        responses: {
          '200': success('Participant resolved.', ref('ResolveParticipantResponse'), {
            participantId: publicParticipantId,
          }),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
    '/api/v1/participants/{participantId}': {
      get: {
        tags: ['Participants'],
        summary: 'Get a participant profile',
        operationId: 'getParticipant',
        security,
        parameters: [parameterRef('ParticipantId')],
        responses: {
          '200': success('Participant profile.', ref('Participant')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
      patch: {
        tags: ['Participants'],
        summary: 'Update a participant profile',
        operationId: 'updateParticipant',
        security,
        parameters: [parameterRef('ParticipantId'), parameterRef('CsrfToken')],
        requestBody: body(ref('UpdateParticipantRequest'), {
          displayName: 'Ibu Sari',
          status: 'ACTIVE',
        }),
        responses: {
          '200': success('Participant updated.', ref('Participant')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
        },
      },
    },
    '/api/v1/participants/{participantId}/report': {
      get: {
        tags: ['Participants'],
        summary: 'Download a participant PDF report',
        operationId: 'downloadParticipantReport',
        security,
        parameters: [parameterRef('ParticipantId'), parameterRef('ReportAudience')],
        responses: {
          '200': pdfSuccess('Participant report.'),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
    '/api/v1/participants/{participantId}/sessions': {
      get: {
        tags: ['Participants'],
        summary: 'List participant session history',
        description: 'Returns at most 10 sessions ordered newest first. Pass nextCursor unchanged to continue.',
        operationId: 'listParticipantSessions',
        security,
        parameters: [
          parameterRef('ParticipantId'),
          parameterRef('HistoryMode'),
          parameterRef('HistoryRuleVersion'),
          parameterRef('HistoryCursor'),
        ],
        responses: {
          '200': success('Participant session history.', ref('HistoryPage')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
    '/api/v1/participants/{participantId}/leaderboard': {
      get: {
        tags: ['Participants'],
        summary: 'Get a private participant leaderboard',
        description: 'Compares only this participant within the same mode and game rule version.',
        operationId: 'getParticipantLeaderboard',
        security,
        parameters: [
          parameterRef('ParticipantId'),
          parameterRef('LeaderboardMode'),
          parameterRef('LeaderboardRuleVersion'),
        ],
        responses: {
          '200': success('Participant leaderboard.', ref('Leaderboard')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
    '/api/v1/devices': {
      get: {
        tags: ['Devices'],
        summary: 'List institution devices',
        description:
          'Returns the GAME12 virtual device game12-primary (Arka Genggam) and MODE3 virtual device mode3-primary (Arka Ding Dong Dong), each with independent readiness.',
        operationId: 'listDevices',
        security,
        responses: {
          '200': success('Institution device inventory.', {
            type: 'array',
            items: ref('Device'),
          }),
          ...institutionErrors,
        },
      },
    },
    '/api/v1/game-preparations': {
      post: {
        tags: ['Games'],
        summary: 'Open a game preparation',
        description: 'Resolves or creates the participant, selects a compatible device, and starts setup.',
        operationId: 'createGamePreparation',
        security,
        parameters: mutationParameters,
        requestBody: body(ref('CreatePreparationRequest'), {
          mode: 'MOTOR_GRIP',
          displayName: 'Ibu Sari',
          participantReference: 'PST-001',
          privacyAcknowledged: true,
        }),
        responses: {
          '201': success('Preparation opened.', ref('Preparation')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
          '503': responseRef('ServiceUnavailable'),
        },
      },
    },
    '/api/v1/game-preparations/{preparationId}/status': {
      patch: {
        tags: ['Games'],
        summary: 'Cancel a game preparation',
        operationId: 'commandGamePreparation',
        security,
        parameters: [parameterRef('PreparationId'), parameterRef('CsrfToken')],
        requestBody: body(ref('PreparationStatusPatchRequest'), { command: 'CANCEL' }),
        responses: {
          '204': { description: 'Preparation cancelled.' },
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
    '/api/v1/game-sessions': {
      post: {
        tags: ['Games'],
        summary: 'Create a game session from a ready preparation',
        description: 'Idempotent per owner session and Idempotency-Key. Reusing a key with another preparation returns a conflict.',
        operationId: 'createGameSession',
        security,
        parameters: [parameterRef('CsrfToken'), parameterRef('IdempotencyKey')],
        requestBody: body(ref('CreateGameSessionRequest'), {
          preparationId: 'preparation_ZjR3M1RjV2F5dTVKcGx3',
        }),
        responses: {
          '201': success('Game session created.', ref('CreateGameSessionResponse'), {
            sessionId,
            status: 'BINDING',
            bindingDeadlineAt: timestamp,
          }),
          ...institutionErrors,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
          '503': responseRef('ServiceUnavailable'),
        },
      },
    },
    '/api/v1/game-sessions/{sessionId}/status': {
      patch: {
        tags: ['Games'],
        summary: 'Pause, resume, or abort a game session',
        operationId: 'commandGameSession',
        security,
        parameters: [parameterRef('SessionId'), parameterRef('CsrfToken')],
        requestBody: body(ref('SessionStatusPatchRequest'), { command: 'PAUSE' }),
        responses: {
          '200': success('Updated game session.', ref('GameSession')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
        },
      },
    },
    '/api/v1/game-sessions/{sessionId}/report': {
      get: {
        tags: ['Games'],
        summary: 'Download a saved game session PDF report',
        operationId: 'downloadGameSessionReport',
        security,
        parameters: [parameterRef('SessionId'), parameterRef('ReportAudience')],
        responses: {
          '200': pdfSuccess('Game session report.'),
          ...institutionErrors,
          '404': responseRef('NotFound'),
          '409': responseRef('Conflict'),
        },
      },
    },
    '/api/v1/game-sessions/{sessionId}': {
      get: {
        tags: ['Games'],
        summary: 'Get a game session and result',
        operationId: 'getGameSession',
        security,
        parameters: [parameterRef('SessionId')],
        responses: {
          '200': success('Game session snapshot.', ref('GameSession')),
          ...institutionErrors,
          '404': responseRef('NotFound'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description:
          'Better Auth HTTP-only session cookie. In production the cookie may use the __Secure- prefix. Swagger UI sends an existing same-origin cookie automatically; it cannot read or manually set an HTTP-only cookie.',
      },
    },
    parameters: {
      CsrfToken: {
        name: 'X-CSRF-Token',
        in: 'header',
        required: true,
        description: 'CSRF token returned by /api/v1/me or /api/v1/auth/onboarding.',
        schema: { type: 'string', minLength: 32 },
      },
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description: 'Unique key for creating one game session. Generate a fresh UUID per intent.',
        schema: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9._~-]+$' },
        example: '018f2f6e-7b23-7f6b-9238-0242ac120010',
      },
      ParticipantId: {
        name: 'participantId',
        in: 'path',
        required: true,
        description: 'Opaque public participant handle.',
        schema: ref('PublicId'),
        example: publicParticipantId,
      },
      PreparationId: {
        name: 'preparationId',
        in: 'path',
        required: true,
        schema: ref('PublicId'),
      },
      SessionId: {
        name: 'sessionId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        example: sessionId,
      },
      ReportAudience: {
        name: 'audience',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['participant', 'clinician'] },
      },
      HistoryMode: {
        name: 'mode',
        in: 'query',
        required: false,
        schema: ref('GameMode'),
      },
      HistoryRuleVersion: {
        name: 'ruleVersion',
        in: 'query',
        required: false,
        schema: { type: 'string', maxLength: 80 },
        example: 'motor-grip-v1',
      },
      HistoryCursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        description: 'Opaque signed cursor returned as nextCursor. Do not modify it.',
        schema: { type: 'string', maxLength: 256 },
      },
      LeaderboardMode: {
        name: 'mode',
        in: 'query',
        required: true,
        schema: ref('GameMode'),
      },
      LeaderboardRuleVersion: {
        name: 'ruleVersion',
        in: 'query',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 80 },
        example: 'motor-grip-v1',
      },
    },
    responses: {
      BadRequest: {
        description: 'Malformed input, invalid parameter, invalid cursor, or invalid idempotency key.',
        ...jsonContent(ref('ApiError'), {
          error: {
            code: 'validation_error',
            message: 'Periksa kembali data yang dikirim.',
            fields: { displayName: 'String must contain at least 1 character(s)' },
            requestId: 'request-id',
          },
        }),
      },
      Unauthorized: {
        description: 'The Better Auth session is missing, invalid, idle, or expired.',
        ...jsonContent(ref('ApiError'), {
          error: {
            code: 'unauthorized',
            message: 'Silakan masuk untuk melanjutkan.',
            requestId: 'request-id',
          },
        }),
      },
      Forbidden: {
        description: 'The account is authenticated but cannot perform this operation.',
        ...jsonContent(ref('ApiError')),
      },
      OnboardingRequired: {
        description: 'The signed-in Google account must complete institution onboarding.',
        ...jsonContent(ref('ApiError'), {
          error: {
            code: 'institution_onboarding_required',
            message: 'Lengkapi data institusi untuk melanjutkan.',
            requestId: 'request-id',
          },
        }),
      },
      NotFound: {
        description: 'The institution-scoped resource does not exist.',
        ...jsonContent(ref('ApiError')),
      },
      Conflict: {
        description: 'The requested mutation conflicts with current durable or runtime state.',
        ...jsonContent(ref('ApiError')),
      },
      RateLimited: {
        description: 'Rate limit exceeded. Inspect RateLimit-Limit and RateLimit-Remaining.',
        headers: {
          'RateLimit-Limit': { schema: { type: 'integer' } },
          'RateLimit-Remaining': { schema: { type: 'integer', minimum: 0 } },
        },
        ...jsonContent(ref('ApiError'), {
          error: {
            code: 'rate_limited',
            message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
            requestId: 'request-id',
          },
        }),
      },
      InternalError: {
        description: 'Unexpected server error.',
        ...jsonContent(ref('ApiError'), {
          error: {
            code: 'internal_error',
            message: 'Terjadi kesalahan pada server.',
            requestId: 'request-id',
          },
        }),
      },
      ServiceUnavailable: {
        description: 'A required device or runtime dependency is not currently available.',
        ...jsonContent(ref('ApiError')),
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 80 },
              message: { type: 'string', minLength: 1, maxLength: 240 },
              fields: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              requestId: { type: 'string' },
            },
          },
        },
      },
      HealthStatus: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', const: 'ok' } },
      },
      ReadinessStatus: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['ready', 'unavailable'] } },
      },
      AuthCapabilities: {
        type: 'object',
        additionalProperties: false,
        required: ['emailPassword', 'registration', 'socialProviders'],
        properties: {
          emailPassword: { type: 'boolean', const: true },
          registration: { type: 'boolean', const: true },
          socialProviders: {
            type: 'object',
            additionalProperties: false,
            required: ['google'],
            properties: { google: { type: 'boolean' } },
          },
        },
      },
      PublicId: {
        type: 'string',
        minLength: 20,
        maxLength: 128,
        pattern: '^[A-Za-z0-9_-]+$',
      },
      IsoDate: { type: 'string', format: 'date-time' },
      InstitutionName: { type: 'string', minLength: 2, maxLength: 120 },
      DisplayName: { type: 'string', minLength: 1, maxLength: 100 },
      ParticipantReference: {
        type: 'string',
        minLength: 2,
        maxLength: 64,
        description: 'Facility-controlled participant code using letters, digits, period, underscore, slash, or hyphen.',
      },
      GameMode: {
        type: 'string',
        enum: ['MOTOR_GRIP', 'GO_NO_GO', 'SEQUENCE_MEMORY'],
      },
      SessionStatus: {
        type: 'string',
        enum: [
          'BINDING',
          'COUNTDOWN',
          'PLAYING',
          'PAUSED',
          'ABORTED',
          'INTERRUPTED',
          'COMPLETED',
          'SAVING',
          'SAVED',
          'SAVE_FAILED',
        ],
      },
      UserSummary: {
        type: 'object',
        required: ['email', 'name', 'image'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1 },
          image: { type: ['string', 'null'], format: 'uri', maxLength: 2048 },
        },
      },
      Me: {
        type: 'object',
        required: ['user', 'institution', 'session', 'csrfToken'],
        properties: {
          user: {
            allOf: [
              ref('UserSummary'),
              {
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'string' } },
              },
            ],
          },
          institution: {
            type: 'object',
            required: ['id', 'name', 'status'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: ref('InstitutionName'),
              status: { type: 'string', const: 'ACTIVE' },
            },
          },
          session: {
            type: 'object',
            required: ['id', 'expiresAt'],
            properties: { id: { type: 'string' }, expiresAt: ref('IsoDate') },
          },
          csrfToken: { type: 'string', minLength: 32 },
        },
      },
      UpdateProfileRequest: {
        type: 'object',
        required: ['name', 'image', 'institutionName'],
        additionalProperties: false,
        properties: {
          name: ref('DisplayName'),
          image: {
            oneOf: [
              { type: 'string', format: 'uri', maxLength: 2048 },
              { type: 'string', pattern: '^data:image/(jpeg|png|webp);base64,', maxLength: 48000 },
              { type: 'null' },
            ],
          },
          institutionName: ref('InstitutionName'),
        },
      },
      InstitutionOnboardingRequest: {
        type: 'object',
        required: ['institutionName'],
        properties: { institutionName: ref('InstitutionName') },
      },
      InstitutionOnboardingStatus: {
        type: 'object',
        required: ['required', 'user', 'institution', 'csrfToken'],
        properties: {
          required: { type: 'boolean' },
          user: ref('UserSummary'),
          institution: {
            oneOf: [
              {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: ref('InstitutionName'),
                },
              },
              { type: 'null' },
            ],
          },
          csrfToken: { type: 'string', minLength: 32 },
        },
      },
      CreateParticipantRequest: {
        type: 'object',
        required: ['displayName'],
        additionalProperties: false,
        properties: { displayName: ref('DisplayName') },
      },
      ResolveParticipantRequest: {
        type: 'object',
        required: ['participantReference'],
        properties: { participantReference: ref('ParticipantReference') },
      },
      ResolveParticipantResponse: {
        type: 'object',
        required: ['participantId'],
        properties: { participantId: ref('PublicId') },
      },
      Participant: {
        type: 'object',
        required: [
          'participantId',
          'displayName',
          'participantReference',
          'status',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          participantId: ref('PublicId'),
          displayName: ref('DisplayName'),
          participantReference: ref('ParticipantReference'),
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          createdAt: ref('IsoDate'),
          updatedAt: ref('IsoDate'),
        },
        example: {
          participantId: publicParticipantId,
          displayName: 'Ibu Sari',
          participantReference: 'PST-001',
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      UpdateParticipantRequest: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          displayName: ref('DisplayName'),
          participantReference: ref('ParticipantReference'),
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
        },
      },
      Device: {
        type: 'object',
        required: [
          'deviceId',
          'family',
          'label',
          'inventoryStatus',
          'connectionStatus',
          'readinessCode',
          'readinessMessage',
          'firmwareVersion',
          'capabilities',
          'batteryPercent',
          'lastSeenAt',
        ],
        properties: {
          deviceId: { type: 'string', minLength: 3, maxLength: 80 },
          family: { type: 'string', enum: ['GAME12', 'MODE3'] },
          label: { type: 'string', minLength: 1, maxLength: 100 },
          inventoryStatus: { type: 'string', enum: ['ACTIVE', 'RETIRED', 'REVOKED'] },
          connectionStatus: {
            type: 'string',
            enum: ['ONLINE', 'OFFLINE', 'CONNECTING', 'NOT_AUTHORIZED'],
          },
          readinessCode: {
            type: 'string',
            enum: [
              'READY',
              'OFFLINE',
              'NOT_ACTIVE',
              'NOT_COMPATIBLE',
              'RESERVED',
              'CLEANUP_PENDING',
              'NOT_READY_BATTERY_UNKNOWN',
              'NOT_READY_LOW_BATTERY',
              'DEVICE_FAULT',
            ],
          },
          readinessMessage: { type: 'string', maxLength: 180 },
          firmwareVersion: { type: ['string', 'null'] },
          capabilities: {
            type: 'array',
            items: { type: 'string', enum: ['FSR', 'BUTTONS_4', 'LED', 'HAPTIC'] },
          },
          batteryPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
          lastSeenAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
        },
        example: {
          deviceId: 'game12-primary',
          family: 'GAME12',
          label: 'Arka Genggam',
          inventoryStatus: 'ACTIVE',
          connectionStatus: 'ONLINE',
          readinessCode: 'READY',
          readinessMessage: 'Perangkat siap digunakan.',
          firmwareVersion: '0.2.3',
          capabilities: ['FSR', 'LED', 'HAPTIC'],
          batteryPercent: 82,
          lastSeenAt: timestamp,
        },
      },
      DashboardSummary: {
        type: 'object',
        required: ['readyDevices', 'onlineDevices', 'totalActiveDevices', 'readinessMessage'],
        properties: {
          readyDevices: { type: 'integer', minimum: 0 },
          onlineDevices: { type: 'integer', minimum: 0 },
          totalActiveDevices: { type: 'integer', minimum: 0 },
          readinessMessage: { type: 'string' },
        },
      },
      DashboardModeActivity: {
        type: 'object',
        required: [
          'mode',
          'savedSessions',
          'sessionsLast7Days',
          'latestSavedAt',
          'latestRuleVersion',
        ],
        properties: {
          mode: ref('GameMode'),
          savedSessions: { type: 'integer', minimum: 0 },
          sessionsLast7Days: { type: 'integer', minimum: 0 },
          latestSavedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          latestRuleVersion: { type: ['string', 'null'], maxLength: 80 },
        },
      },
      DashboardActivity: {
        type: 'object',
        required: [
          'activeParticipants',
          'savedSessionsTotal',
          'savedSessionsLast7Days',
          'latestSavedAt',
          'dailySavedSessions',
          'modes',
        ],
        properties: {
          activeParticipants: { type: 'integer', minimum: 0 },
          savedSessionsTotal: { type: 'integer', minimum: 0 },
          savedSessionsLast7Days: { type: 'integer', minimum: 0 },
          latestSavedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          dailySavedSessions: {
            type: 'array',
            minItems: 7,
            maxItems: 7,
            items: {
              type: 'object',
              required: ['date', 'savedSessions'],
              properties: {
                date: { type: 'string', format: 'date', description: 'UTC calendar date.' },
                savedSessions: { type: 'integer', minimum: 0 },
              },
            },
          },
          modes: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: ref('DashboardModeActivity'),
          },
        },
      },
      DashboardProgress: {
        type: 'object',
        required: ['generatedAt', 'participants'],
        properties: {
          generatedAt: ref('IsoDate'),
          participants: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'participantId',
                'displayName',
                'savedSessionsTotal',
                'sessionsLast7Days',
                'activeWeeksLast4',
                'lastSession',
                'progress',
                'achievementStatus',
              ],
              properties: {
                participantId: ref('PublicId'),
                displayName: ref('DisplayName'),
                savedSessionsTotal: { type: 'integer', minimum: 0 },
                sessionsLast7Days: { type: 'integer', minimum: 0 },
                activeWeeksLast4: { type: 'integer', minimum: 0, maximum: 4 },
                lastSession: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['mode', 'completedAt'],
                      properties: {
                        mode: ref('GameMode'),
                        completedAt: ref('IsoDate'),
                      },
                    },
                    { type: 'null' },
                  ],
                },
                progress: {
                  type: 'object',
                  required: ['status', 'scoreDelta'],
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['NO_BASELINE', 'IMPROVED', 'MAINTAINED', 'LOWER'],
                    },
                    scoreDelta: { type: ['integer', 'null'], minimum: -1000, maximum: 1000 },
                  },
                },
                achievementStatus: {
                  type: 'string',
                  enum: ['NOT_STARTED', 'FIRST_SESSION', 'IMPROVED', 'CONSISTENT', 'CONTINUING'],
                },
              },
            },
          },
        },
      },
      CreatePreparationRequest: {
        type: 'object',
        required: ['mode', 'displayName', 'privacyAcknowledged'],
        properties: {
          mode: ref('GameMode'),
          displayName: ref('DisplayName'),
          participantReference: {
            ...ref('ParticipantReference'),
            description: 'Wajib untuk MOTOR_GRIP dan GO_NO_GO; opsional untuk sesi SEQUENCE_MEMORY berbasis nama.',
          },
          privacyAcknowledged: { type: 'boolean' },
        },
      },
      PreparationState: {
        type: 'string',
        enum: [
          'WAITING_DEVICE',
          'BINDING_SETUP',
          'CALIBRATING',
          'PRACTICING',
          'READY',
          'CANCELLED',
          'EXPIRED',
        ],
      },
      Preparation: {
        type: 'object',
        required: [
          'preparationId',
          'setupId',
          'mode',
          'displayName',
          'state',
          'expiresAt',
          'device',
          'setupBound',
          'calibration',
          'practiceCompleted',
          'canStart',
        ],
        properties: {
          preparationId: ref('PublicId'),
          setupId: { type: 'string', format: 'uuid' },
          mode: ref('GameMode'),
          displayName: ref('DisplayName'),
          fruitVariant: ref('FruitVariant'),
          state: ref('PreparationState'),
          expiresAt: ref('IsoDate'),
          device: {
            type: 'object',
            required: ['deviceId', 'family', 'label', 'readinessCode'],
            properties: {
              deviceId: { type: 'string' },
              family: { type: 'string', enum: ['GAME12', 'MODE3'] },
              label: { type: 'string' },
              readinessCode: { type: 'string' },
            },
          },
          setupBound: { type: 'boolean' },
          calibration: {
            oneOf: [
              {
                type: 'object',
                required: ['valid'],
                properties: {
                  valid: { type: 'boolean' },
                  gripPercent: { type: 'number', minimum: 0, maximum: 100 },
                  pressed: { type: 'boolean' },
                  message: { type: 'string' },
                },
              },
              { type: 'null' },
            ],
          },
          practiceCompleted: { type: 'boolean' },
          canStart: { type: 'boolean' },
        },
      },
      PreparationStatusPatchRequest: {
        type: 'object',
        required: ['command'],
        properties: { command: { type: 'string', const: 'CANCEL' } },
      },
      CreateGameSessionRequest: {
        type: 'object',
        required: ['preparationId'],
        properties: { preparationId: ref('PublicId') },
      },
      CreateGameSessionResponse: {
        type: 'object',
        required: ['sessionId', 'status', 'bindingDeadlineAt'],
        properties: {
          sessionId: { type: 'string', format: 'uuid' },
          status: { type: 'string', const: 'BINDING' },
          bindingDeadlineAt: ref('IsoDate'),
        },
      },
      SessionStatusPatchRequest: {
        type: 'object',
        required: ['command'],
        properties: { command: { type: 'string', enum: ['PAUSE', 'RESUME', 'ABORT'] } },
      },
      MotorGripSample: {
        type: 'object',
        required: ['elapsedSecond', 'gripPercent', 'kilograms'],
        properties: {
          elapsedSecond: { type: 'integer', minimum: 1, maximum: 30 },
          gripPercent: { type: 'number', minimum: 0, maximum: 100 },
          kilograms: { type: 'number', minimum: 0, maximum: 120 },
        },
      },
      MotorGripMetrics: {
        type: 'object',
        required: ['mode', 'peakGripPercent', 'peakKilograms', 'continuousHoldMs', 'targetCompleted', 'sessionElapsedMs', 'gripSamples'],
        properties: {
          mode: { type: 'string', const: 'MOTOR_GRIP' },
          peakGripPercent: { type: 'number', minimum: 0, maximum: 100 },
          peakKilograms: { type: 'number', minimum: 0, maximum: 120 },
          continuousHoldMs: { type: 'integer', minimum: 0, maximum: 5000 },
          targetCompleted: { type: 'boolean' },
          sessionElapsedMs: { type: 'integer', minimum: 0, maximum: 30000 },
          gripSamples: { type: 'array', maxItems: 30, items: ref('MotorGripSample') },
        },
      },
      GoNoGoLevelMetrics: {
        type: 'object',
        required: ['level', 'stimulusDurationMs', 'totalTrials', 'hits', 'misses', 'falsePositives', 'correctRejections', 'accuracyPercent', 'meanHitReactionMs'],
        properties: {
          level: { type: 'integer', minimum: 1, maximum: 2 },
          stimulusDurationMs: { type: 'integer', minimum: 1 },
          totalTrials: { type: 'integer', minimum: 0 },
          hits: { type: 'integer', minimum: 0 },
          misses: { type: 'integer', minimum: 0 },
          falsePositives: { type: 'integer', minimum: 0 },
          correctRejections: { type: 'integer', minimum: 0 },
          accuracyPercent: { type: 'number', minimum: 0, maximum: 100 },
          meanHitReactionMs: { type: ['number', 'null'], minimum: 0 },
        },
      },
      GoNoGoMetrics: {
        type: 'object',
        required: [
          'mode',
          'totalTrials',
          'targetTrials',
          'nonTargetTrials',
          'hits',
          'misses',
          'falsePositives',
          'correctRejections',
          'accuracyPercent',
          'meanHitReactionMs',
        ],
        properties: {
          mode: { type: 'string', const: 'GO_NO_GO' },
          totalTrials: { type: 'integer', minimum: 0 },
          targetTrials: { type: 'integer', minimum: 0 },
          nonTargetTrials: { type: 'integer', minimum: 0 },
          hits: { type: 'integer', minimum: 0 },
          misses: { type: 'integer', minimum: 0 },
          falsePositives: { type: 'integer', minimum: 0 },
          correctRejections: { type: 'integer', minimum: 0 },
          accuracyPercent: { type: 'number', minimum: 0, maximum: 100 },
          meanHitReactionMs: { type: ['number', 'null'], minimum: 0 },
          levelBreakdown: { type: 'array', maxItems: 2, default: [], items: ref('GoNoGoLevelMetrics') },
        },
      },
      SequenceMemoryMetrics: {
        type: 'object',
        required: [
          'mode',
          'maxSequenceLength',
          'completedLevels',
          'wrongAttempts',
          'timedOutAttempts',
          'multiButtonAttempts',
          'meanFirstResponseMs',
          'meanInterButtonMs',
          'levelLatencies',
          'completionReason',
        ],
        properties: {
          mode: { type: 'string', const: 'SEQUENCE_MEMORY' },
          maxSequenceLength: { type: 'integer', minimum: 0 },
          completedLevels: { type: 'integer', minimum: 0 },
          wrongAttempts: { type: 'integer', minimum: 0 },
          timedOutAttempts: { type: 'integer', minimum: 0 },
          multiButtonAttempts: { type: 'integer', minimum: 0 },
          meanFirstResponseMs: { type: ['number', 'null'], minimum: 0 },
          meanInterButtonMs: { type: ['number', 'null'], minimum: 0 },
          levelLatencies: {
            type: 'array',
            maxItems: 6,
            items: {
              type: 'object',
              required: ['level', 'latencyMs'],
              properties: {
                level: { type: 'integer', minimum: 1, maximum: 6 },
                latencyMs: { type: 'number', minimum: 0 },
              },
            },
          },
          completionReason: {
            type: 'string',
            enum: ['LIVES_EXHAUSTED', 'LEVEL_CAP_REACHED'],
          },
        },
      },
      GameMetrics: {
        oneOf: [ref('MotorGripMetrics'), ref('GoNoGoMetrics'), ref('SequenceMemoryMetrics')],
        discriminator: {
          propertyName: 'mode',
          mapping: {
            MOTOR_GRIP: '#/components/schemas/MotorGripMetrics',
            GO_NO_GO: '#/components/schemas/GoNoGoMetrics',
            SEQUENCE_MEMORY: '#/components/schemas/SequenceMemoryMetrics',
          },
        },
      },
      AiAudienceSummary: {
        type: 'object',
        required: ['summaryText', 'observations'],
        properties: {
          summaryText: { type: 'string', maxLength: 280 },
          observations: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', maxLength: 140 },
          },
        },
      },
      AiSummary: {
        oneOf: [
          {
            type: 'object',
            required: ['status', 'participant', 'clinician'],
            properties: { status: { type: 'string', const: 'PENDING' }, participant: ref('AiAudienceSummary'), clinician: ref('AiAudienceSummary') },
          },
          {
            type: 'object',
            required: ['status', 'participant', 'clinician'],
            properties: { status: { type: 'string', const: 'UNAVAILABLE' }, participant: ref('AiAudienceSummary'), clinician: ref('AiAudienceSummary') },
          },
          {
            type: 'object',
            required: ['status', 'participant', 'clinician'],
            properties: {
              status: { type: 'string', const: 'READY' },
              participant: ref('AiAudienceSummary'),
              clinician: ref('AiAudienceSummary'),
            },
          },
        ],
      },
      GameResult: {
        type: 'object',
        required: ['score', 'metrics', 'gameRuleVersion', 'savedAt', 'aiSummary'],
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 1000 },
          metrics: ref('GameMetrics'),
          gameRuleVersion: { type: 'string' },
          savedAt: ref('IsoDate'),
          aiSummary: ref('AiSummary'),
        },
      },
      GameSession: {
        type: 'object',
        required: [
          'sessionId',
          'status',
          'mode',
          'displayName',
          'participantId',
          'startedAt',
          'completedAt',
          'failureReason',
          'result',
        ],
        properties: {
          sessionId: { type: 'string', format: 'uuid' },
          status: ref('SessionStatus'),
          mode: ref('GameMode'),
          displayName: ref('DisplayName'),
          participantId: { oneOf: [ref('PublicId'), { type: 'null' }] },
          startedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          completedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          failureReason: { type: ['string', 'null'] },
          result: { oneOf: [ref('GameResult'), { type: 'null' }] },
        },
      },
      HistoryItem: {
        type: 'object',
        required: [
          'sessionId',
          'mode',
          'status',
          'startedAt',
          'completedAt',
          'score',
          'gameRuleVersion',
          'metrics',
        ],
        properties: {
          sessionId: { type: 'string', format: 'uuid' },
          mode: ref('GameMode'),
          status: ref('SessionStatus'),
          startedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          completedAt: { oneOf: [ref('IsoDate'), { type: 'null' }] },
          score: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
          gameRuleVersion: { type: ['string', 'null'] },
          metrics: { oneOf: [ref('GameMetrics'), { type: 'null' }] },
        },
      },
      HistoryPage: {
        type: 'object',
        required: ['items', 'nextCursor', 'totalItems', 'totalPages'],
        properties: {
          items: { type: 'array', maxItems: 10, items: ref('HistoryItem') },
          nextCursor: { type: ['string', 'null'] },
          totalItems: { type: 'integer', minimum: 0 },
          totalPages: { type: 'integer', minimum: 0 },
        },
      },
      LeaderboardEntry: {
        type: 'object',
        required: ['rank', 'sessionId', 'completedAt', 'score', 'metrics'],
        properties: {
          rank: { type: 'integer', minimum: 1 },
          sessionId: { type: 'string', format: 'uuid' },
          completedAt: ref('IsoDate'),
          score: { type: 'integer', minimum: 0, maximum: 1000 },
          metrics: ref('GameMetrics'),
        },
      },
      Leaderboard: {
        type: 'object',
        required: ['participantId', 'mode', 'ruleVersion', 'entries'],
        properties: {
          participantId: ref('PublicId'),
          mode: ref('GameMode'),
          ruleVersion: { type: 'string' },
          entries: { type: 'array', items: ref('LeaderboardEntry') },
        },
      },
      AppSetupSubscribe: {
        type: 'object',
        required: ['protocolVersion', 'messageId', 'type', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          messageId: { type: 'string', format: 'uuid' },
          type: { type: 'string', const: 'app.setup.subscribe' },
          payload: {
            type: 'object',
            required: ['setupId'],
            properties: {
              setupId: { type: 'string', format: 'uuid' },
              cursor: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      AppSessionSubscribe: {
        type: 'object',
        required: ['protocolVersion', 'messageId', 'type', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          messageId: { type: 'string', format: 'uuid' },
          type: { type: 'string', const: 'app.subscribe' },
          payload: {
            type: 'object',
            required: ['sessionId'],
            properties: {
              sessionId: { type: 'string', format: 'uuid' },
              cursor: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      AppSessionCommand: {
        type: 'object',
        required: ['protocolVersion', 'messageId', 'type', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          messageId: { type: 'string', format: 'uuid' },
          type: { type: 'string', const: 'session.command' },
          payload: {
            type: 'object',
            required: ['sessionId', 'command'],
            properties: {
              sessionId: { type: 'string', format: 'uuid' },
              command: { type: 'string', enum: ['PAUSE', 'RESUME', 'ABORT'] },
            },
          },
        },
      },
      AppClientMessage: {
        oneOf: [ref('AppSetupSubscribe'), ref('AppSessionSubscribe'), ref('AppSessionCommand')],
        discriminator: { propertyName: 'type' },
      },
      SetupVisual: {
        type: 'object',
        required: ['state', 'instruction', 'setupBound', 'checkedButton', 'buttonCheckComplete', 'practiceCompleted', 'canStart'],
        properties: {
          state: ref('PreparationState'),
          instruction: { type: 'string' },
          setupBound: { type: 'boolean' },
          checkedButton: { type: ['string', 'null'], enum: ['RED', 'GREEN', 'BLUE', 'YELLOW', 'MULTIPLE', null] },
          buttonCheckComplete: { type: 'boolean' },
          gripPercent: { type: 'number', minimum: 0, maximum: 100 },
          pressed: { type: 'boolean' },
          practiceStimulus: {
            type: 'string',
            enum: ['WAYANG', 'BATIK', 'CANDI', 'MONAS', 'ANGKLUNG'],
          },
          practiceFeedback: { type: 'string', enum: ['CORRECT', 'TRY_AGAIN', 'WAIT'] },
          practiceCompleted: { type: 'boolean' },
          canStart: { type: 'boolean' },
        },
      },
      MotorGripVisual: {
        type: 'object',
        required: ['mode', 'gripPercent', 'kilograms', 'holdProgressMs', 'activeElapsedMs', 'remainingMs', 'gripSamples', 'message'],
        properties: {
          mode: { type: 'string', const: 'MOTOR_GRIP' },
          gripPercent: { type: 'number', minimum: 0, maximum: 100 },
          kilograms: { type: 'number', minimum: 0, maximum: 120 },
          holdProgressMs: { type: 'integer', minimum: 0, maximum: 5000 },
          activeElapsedMs: { type: 'integer', minimum: 0, maximum: 30000 },
          remainingMs: { type: 'integer', minimum: 0, maximum: 30000 },
          gripSamples: { type: 'array', maxItems: 30, items: ref('MotorGripSample') },
          message: { type: 'string' },
        },
      },
      GoNoGoVisual: {
        type: 'object',
        required: ['mode', 'trialNumber', 'questionNumber', 'totalQuestions', 'level', 'levelTrialNumber', 'levelQuestionNumber', 'levelTrialCount', 'totalLevels', 'targetStimulus', 'targetAssetIndex', 'stimulus', 'assetIndex', 'candidateIndex', 'candidateNumber', 'targetAppearance', 'phase', 'activeElapsedMs', 'remainingMs', 'feedback', 'correctTrials'],
        properties: {
          mode: { type: 'string', const: 'GO_NO_GO' },
          trialNumber: { type: 'integer', minimum: 1, maximum: 10 },
          questionNumber: { type: 'integer', minimum: 1, maximum: 10 },
          totalQuestions: { type: 'integer', const: 10 },
          level: { type: 'integer', minimum: 1, maximum: 2 },
          levelTrialNumber: { type: 'integer', minimum: 1, maximum: 5 },
          levelQuestionNumber: { type: 'integer', minimum: 1, maximum: 5 },
          levelTrialCount: { type: 'integer', const: 5 },
          totalLevels: { type: 'integer', const: 2 },
          targetStimulus: {
            type: 'string',
            enum: ['WAYANG', 'BATIK', 'CANDI', 'MONAS', 'ANGKLUNG'],
          },
          targetAssetIndex: { type: 'integer', minimum: 0, maximum: 3 },
          stimulus: {
            type: ['string', 'null'],
            enum: ['WAYANG', 'BATIK', 'CANDI', 'MONAS', 'ANGKLUNG', null],
          },
          assetIndex: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
          candidateIndex: { type: ['integer', 'null'], minimum: 0 },
          candidateNumber: { type: ['integer', 'null'], minimum: 1 },
          targetAppearance: { type: ['integer', 'null'], enum: [1, 2, null] },
          phase: { type: 'string', enum: ['TARGET_PREVIEW', 'TRANSITION', 'STIMULUS'] },
          activeElapsedMs: { type: 'integer', minimum: 0, maximum: 180000 },
          remainingMs: { type: 'integer', minimum: 0, maximum: 180000 },
          feedback: { type: 'null' },
          correctTrials: { type: 'integer', minimum: 0, maximum: 10 },
        },
      },
      SequenceMemoryVisual: {
        type: 'object',
        required: [
          'mode',
          'phase',
          'activeItem',
          'activeIndex',
          'cueId',
          'sequenceLength',
          'responseIndex',
          'remainingAttempts',
          'errorIndex',
          'feedback',
        ],
        properties: {
          mode: { type: 'string', const: 'SEQUENCE_MEMORY' },
          phase: { type: 'string', enum: ['EXAMPLE', 'RESPONSE', 'FEEDBACK'] },
          activeItem: {
            type: ['string', 'null'],
            enum: ['RED', 'GREEN', 'BLUE', 'YELLOW', null],
          },
          activeIndex: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          cueId: { type: ['string', 'null'], pattern: '^\\d+:[0-5]$' },
          sequenceLength: { type: 'integer', minimum: 1 },
          responseIndex: { type: 'integer', minimum: 0 },
          remainingAttempts: { type: 'integer', minimum: 0, maximum: 3 },
          errorIndex: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          feedback: {
            type: ['string', 'null'],
            enum: ['CORRECT', 'REPEAT', 'ONE_BUTTON', null],
          },
        },
      },
      SessionVisual: {
        oneOf: [ref('MotorGripVisual'), ref('GoNoGoVisual'), ref('SequenceMemoryVisual')],
        discriminator: { propertyName: 'mode' },
      },
      AppSetupSnapshot: {
        type: 'object',
        required: ['protocolVersion', 'sequence', 'type', 'setupId', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          sequence: { type: 'integer', minimum: 0 },
          type: { type: 'string', const: 'setup.snapshot' },
          setupId: { type: 'string', format: 'uuid' },
          payload: ref('SetupVisual'),
        },
      },
      AppSessionSnapshot: {
        type: 'object',
        required: ['protocolVersion', 'sequence', 'type', 'sessionId', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          sequence: { type: 'integer', minimum: 0 },
          type: { type: 'string', const: 'session.snapshot' },
          sessionId: { type: 'string', format: 'uuid' },
          payload: {
            type: 'object',
            required: ['status', 'mode', 'displayName', 'countdown', 'visual', 'result', 'message'],
            properties: {
              status: ref('SessionStatus'),
              mode: ref('GameMode'),
              displayName: ref('DisplayName'),
              countdown: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
              visual: { oneOf: [ref('SessionVisual'), { type: 'null' }] },
              result: { oneOf: [ref('GameResult'), { type: 'null' }] },
              message: { type: 'string' },
            },
          },
        },
      },
      AppRealtimeError: {
        type: 'object',
        required: ['protocolVersion', 'sequence', 'type', 'payload'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          sequence: { type: 'integer', minimum: 0 },
          type: { type: 'string', const: 'app.error' },
          payload: {
            type: 'object',
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
      AppServerMessage: {
        oneOf: [ref('AppSetupSnapshot'), ref('AppSessionSnapshot'), ref('AppRealtimeError')],
        discriminator: { propertyName: 'type' },
      },
      DeviceMessageBase: {
        type: 'object',
        required: ['protocolVersion', 'type', 'messageId', 'sentAtMs', 'sequence'],
        properties: {
          protocolVersion: { type: 'integer', const: 1 },
          type: { type: 'string' },
          messageId: { type: 'string', format: 'uuid' },
          sentAtMs: { type: 'integer', minimum: 0 },
          sequence: { type: 'integer', minimum: 0 },
        },
      },
      DeviceHello: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['bootId', 'payload'],
            properties: {
              type: { type: 'string', const: 'device.hello' },
              sequence: { type: 'integer', const: 0 },
              bootId: { type: 'string', format: 'uuid' },
              payload: {
                type: 'object',
                required: ['firmwareVersion', 'capabilities'],
                properties: {
                  firmwareVersion: { type: 'string', minLength: 1, maxLength: 80 },
                  capabilities: {
                    type: 'array',
                    maxItems: 16,
                    items: {
                      type: 'string',
                      enum: ['FSR_10HZ', 'FSR_TARED_ON_SETUP_BIND', 'BUTTONS_4', 'LED', 'HAPTIC'],
                    },
                  },
                },
              },
            },
          },
        ],
      },
      DeviceChallenge: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.challenge' },
              sequence: { type: 'integer', const: 0 },
              payload: {
                type: 'object',
                required: ['challengeId', 'nonce', 'expiresAtMs'],
                properties: {
                  challengeId: { type: 'string', format: 'uuid' },
                  nonce: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
                  expiresAtMs: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        ],
      },
      DeviceProve: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.prove' },
              sequence: { type: 'integer', const: 0 },
              payload: {
                type: 'object',
                required: ['challengeId', 'proof'],
                properties: {
                  challengeId: { type: 'string', format: 'uuid' },
                  proof: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
                },
              },
            },
          },
        ],
      },
      DeviceAccept: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.accept' },
              sequence: { type: 'integer', const: 0 },
              payload: {
                type: 'object',
                required: ['connectionId', 'heartbeatIntervalMs', 'maxSequenceGap'],
                properties: {
                  connectionId: { type: 'string', format: 'uuid' },
                  heartbeatIntervalMs: { type: 'integer', const: 5000 },
                  maxSequenceGap: { type: 'integer', const: 32 },
                },
              },
            },
          },
        ],
      },
      DeviceHealth: {
        type: 'object',
        required: ['battery', 'faults'],
        properties: {
          battery: {
            type: 'object',
            required: ['valid'],
            properties: {
              valid: { type: 'boolean' },
              percent: { type: 'integer', minimum: 0, maximum: 100 },
            },
          },
          faults: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', enum: ['FSR', 'BUTTON', 'CABLE', 'ACTUATOR'] },
          },
        },
      },
      DeviceHeartbeat: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.heartbeat' },
              sequence: { type: 'integer', minimum: 1 },
              payload: ref('DeviceHealth'),
            },
          },
        ],
      },
      DeviceStatus: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.status' },
              sequence: { type: 'integer', minimum: 1 },
              payload: ref('DeviceHealth'),
            },
          },
        ],
      },
      DeviceFsr: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            oneOf: [
              { required: ['setupId'], properties: { setupId: { type: 'string', format: 'uuid' } } },
              {
                required: ['sessionId'],
                properties: { sessionId: { type: 'string', format: 'uuid' } },
              },
            ],
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'telemetry.fsr' },
              sequence: { type: 'integer', minimum: 1 },
              payload: {
                type: 'object',
                required: ['fsrRaw'],
                properties: { fsrRaw: { type: 'integer', minimum: 0, maximum: 4095 } },
              },
            },
          },
        ],
      },
      DeviceButtonPress: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            oneOf: [
              { required: ['setupId'], properties: { setupId: { type: 'string', format: 'uuid' } } },
              {
                required: ['sessionId'],
                properties: { sessionId: { type: 'string', format: 'uuid' } },
              },
            ],
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'button.press' },
              sequence: { type: 'integer', minimum: 1 },
              payload: {
                type: 'object',
                required: ['buttonCode'],
                properties: {
                  buttonCode: {
                    type: 'string',
                    enum: ['RED', 'GREEN', 'BLUE', 'YELLOW', 'MULTIPLE'],
                  },
                },
              },
            },
          },
        ],
      },
      DeviceCommandAck: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            oneOf: [
              { required: ['setupId'], properties: { setupId: { type: 'string', format: 'uuid' } } },
              {
                required: ['sessionId'],
                properties: { sessionId: { type: 'string', format: 'uuid' } },
              },
            ],
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.commandAck' },
              sequence: { type: 'integer', minimum: 1 },
              payload: {
                type: 'object',
                required: ['commandId', 'outcome'],
                properties: {
                  commandId: { type: 'string', format: 'uuid' },
                  outcome: { type: 'string', enum: ['ACK', 'NACK'] },
                  reason: {
                    type: 'string',
                    enum: [
                      'INVALID_ASSOCIATION',
                      'UNSUPPORTED',
                      'EXPIRED',
                      'BUSY',
                      'FAULT',
                      'INVALID_COMMAND',
                    ],
                  },
                },
              },
            },
          },
        ],
      },
      DeviceAssociationCommand: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            properties: {
              sequence: { type: 'integer', minimum: 1 },
              payload: {
                type: 'object',
                required: ['commandId', 'reservationId'],
                properties: {
                  commandId: { type: 'string', format: 'uuid' },
                  reservationId: { type: 'string', format: 'uuid' },
                  setupId: { type: 'string', format: 'uuid' },
                  sessionId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        ],
      },
      SetupBindCommand: {
        allOf: [
          ref('DeviceAssociationCommand'),
          { properties: { type: { type: 'string', const: 'setup.bind' } } },
        ],
      },
      SetupUnbindCommand: {
        allOf: [
          ref('DeviceAssociationCommand'),
          { properties: { type: { type: 'string', const: 'setup.unbind' } } },
        ],
      },
      SessionBindCommand: {
        allOf: [
          ref('DeviceAssociationCommand'),
          { properties: { type: { type: 'string', const: 'session.bind' } } },
        ],
      },
      SessionUnbindCommand: {
        allOf: [
          ref('DeviceAssociationCommand'),
          { properties: { type: { type: 'string', const: 'session.unbind' } } },
        ],
      },
      DeviceFeedbackCommand: {
        allOf: [
          ref('DeviceMessageBase'),
          {
            type: 'object',
            required: ['payload'],
            properties: {
              type: { type: 'string', const: 'device.feedback' },
              sequence: { type: 'integer', minimum: 1 },
              payload: {
                type: 'object',
                required: ['commandId', 'sessionId', 'action', 'expiresAfterMs'],
                properties: {
                  commandId: { type: 'string', format: 'uuid' },
                  sessionId: { type: 'string', format: 'uuid' },
                  action: {
                    type: 'string',
                    enum: [
                      'LED_SUCCESS',
                      'HAPTIC_SUCCESS',
                      'LED_CORRECT',
                      'LED_INCORRECT',
                      'LED_YELLOW',
                      'LED_GREEN',
                      'LED_RED',
                      'LED_BLUE',
                      'HAPTIC_PULSE',
                      'HARD_STOP',
                    ],
                  },
                  expiresAfterMs: { type: 'integer', minimum: 1, maximum: 1000 },
                },
              },
            },
          },
        ],
      },
      DeviceClientMessage: {
        oneOf: [
          ref('DeviceHello'),
          ref('DeviceProve'),
          ref('DeviceHeartbeat'),
          ref('DeviceStatus'),
          ref('DeviceFsr'),
          ref('DeviceButtonPress'),
          ref('DeviceCommandAck'),
        ],
        discriminator: { propertyName: 'type' },
      },
      DeviceServerMessage: {
        oneOf: [
          ref('DeviceChallenge'),
          ref('DeviceAccept'),
          ref('SetupBindCommand'),
          ref('SetupUnbindCommand'),
          ref('SessionBindCommand'),
          ref('SessionUnbindCommand'),
          ref('DeviceFeedbackCommand'),
        ],
        discriminator: { propertyName: 'type' },
      },
    },
  },
  'x-websocket-endpoints': [
    {
      url: '/ws/app',
      description:
        'Authenticated browser channel. Requires an exact allowed Origin and the Better Auth session cookie. Maximum 4 connections per session, 20 messages per second, 16 KiB per text frame, protocolVersion 1.',
      authentication: 'Better Auth session cookie',
      clientMessage: ref('AppClientMessage'),
      serverMessage: ref('AppServerMessage'),
    },
    {
      url: '/ws/device',
      description:
        'ESP32 channel using device.hello -> device.challenge -> device.prove -> device.accept. Text JSON only, 16 KiB per frame, protocolVersion 1, authenticated sequence starts at 1.',
      authentication: 'HMAC proof using provisioned device credential',
      clientMessage: ref('DeviceClientMessage'),
      serverMessage: ref('DeviceServerMessage'),
    },
  ],
} satisfies OpenApiObject;
