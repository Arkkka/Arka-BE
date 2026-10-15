import {
  CreateGameSessionResponseSchema,
  GameSessionDtoSchema,
  PreparationDtoSchema,
  ReportQuerySchema,
} from '../../schemas/index.js';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../../middleware/errors.js';
import type { PdfReportService, ReportRequestContext } from '../../services/pdf-report.js';
import type { GameRequestContext, GameService } from './game.service.js';
import {
  parseIdempotencyKey,
  type CreateGameSessionRequest,
  type CreatePreparationRequest,
  type PreparationStatusPatchRequest,
  type SessionStatusPatchRequest,
} from './game.validation.js';

function authenticatedContext(req: Request): NonNullable<Request['authContext']> {
  if (!req.authContext) throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
  return req.authContext;
}

function gameRequestContext(req: Request): GameRequestContext {
  const auth = authenticatedContext(req);
  return {
    institutionId: auth.institutionId,
    userId: auth.userId,
    ownerSessionId: auth.sessionId,
    requestId: req.requestId,
  };
}
function preparationId(req: Request): string {
  return req.params['preparationId'] as string;
}
function sessionId(req: Request): string {
  return req.params['sessionId'] as string;
}

function reportContext(req: Request): ReportRequestContext {
  const auth = authenticatedContext(req);
  return {
    institutionId: auth.institutionId,
    institutionName: auth.institutionName,
    actorUserId: auth.userId,
    actorSessionId: auth.sessionId,
    requestId: req.requestId,
  };
}

function sendPdf(res: Response, filename: string, report: Buffer): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private,no-store,max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Length', String(report.length));
  res.status(200).send(report);
}

export class GameController {
  constructor(
    private readonly service: GameService,
    private readonly reports: PdfReportService,
  ) {}

  readonly openPreparation: RequestHandler = async (req, res) => {
    const preparation = await this.service.openPreparation(
      gameRequestContext(req),
      req.body as CreatePreparationRequest,
    );
    res.status(201).json(PreparationDtoSchema.parse(preparation));
  };

  readonly commandPreparation: RequestHandler = async (req, res) => {
    await this.service.commandPreparation(
      gameRequestContext(req),
      preparationId(req),
      req.body as PreparationStatusPatchRequest,
    );
    res.status(204).send();
  };

  readonly createSession: RequestHandler = async (req, res) => {
    const session = await this.service.createSession(
      gameRequestContext(req),
      req.body as CreateGameSessionRequest,
      parseIdempotencyKey(req.get('idempotency-key')),
    );
    res.status(201).json(CreateGameSessionResponseSchema.parse(session));
  };

  readonly commandSession: RequestHandler = async (req, res) => {
    const session = await this.service.commandSession(
      gameRequestContext(req),
      sessionId(req),
      req.body as SessionStatusPatchRequest,
    );
    res.json(GameSessionDtoSchema.parse(session));
  };

  readonly getSession: RequestHandler = async (req, res) => {
    const auth = authenticatedContext(req);
    const session = await this.service.getSession(auth.institutionId, sessionId(req));
    res.json(GameSessionDtoSchema.parse(session));
  };

  readonly report: RequestHandler = async (req, res) => {
    const query = ReportQuerySchema.parse(req.query);
    const id = sessionId(req);
    const report = await this.reports.sessionReport(reportContext(req), id, query.audience);
    sendPdf(res, `session-${id}.pdf`, report);
  };
}
