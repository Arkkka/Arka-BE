import { randomUUID } from 'node:crypto';
import { GameMetricsSchema, type GameMetrics } from '../schemas/index.js';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import {
  PARTICIPANT_AGGREGATE_SYSTEM_PROMPT,
  PARTICIPANT_MODE_SYSTEM_PROMPT,
  SESSION_SUMMARY_SYSTEM_PROMPT,
  participantAggregateUserPrompt,
  participantModeUserPrompt,
  sessionSummaryUserPrompt,
} from '../config/ai-summary-prompts.js';
import type { Logger } from '../config/logger.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const INDONESIAN_CUE =
  /\b(?:adalah|agar|akurasi|atau|baik|belum|buah|cepat|cengkeraman|cukup|dalam|dan|dapat|dengan|di|dari|durasi|genggaman|hasil|ini|jeda|juga|karena|ke|kilogram|kinerja|konsisten|lambat|level|lebih|maksimum|memori|mencapai|menunjukkan|metrik|milidetik|nol|penyelesaian|percobaan|performa|permainan|perlu|pada|rata-rata|reaksi|respons|ringkasan|sesi|skor|stabil|stimulus|sudah|target|tercatat|tidak|tingkat|tombol|untuk|waktu|yang)\b/iu;
const PLAIN_TEXT = /^[\p{L}\p{N} ,.;:!?()%'’/+-]+$/u;
const PROHIBITED_SUMMARY_TEXT =
  /(?:<[^>]*>|\[[^\]]*\]\([^)]*\)|(?:https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)|\b(?:identitas|nama|diagnos\w*|demensia|alzheimer|kognitif|mengindikasikan|medis|klinis|sempurna|terjamin|terapi|pengobatan|risiko|normal|abnormal|bahaya|konsultasikan)\b)/iu;
const METRIC_CUES = {
  MOTOR_GRIP:
    /\b(?:skor|buah|stroberi|tomat|pisang|jeruk|apel|semangka|kilogram|kg|kekuatan puncak|kekuatan cengkeraman|genggaman puncak|genggaman rata-rata|rata-rata genggaman|rata-rata kekuatan|tahanan kontinu|hold kontinu|waktu hold|waktu di atas target|target|waktu permainan)\b/iu,
  GO_NO_GO:
    /\b(?:skor|level|tingkat|durasi stimulus|total stimulus|stimulus target|stimulus non-target|respons tepat|belum merespons|false positive|berhasil menunggu|akurasi|waktu respons)\b/iu,
  SEQUENCE_MEMORY:
    /\b(?:skor|urutan terpanjang|panjang urutan maksimum|level selesai|semua level selesai|tingkatan selesai|jumlah tingkatan|percobaan salah|percobaan kehabisan waktu|tombol ganda|percobaan tombol ganda|waktu respons|respons pertama|jeda antar tombol|durasi per level|durasi per tingkatan|latensi per level|latensi per tingkatan|waktu pengerjaan|alasan selesai|penyelesaian sesi)\b/iu,
} as const;

interface AiSummaryInputSource {
  readonly mode: GameMetrics['mode'];
  readonly ruleVersion: string;
  readonly completedAt: Date;
  readonly score: number;
  readonly metrics: GameMetrics;
}

export function buildAiSummaryInput(source: AiSummaryInputSource) {
  const { mode, ...metrics } = source.metrics;
  const aggregateMetrics = mode === 'MOTOR_GRIP'
    ? Object.fromEntries(Object.entries(metrics).filter(([key]) => key !== 'gripSamples'))
    : metrics;
  if (mode !== source.mode) throw new TypeError('Metric mode mismatch');
  const sessionHour = new Date(source.completedAt);
  sessionHour.setUTCMinutes(0, 0, 0);
  return {
    mode: source.mode,
    ruleVersion: source.ruleVersion,
    sessionHourUtc: sessionHour.toISOString(),
    metrics: { score: source.score, ...aggregateMetrics },
  };
}

export function parseGroundedSummaryOutput(mode: GameMetrics['mode'], value: unknown) {
  const rawAudience = z.object({ summaryText: z.string(), observations: z.array(z.string()) }).passthrough();
  const raw = z.object({ participant: rawAudience, clinician: rawAudience }).passthrough().parse(value);
  const safeObservations = (texts: readonly string[]) => texts
    .map((text) => limitAtSentence(text, 140))
    .filter((text) => !PROHIBITED_SUMMARY_TEXT.test(text) && METRIC_CUES[mode].test(text) && /\d/u.test(text))
    .slice(0, 3);
  const output = SummaryOutputSchema.parse({
    participant: {
      summaryText: limitAtSentence(raw.participant.summaryText, 650),
      observations: safeObservations(raw.participant.observations),
    },
    clinician: {
      summaryText: limitAtSentence(raw.clinician.summaryText, 650),
      observations: safeObservations(raw.clinician.observations),
    },
  });
  for (const audience of [output.participant, output.clinician]) {
    if (PROHIBITED_SUMMARY_TEXT.test(audience.summaryText) || !/\d/u.test(audience.summaryText)) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: 'Summary text must be nonclinical and grounded in numeric session data',
        },
      ]);
    }
  }
  return output;
}

export function retryBackoffMs(attemptCount: number, baseMs: number): number {
  return Math.min(60_000, baseMs * 2 ** Math.max(0, attemptCount - 1));
}

function plainIndonesianText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine(
      (value) => PLAIN_TEXT.test(value) && !/ {2,}/u.test(value) && INDONESIAN_CUE.test(value),
      'Expected plain Indonesian text',
    );
}

const ParticipantSummarySchema = z
  .object({
    summaryText: plainIndonesianText(700),
    observations: z.array(plainIndonesianText(140)).max(3),
  })
  .strict();
const ClinicianSummarySchema = z
  .object({
    summaryText: plainIndonesianText(700),
    observations: z.array(plainIndonesianText(140)).max(3),
  })
  .strict();

const SummaryOutputSchema = z
  .object({
    participant: ParticipantSummarySchema,
    clinician: ClinicianSummarySchema,
  })
  .strict();
function aggregateOutputSchema(participantMaxLength: number, clinicianMaxLength: number) {
  return z.object({
    participantSummary: plainIndonesianText(participantMaxLength),
    clinicianSummary: plainIndonesianText(clinicianMaxLength),
  }).strict();
}

function limitAtSentence(value: string, maxLength: number): string {
  const normalized = value
    .replace(/[*_`#]+/gu, '')
    .replace(/\bmengindikasikan\b/giu, 'menunjukkan')
    .replace(/\bkognitif\b/giu, 'permainan')
    .replace(/\bsempurna\b/giu, 'tinggi')
    .replace(/\bterjamin\b/giu, 'tercatat')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  const shortened = normalized.slice(0, maxLength);
  const sentenceEnd = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('!'), shortened.lastIndexOf('?'));
  return (sentenceEnd >= Math.floor(maxLength * 0.55) ? shortened.slice(0, sentenceEnd + 1) : shortened.trimEnd()).trim();
}

export function parseAggregateSummaryOutput(
  value: unknown,
  limits: { readonly participant: number; readonly clinician: number } = { participant: 700, clinician: 1000 },
) {
  const raw = z.object({ participantSummary: z.string(), clinicianSummary: z.string() }).strict().parse(value);
  const output = aggregateOutputSchema(limits.participant, limits.clinician).parse({
    participantSummary: limitAtSentence(raw.participantSummary, limits.participant),
    clinicianSummary: limitAtSentence(raw.clinicianSummary, limits.clinician),
  });
  for (const text of [output.participantSummary, output.clinicianSummary]) {
    if (PROHIBITED_SUMMARY_TEXT.test(text) || !/\d/u.test(text)) {
      throw new z.ZodError([{ code: 'custom', path: [], message: 'Aggregate summary must be nonclinical and grounded in metrics' }]);
    }
  }
  return output;
}

const OllamaResponseSchema = z.object({ message: z.object({ content: z.string() }) }).passthrough();
const OpenAiResponseSchema = z
  .object({
    choices: z
      .array(z.object({ message: z.object({ content: z.string() }) }).passthrough())
      .min(1),
  })
  .passthrough();

function audienceSummaryFormat(exactlyThreePoints: boolean) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summaryText', 'observations'],
    properties: {
      summaryText: { type: 'string', maxLength: 650 },
      observations: {
        type: 'array',
        ...(exactlyThreePoints ? { minItems: 3 } : {}),
        maxItems: 3,
        items: { type: 'string', maxLength: 140 },
      },
    },
  } as const;
}

const SUMMARY_FORMAT = {
  type: 'object',
  additionalProperties: false,
  required: ['participant', 'clinician'],
  properties: {
    participant: audienceSummaryFormat(true),
    clinician: audienceSummaryFormat(false),
  },
} as const;

type FailureReason = 'METRICS_INVALID' | 'OLLAMA_REQUEST_FAILED' | 'OLLAMA_RESPONSE_INVALID';

interface ClaimedSummary {
  readonly id: string;
  readonly leaseToken: string;
  readonly attemptCount: number;
  readonly session: {
    readonly mode: GameMetrics['mode'];
    readonly completedAt: Date;
    readonly ruleVersion: { readonly version: string };
    readonly result: {
      readonly score: number;
      readonly metrics: unknown;
    };
  };
}

class LeaseLostError extends Error {}
class AiProviderHttpError extends Error {}

export interface AiSummaryWorkerDependencies {
  readonly prisma: PrismaClient;
  readonly env: Env;
  readonly logger: Logger;
}

/** Polls saved session summaries through the configured AI provider. */
export class AiSummaryWorker {
  #timer: NodeJS.Timeout | null = null;
  #activeTick: Promise<void> | null = null;
  #activeRequest: AbortController | null = null;
  #stopping = false;

  constructor(private readonly dependencies: AiSummaryWorkerDependencies) {}

  start(): void {
    if (this.#timer || this.#activeTick) return;

    this.#stopping = false;
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.dependencies.env.OLLAMA_WORKER_INTERVAL_MS);
    this.#timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#activeRequest?.abort();
    await this.#activeTick;
  }

  private async tick(): Promise<void> {
    if (this.#activeTick) return this.#activeTick;

    const active = this.run();
    this.#activeTick = active;
    try {
      await active;
    } finally {
      if (this.#activeTick === active) this.#activeTick = null;
    }
  }

  private async run(): Promise<void> {
    try {
      if (this.#stopping) return;
      await this.expireExhaustedLeases();
      const summary = await this.claimNext();
      if (summary && !this.#stopping) {
        await this.process(summary);
        return;
      }
      if (!this.#stopping) {
        await this.processParticipantModeAggregate();
        if (!this.#stopping) await this.processParticipantAggregate();
      }
    } catch (error) {
      if (!this.#stopping)
        this.dependencies.logger.error({ err: error }, 'Worker ringkasan AI lokal gagal diproses');
    }
  }

  private async expireExhaustedLeases(): Promise<void> {
    const { prisma, env } = this.dependencies;
    const now = new Date();
    await prisma.trAiSessionSummary.updateMany({
      where: {
        attemptCount: { gte: env.OLLAMA_MAX_ATTEMPTS },
        OR: [
          { status: 'PENDING' },
          {
            status: 'PROCESSING',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
        ],
        session: { is: { status: 'SAVED', result: { isNot: null } } },
      },
      data: {
        status: 'UNAVAILABLE',
        leaseToken: null,
        leaseExpiresAt: null,
        unavailableReason: 'OLLAMA_REQUEST_FAILED',
      },
    });
    await prisma.trParticipantModeSummary.updateMany({
      where: {
        attemptCount: { gte: env.OLLAMA_MAX_ATTEMPTS },
        OR: [
          { source: 'PENDING' },
          {
            source: 'PROCESSING',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
        ],
      },
      data: {
        source: 'FALLBACK',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await prisma.trParticipantSummary.updateMany({
      where: {
        attemptCount: { gte: env.OLLAMA_MAX_ATTEMPTS },
        OR: [
          { source: 'PENDING' },
          {
            source: 'PROCESSING',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
        ],
      },
      data: {
        participantSummary: 'Ringkasan otomatis belum tersedia. Statistik seluruh permainan Anda tetap dapat dilihat pada bagian perkembangan di bawah.',
        clinicianSummary: 'Ringkasan otomatis belum tersedia. Gunakan statistik per mode dan riwayat sesi sebagai sumber utama untuk peninjauan peserta.',
        source: 'FALLBACK',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async claimNext(): Promise<ClaimedSummary | null> {
    const { prisma, env } = this.dependencies;
    const now = new Date();
    const eligible = {
      attemptCount: { lt: env.OLLAMA_MAX_ATTEMPTS },
      availableAt: { lte: now },
      OR: [
        { status: 'PENDING' as const },
        {
          status: 'PROCESSING' as const,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
      ],
      session: { is: { status: 'SAVED' as const, result: { isNot: null } } },
    };

    for (let attempt = 0; attempt < 3 && !this.#stopping; attempt += 1) {
      const candidate = await prisma.trAiSessionSummary.findFirst({
        where: eligible,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;

      const leaseToken = randomUUID();
      const claimed = await prisma.trAiSessionSummary.updateMany({
        where: { id: candidate.id, ...eligible },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + Math.max(env.OLLAMA_LEASE_MS, env.OLLAMA_TIMEOUT_MS + env.OLLAMA_WORKER_INTERVAL_MS)),
          unavailableReason: null,
        },
      });
      if (claimed.count !== 1) continue;

      const loaded = await prisma.trAiSessionSummary.findFirst({
        where: {
          id: candidate.id,
          status: 'PROCESSING',
          leaseToken,
          session: { is: { status: 'SAVED', result: { isNot: null } } },
        },
        select: {
          id: true,
          leaseToken: true,
          attemptCount: true,
          session: {
            select: {
              mode: true,
              completedAt: true,
              ruleVersion: { select: { version: true } },
              result: { select: { score: true, metrics: true } },
            },
          },
        },
      });
      if (!loaded?.leaseToken || !loaded.session.result) return null;

      return {
        id: loaded.id,
        leaseToken: loaded.leaseToken,
        attemptCount: loaded.attemptCount,
        session: {
          mode: loaded.session.mode,
          completedAt: loaded.session.completedAt ?? new Date(0),
          ruleVersion: loaded.session.ruleVersion,
          result: loaded.session.result,
        },
      };
    }

    return null;
  }

  private async process(summary: ClaimedSummary): Promise<void> {
    const metrics = GameMetricsSchema.safeParse(summary.session.result.metrics);
    if (!metrics.success || metrics.data.mode !== summary.session.mode) {
      await this.completeFailure(summary, 'METRICS_INVALID');
      return;
    }

    try {
      const output = await this.generateSummary(summary, metrics.data);
      if (this.#stopping) return;

      await this.dependencies.prisma.trAiSessionSummary.updateMany({
        where: {
          id: summary.id,
          status: 'PROCESSING',
          leaseToken: summary.leaseToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'READY',
          leaseToken: null,
          leaseExpiresAt: null,
          summaryText: output.participant.summaryText,
          observations: output,
          unavailableReason: null,
        },
      });
    } catch (error) {
      if (this.#stopping || error instanceof LeaseLostError) return;
      if (!(error instanceof AiProviderHttpError))
        this.dependencies.logger.warn(
          {
            summaryId: summary.id,
            attemptCount: summary.attemptCount,
            provider: this.dependencies.env.OLLAMA_PROVIDER,
            model: this.dependencies.env.OLLAMA_MODEL,
            timeoutMs: this.dependencies.env.OLLAMA_TIMEOUT_MS,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            timedOut: error instanceof Error && error.name === 'AbortError',
          },
          'Pembuatan ringkasan AI gagal',
        );
      await this.completeFailure(
        summary,
        error instanceof SyntaxError || error instanceof z.ZodError
          ? 'OLLAMA_RESPONSE_INVALID'
          : 'OLLAMA_REQUEST_FAILED',
      );
    }
  }

  private async completeFailure(summary: ClaimedSummary, reason: FailureReason): Promise<void> {
    if (this.#stopping) return;

    const unavailable = summary.attemptCount >= this.dependencies.env.OLLAMA_MAX_ATTEMPTS;
    await this.dependencies.prisma.trAiSessionSummary.updateMany({
      where: {
        id: summary.id,
        status: 'PROCESSING',
        leaseToken: summary.leaseToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: unavailable
        ? {
            status: 'UNAVAILABLE',
            leaseToken: null,
            leaseExpiresAt: null,
            unavailableReason: reason,
          }
        : {
            status: 'PENDING',
            leaseToken: null,
            leaseExpiresAt: null,
            unavailableReason: null,
            availableAt: new Date(
              Date.now() +
                retryBackoffMs(
                  summary.attemptCount,
                  this.dependencies.env.OLLAMA_WORKER_INTERVAL_MS,
                ),
            ),
          },
    });
  }

  private async processParticipantModeAggregate(): Promise<boolean> {
    const { prisma, env } = this.dependencies;
    const now = new Date();
    const eligible = {
      attemptCount: { lt: env.OLLAMA_MAX_ATTEMPTS },
      availableAt: { lte: now },
      OR: [
        { source: 'PENDING' },
        { source: 'DETERMINISTIC' },
        {
          source: 'PROCESSING',
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
      ],
    };
    const candidate = await prisma.trParticipantModeSummary.findFirst({
      where: eligible,
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
    });
    if (!candidate || this.#stopping) return false;
    const leaseToken = randomUUID();
    const claimed = await prisma.trParticipantModeSummary.updateMany({
      where: { id: candidate.id, ...eligible },
      data: {
        source: 'PROCESSING',
        attemptCount: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + Math.max(env.OLLAMA_LEASE_MS, env.OLLAMA_TIMEOUT_MS + env.OLLAMA_WORKER_INTERVAL_MS)),
      },
    });
    if (claimed.count !== 1) return true;
    const loaded = await prisma.trParticipantModeSummary.findFirst({
      where: { id: candidate.id, source: 'PROCESSING', leaseToken },
      select: { id: true, attemptCount: true, aggregateMetrics: true },
    });
    if (!loaded) return true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);
    timeout.unref();
    this.#activeRequest = controller;
    try {
      const content = await this.requestProvider(
        [
          { role: 'system', content: PARTICIPANT_MODE_SYSTEM_PROMPT },
          { role: 'user', content: participantModeUserPrompt(loaded.aggregateMetrics) },
        ],
        controller.signal,
      );
      const output = parseAggregateSummaryOutput(JSON.parse(content));
      await prisma.trParticipantModeSummary.updateMany({
        where: { id: loaded.id, source: 'PROCESSING', leaseToken, leaseExpiresAt: { gt: new Date() } },
        data: {
          participantSummary: output.participantSummary,
          clinicianSummary: output.clinicianSummary,
          source: 'AI',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
    } catch (error) {
      if (!this.#stopping) {
        this.dependencies.logger.warn(
          {
            summaryId: loaded.id,
            provider: env.OLLAMA_PROVIDER,
            model: env.OLLAMA_MODEL,
            timedOut: error instanceof Error && error.name === 'AbortError',
          },
          'Pembuatan ringkasan per mode gagal',
        );
        const unavailable = loaded.attemptCount >= env.OLLAMA_MAX_ATTEMPTS;
        await prisma.trParticipantModeSummary.updateMany({
          where: { id: loaded.id, source: 'PROCESSING', leaseToken, leaseExpiresAt: { gt: new Date() } },
          data: unavailable
            ? { source: 'FALLBACK', leaseToken: null, leaseExpiresAt: null }
            : {
                source: 'PENDING',
                leaseToken: null,
                leaseExpiresAt: null,
                availableAt: new Date(Date.now() + retryBackoffMs(loaded.attemptCount, env.OLLAMA_WORKER_INTERVAL_MS)),
              },
        });
      }
    } finally {
      clearTimeout(timeout);
      if (this.#activeRequest === controller) this.#activeRequest = null;
    }
    return true;
  }

  private async processParticipantAggregate(): Promise<void> {
    const { prisma, env } = this.dependencies;
    const now = new Date();
    const eligible = {
      attemptCount: { lt: env.OLLAMA_MAX_ATTEMPTS },
      availableAt: { lte: now },
      OR: [
        { source: { in: ['PENDING', 'DETERMINISTIC'] } },
        {
          source: 'PROCESSING',
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
      ],
    };
    const candidate = await prisma.trParticipantSummary.findFirst({
      where: eligible,
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
    });
    if (!candidate || this.#stopping) return;
    const leaseToken = randomUUID();
    const leaseDurationMs = Math.max(
      env.OLLAMA_LEASE_MS,
      env.OLLAMA_TIMEOUT_MS + env.OLLAMA_WORKER_INTERVAL_MS,
    );
    const claimed = await prisma.trParticipantSummary.updateMany({
      where: { id: candidate.id, ...eligible },
      data: {
        source: 'PROCESSING',
        attemptCount: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + leaseDurationMs),
      },
    });
    if (claimed.count !== 1) return;
    const loaded = await prisma.trParticipantSummary.findFirst({
      where: { id: candidate.id, source: 'PROCESSING', leaseToken },
      select: { id: true, attemptCount: true, aggregateMetrics: true },
    });
    if (!loaded) return;

    const controller = new AbortController();
    let leaseLost = false;
    const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);
    const renewal = setInterval(() => {
      if (this.#stopping) {
        controller.abort();
        return;
      }
      void prisma.trParticipantSummary.updateMany({
        where: {
          id: loaded.id,
          source: 'PROCESSING',
          leaseToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: { leaseExpiresAt: new Date(Date.now() + leaseDurationMs) },
      }).then(({ count }) => {
        if (count !== 1) {
          leaseLost = true;
          controller.abort();
        }
      }).catch(() => {
        leaseLost = true;
        controller.abort();
      });
    }, Math.max(1, Math.floor(env.OLLAMA_LEASE_MS / 3)));
    timeout.unref();
    renewal.unref();
    this.#activeRequest = controller;
    try {
      const content = await this.requestProvider(
        [
          { role: 'system', content: PARTICIPANT_AGGREGATE_SYSTEM_PROMPT },
          { role: 'user', content: participantAggregateUserPrompt(loaded.aggregateMetrics) },
        ],
        controller.signal,
      );
      if (leaseLost) throw new LeaseLostError();
      const output = parseAggregateSummaryOutput(JSON.parse(content), { participant: 1200, clinician: 1800 });
      await prisma.trParticipantSummary.updateMany({
        where: {
          id: loaded.id,
          source: 'PROCESSING',
          leaseToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          participantSummary: output.participantSummary,
          clinicianSummary: output.clinicianSummary,
          source: 'AI',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
    } catch (error) {
      if (!this.#stopping && !(error instanceof LeaseLostError)) {
        this.dependencies.logger.warn(
          {
            summaryId: loaded.id,
            attemptCount: loaded.attemptCount,
            provider: env.OLLAMA_PROVIDER,
            model: env.OLLAMA_MODEL,
            timedOut: error instanceof Error && error.name === 'AbortError',
          },
          'Pembuatan ringkasan keseluruhan gagal',
        );
        const unavailable = loaded.attemptCount >= env.OLLAMA_MAX_ATTEMPTS;
        await prisma.trParticipantSummary.updateMany({
          where: {
            id: loaded.id,
            source: 'PROCESSING',
            leaseToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: unavailable
            ? {
                participantSummary: 'Ringkasan otomatis belum tersedia. Statistik seluruh permainan Anda tetap dapat dilihat pada bagian perkembangan di bawah.',
                clinicianSummary: 'Ringkasan otomatis belum tersedia. Gunakan statistik per mode dan riwayat sesi sebagai sumber utama untuk peninjauan peserta.',
                source: 'FALLBACK',
                leaseToken: null,
                leaseExpiresAt: null,
              }
            : {
                source: 'PENDING',
                leaseToken: null,
                leaseExpiresAt: null,
                availableAt: new Date(
                  Date.now() + retryBackoffMs(loaded.attemptCount, env.OLLAMA_WORKER_INTERVAL_MS),
                ),
              },
        });
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(renewal);
      if (this.#activeRequest === controller) this.#activeRequest = null;
    }
  }

  private async requestProvider(
    messages: readonly { readonly role: string; readonly content: string }[],
    signal: AbortSignal,
  ): Promise<string> {
    const { env } = this.dependencies;
    const openAiCompatible = env.OLLAMA_PROVIDER === 'openai';
    const response = await fetch(
      openAiCompatible ? `${env.OLLAMA_BASE_URL}/chat/completions` : `${env.OLLAMA_BASE_URL}/api/chat`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(openAiCompatible ? { authorization: `Bearer ${env.OLLAMA_API_KEY}` } : {}),
        },
        signal,
        body: JSON.stringify(
          openAiCompatible
            ? { model: env.OLLAMA_MODEL, messages, temperature: 0.2, response_format: { type: 'json_object' } }
            : { model: env.OLLAMA_MODEL, stream: false, options: { temperature: 0.2 }, messages },
        ),
      },
    );
    if (!response.ok) throw new AiProviderHttpError('AI summary request failed');
    const responseBody: unknown = await response.json();
    return openAiCompatible
      ? OpenAiResponseSchema.parse(responseBody).choices[0]!.message.content
      : OllamaResponseSchema.parse(responseBody).message.content;
  }

  private async generateSummary(
    summary: ClaimedSummary,
    metrics: z.infer<typeof GameMetricsSchema>,
  ) {
    const controller = new AbortController();
    const { env, prisma } = this.dependencies;
    let leaseLost = false;
    const renewEveryMs = Math.max(1, Math.floor(env.OLLAMA_LEASE_MS / 3));
    const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);
    const renewal = setInterval(() => {
      if (this.#stopping) {
        controller.abort();
        return;
      }
      void prisma.trAiSessionSummary
        .updateMany({
          where: {
            id: summary.id,
            status: 'PROCESSING',
            leaseToken: summary.leaseToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: { leaseExpiresAt: new Date(Date.now() + env.OLLAMA_LEASE_MS) },
        })
        .then(({ count }) => {
          if (count !== 1) {
            leaseLost = true;
            controller.abort();
          }
        })
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, renewEveryMs);
    timeout.unref();
    renewal.unref();
    this.#activeRequest = controller;

    try {
      const messages = [
        {
          role: 'system',
          content: SESSION_SUMMARY_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: sessionSummaryUserPrompt(
            buildAiSummaryInput({
              mode: summary.session.mode,
              ruleVersion: summary.session.ruleVersion.version,
              completedAt: summary.session.completedAt,
              score: summary.session.result.score,
              metrics,
            }),
          ),
        },
      ];
      const openAiCompatible = env.OLLAMA_PROVIDER === 'openai';
      const response = await fetch(
        openAiCompatible
          ? `${env.OLLAMA_BASE_URL}/chat/completions`
          : `${env.OLLAMA_BASE_URL}/api/chat`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(openAiCompatible ? { authorization: `Bearer ${env.OLLAMA_API_KEY}` } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify(
            openAiCompatible
              ? {
                  model: env.OLLAMA_MODEL,
                  messages,
                  temperature: 0.2,
                  response_format: { type: 'json_object' },
                }
              : {
                  model: env.OLLAMA_MODEL,
                  stream: false,
                  format: SUMMARY_FORMAT,
                  options: { temperature: 0.2 },
                  messages,
                },
          ),
        },
      );
      if (!response.ok) {
        this.dependencies.logger.warn(
          {
            status: response.status,
            provider: env.OLLAMA_PROVIDER,
            model: env.OLLAMA_MODEL,
          },
          'AI provider HTTP request gagal',
        );
        throw new AiProviderHttpError('AI summary request failed');
      }

      const responseBody: unknown = await response.json();
      const content = openAiCompatible
        ? OpenAiResponseSchema.parse(responseBody).choices[0]!.message.content
        : OllamaResponseSchema.parse(responseBody).message.content;
      const output = parseGroundedSummaryOutput(summary.session.mode, JSON.parse(content));
      if (leaseLost) throw new LeaseLostError();
      return output;
    } catch (error) {
      if (leaseLost) throw new LeaseLostError();
      throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(renewal);
      if (this.#activeRequest === controller) this.#activeRequest = null;
    }
  }
}

export function createAiSummaryWorker(dependencies: AiSummaryWorkerDependencies): AiSummaryWorker {
  return new AiSummaryWorker(dependencies);
}
