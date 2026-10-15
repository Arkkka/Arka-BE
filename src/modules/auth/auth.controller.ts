import type { Request, RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  InstitutionOnboardingRequestSchema,
  InstitutionOnboardingStatusSchema,
  MeDtoSchema,
} from '../../schemas/index.js';
import { validateRegistrationInstitutionName } from '../../auth/institution-provisioning.js';
import { AppError } from '../../middleware/errors.js';
import { csrfToken } from '../../middleware/security.js';

function sessionContext(req: Request): NonNullable<Request['sessionContext']> {
  if (!req.sessionContext) {
    throw new AppError(401, 'unauthorized', 'Silakan masuk untuk melanjutkan.');
  }
  return req.sessionContext;
}

export class AuthController {
  public readonly me: RequestHandler;
  public readonly onboardingStatus: RequestHandler;
  public readonly completeOnboarding: RequestHandler;

  public constructor(
    private readonly betterAuthSecret: string,
    private readonly prisma: PrismaClient,
  ) {
    this.me = (req, res) => {
      const auth = req.authContext;
      if (!auth) {
        throw new AppError(
          403,
          'institution_onboarding_required',
          'Lengkapi data institusi untuk melanjutkan.',
        );
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json(
        MeDtoSchema.parse({
          user: {
            id: auth.userId,
            email: auth.email,
            name: auth.name,
            image: auth.image,
          },
          institution: {
            id: auth.institutionId,
            name: auth.institutionName,
            status: 'ACTIVE',
          },
          session: { id: auth.sessionId, expiresAt: auth.sessionExpiresAt.toISOString() },
          csrfToken: csrfToken(auth.sessionId, this.betterAuthSecret),
        }),
      );
    };

    this.onboardingStatus = (req, res) => {
      const auth = sessionContext(req);
      res.json(
        InstitutionOnboardingStatusSchema.parse({
          required: auth.institutionId === null,
          user: { email: auth.email, name: auth.name, image: auth.image },
          institution:
            auth.institutionId && auth.institutionName
              ? { id: auth.institutionId, name: auth.institutionName }
              : null,
          csrfToken: csrfToken(auth.sessionId, this.betterAuthSecret),
        }),
      );
    };

    this.completeOnboarding = async (req, res) => {
      const auth = sessionContext(req);
      const { institutionName: rawName } = InstitutionOnboardingRequestSchema.parse(req.body);
      const institutionName = validateRegistrationInstitutionName(rawName);

      const institution = await this.prisma.$transaction(async (tx) => {
        const user = await tx.msUser.findUnique({
          where: { id: auth.userId },
          select: { institutionId: true, institution: { select: { id: true, name: true } } },
        });
        if (!user) throw new AppError(401, 'unauthorized', 'Sesi tidak lagi berlaku.');
        if (user.institution) return user.institution;
        const googleAccount = await tx.msAccount.findFirst({
          where: { userId: auth.userId, providerId: 'google' },
          select: { id: true },
        });
        if (!googleAccount) {
          throw new AppError(403, 'oauth_onboarding_required', 'Onboarding ini hanya untuk akun Google.');
        }

        const created = await tx.msInstitution.create({
          data: { name: institutionName, status: 'ACTIVE' },
          select: { id: true, name: true },
        });
        const updated = await tx.msUser.updateMany({
          where: { id: auth.userId, institutionId: null },
          data: { institutionId: created.id },
        });
        if (updated.count !== 1) {
          throw new AppError(409, 'onboarding_conflict', 'Data institusi sudah diperbarui. Muat ulang halaman.');
        }
        return created;
      });

      res.status(200).json(
        InstitutionOnboardingStatusSchema.parse({
          required: false,
          user: { email: auth.email, name: auth.name, image: auth.image },
          institution,
          csrfToken: csrfToken(auth.sessionId, this.betterAuthSecret),
        }),
      );
    };
  }
}
