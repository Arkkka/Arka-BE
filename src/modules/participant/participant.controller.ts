import {
  CreateParticipantRequestSchema,
  HistoryQuerySchema,
  LeaderboardQuerySchema,
  ParticipantSearchQuerySchema,
  ReportQuerySchema,
  ResolveParticipantRequestSchema,
  UpdateParticipantRequestSchema,
} from '../../schemas/index.js';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../../middleware/errors.js';
import type { PdfReportService, ReportRequestContext } from '../../services/pdf-report.js';
import type { ParticipantService, ParticipantScope } from './participant.service.js';
import { ParticipantParamsSchema } from './participant.validation.js';

function authContext(req: Request): NonNullable<Request['authContext']> {
  if (!req.authContext) throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
  return req.authContext;
}

function participantScope(req: Request): ParticipantScope {
  const auth = authContext(req);
  return {
    institutionId: auth.institutionId,
    actorUserId: auth.userId,
    actorSessionId: auth.sessionId,
    requestId: req.requestId,
  };
}

function reportContext(req: Request): ReportRequestContext {
  const auth = authContext(req);
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

export class ParticipantController {
  public constructor(
    private readonly service: ParticipantService,
    private readonly reports: PdfReportService,
  ) {}

  public readonly search: RequestHandler = async (req, res) => {
    const query = ParticipantSearchQuerySchema.parse(req.query);
    res.json(
      await this.service.searchParticipants(authContext(req).institutionId, query.query),
    );
  };

  public readonly create: RequestHandler = async (req, res) => {
    const body = CreateParticipantRequestSchema.parse(req.body);
    res.status(201).json(
      await this.service.createParticipant(participantScope(req), body),
    );
  };

  public readonly resolve: RequestHandler = async (req, res) => {
    const body = ResolveParticipantRequestSchema.parse(req.body);
    res.json(
      await this.service.resolveParticipant(participantScope(req), body.participantReference),
    );
  };

  public readonly get: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const params = ParticipantParamsSchema.parse(req.params);
    res.json(
      await this.service.getParticipant(authContext(req).institutionId, params.participantId),
    );
  };

  public readonly report: RequestHandler = async (req, res) => {
    const params = ParticipantParamsSchema.parse(req.params);
    const query = ReportQuerySchema.parse(req.query);
    const report = await this.reports.participantReport(reportContext(req), params.participantId, query.audience);
    sendPdf(res, `participant-${params.participantId}.pdf`, report);
  };

  public readonly update: RequestHandler = async (req, res) => {
    const params = ParticipantParamsSchema.parse(req.params);
    const body = UpdateParticipantRequestSchema.parse(req.body);
    res.json(
      await this.service.updateParticipant(participantScope(req), params.participantId, body),
    );
  };

  public readonly history: RequestHandler = async (req, res) => {
    const params = ParticipantParamsSchema.parse(req.params);
    const query = HistoryQuerySchema.parse(req.query);
    res.json(
      await this.service.participantHistory(
        authContext(req).institutionId,
        params.participantId,
        query,
      ),
    );
  };

  public readonly leaderboard: RequestHandler = async (req, res) => {
    const params = ParticipantParamsSchema.parse(req.params);
    const query = LeaderboardQuerySchema.parse(req.query);
    res.json(
      await this.service.participantLeaderboard(
        authContext(req).institutionId,
        params.participantId,
        query.mode,
        query.ruleVersion,
      ),
    );
  };
}
