import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { AppError } from '../middleware/errors.js';
import type { GameService } from '../modules/game/game.service.js';
import type { ParticipantService } from '../modules/participant/participant.service.js';
import type {
  GameMetrics,
  GameMode,
  GameSessionDto,
  ParticipantDetailDto,
  ReportAudience,
} from '../schemas/index.js';
import type { AuditContext, AuditEvent } from './audit.js';

const PAGE = {
  left: 48,
  right: 48,
  top: 120,
  bottom: 76,
} as const;
const COLORS = {
  ink: '#171711',
  muted: '#625F54',
  faint: '#FFFDFA',
  border: '#D9DFEB',
  yellow: '#F3C642',
  orange: '#9A5A00',
  green: '#399267',
  blue: '#356FAE',
  red: '#DC4C3F',
  grip: '#D67B1F',
  miss: '#E7B82C',
  white: '#FFFFFF',
} as const;
const FONT_FILES = {
  regular: 'nunito-latin-400-normal.woff',
  semiBold: 'nunito-latin-600-normal.woff',
  bold: 'nunito-latin-700-normal.woff',
  extraBold: 'nunito-latin-800-normal.woff',
  black: 'nunito-latin-900-normal.woff',
} as const;
const FONT_NAMES = {
  regular: 'Nunito',
  semiBold: 'Nunito SemiBold',
  bold: 'Nunito Bold',
  extraBold: 'Nunito ExtraBold',
  black: 'Nunito Black',
  brand: 'DynaPuff Bold',
} as const;
const MODE_LABELS: Readonly<Record<GameMode, string>> = {
  MOTOR_GRIP: 'Peras Jeruk',
  GO_NO_GO: 'Go-No-Go',
  SEQUENCE_MEMORY: 'Ding Dong Dong',
};

type ReportAuditWriter = (context: AuditContext, event: AuditEvent) => Promise<void>;
type MetricItem = { readonly label: string; readonly value: string };
type ReportHeader = {
  readonly audience: ReportAudience;
  readonly title: string;
  readonly institutionName: string;
};

export interface ReportRequestContext extends AuditContext {
  readonly institutionId: string;
  readonly institutionName: string;
}

function fontPath(file: string): string {
  return fileURLToPath(import.meta.resolve(`@fontsource/nunito/files/${file}`));
}

function brandFontPath(): string {
  return fileURLToPath(import.meta.resolve('@fontsource/dynapuff/files/dynapuff-latin-700-normal.woff'));
}

function logoPath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return moduleDirectory.endsWith(`${join('dist', 'services')}`)
    ? join(moduleDirectory, '..', '..', 'src', 'assets', 'arka.png')
    : join(moduleDirectory, '..', 'assets', 'arka.png');
}

function createDocument(): PDFKit.PDFDocument {
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: { Title: 'ARKA Report', Author: 'ARKA' },
  });
  document.registerFont(FONT_NAMES.regular, fontPath(FONT_FILES.regular));
  document.registerFont(FONT_NAMES.semiBold, fontPath(FONT_FILES.semiBold));
  document.registerFont(FONT_NAMES.bold, fontPath(FONT_FILES.bold));
  document.registerFont(FONT_NAMES.extraBold, fontPath(FONT_FILES.extraBold));
  document.registerFont(FONT_NAMES.black, fontPath(FONT_FILES.black));
  document.registerFont(FONT_NAMES.brand, brandFontPath());
  return document;
}

function addPage(document: PDFKit.PDFDocument): void {
  document.addPage({
    size: 'A4',
    margins: PAGE,
  });
}

function audienceLabel(audience: ReportAudience): string {
  return audience === 'participant' ? 'LAPORAN PERKEMBANGAN UNTUK PESERTA' : 'LAPORAN PERKEMBANGAN UNTUK DOKTER';
}

function formatDate(value: string | null): string {
  if (!value) return 'Tidak tersedia';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits }).format(value);
}

function formatMilliseconds(value: number | null): string {
  return value === null ? 'Tidak tersedia' : `${formatNumber(value, 0)} ms`;
}

function normalizeSummaryText(value: string): string {
  return value.replace(
    /persentase akurasi\s+(\d+(?:[.,]\d+)?)\s+pada\s+(\d+)\s+total percobaan/giu,
    'akurasi $1% pada total $2 percobaan',
  );
}

function drawHeaderAndFooter(document: PDFKit.PDFDocument, header: ReportHeader): void {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const width = document.page.width;
    const contentWidth = width - PAGE.left - PAGE.right;
    document.save();
    document.image(logoPath(), PAGE.left, 20, { fit: [28, 28], align: 'center', valign: 'center' });
    document.font(FONT_NAMES.brand).fontSize(13).fillColor(COLORS.orange).text(
      'ARKA',
      PAGE.left + 32,
      28,
      { width: 70, lineBreak: false },
    );
    document.font(FONT_NAMES.black).fontSize(8).fillColor(COLORS.orange).text(
      audienceLabel(header.audience),
      PAGE.left,
      58,
      { width: contentWidth - 100, characterSpacing: 0.45, lineBreak: false, ellipsis: true },
    );
    document.font(FONT_NAMES.black).fontSize(12).fillColor(COLORS.ink).text(
      header.title,
      PAGE.left,
      73,
      { width: contentWidth - 100, lineBreak: false, ellipsis: true },
    );
    document.font(FONT_NAMES.black).fontSize(9).fillColor(COLORS.orange).text(
      header.institutionName,
      width - PAGE.right - 190,
      28,
      { width: 190, align: 'right', lineBreak: false, ellipsis: true },
    );
    document.font(FONT_NAMES.bold).fontSize(8.5).fillColor(COLORS.muted).text(
      `Halaman ${index - range.start + 1} dari ${range.count}`,
      width - PAGE.right - 90,
      73,
      { width: 90, align: 'right', lineBreak: false },
    );
    document.moveTo(PAGE.left, 100).lineTo(width - PAGE.right, 100).lineWidth(2).strokeColor(COLORS.yellow).stroke();
    const footerRuleY = document.page.height - 51;
    document.moveTo(PAGE.left, footerRuleY).lineTo(width - PAGE.right, footerRuleY).lineWidth(3).strokeColor(COLORS.yellow).stroke();
    document.image(logoPath(), PAGE.left, footerRuleY + 9, { fit: [24, 24], align: 'center', valign: 'center' });
    document.font(FONT_NAMES.brand).fontSize(11).fillColor(COLORS.orange).text(
      'ARKA',
      PAGE.left + 28,
      footerRuleY + 15,
      { width: 70, height: 14, lineBreak: false },
    );
    document.font(FONT_NAMES.black).fontSize(8.5).fillColor(COLORS.orange).text(
      header.institutionName,
      PAGE.left + 100,
      footerRuleY + 15,
      { width: contentWidth - 100, height: 14, align: 'right', lineBreak: false, ellipsis: true },
    );
    document.restore();
  }
}

function bufferDocument(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}

function pageTitle(document: PDFKit.PDFDocument, eyebrow: string, title: string, subtitle?: string): void {
  document.x = PAGE.left;
  document.font(FONT_NAMES.black).fontSize(9).fillColor(COLORS.orange).text(eyebrow.toUpperCase(), { width: document.page.width - PAGE.left - PAGE.right, characterSpacing: 0.7 });
  document.moveDown(0.45);
  document.font(FONT_NAMES.black).fontSize(24).fillColor(COLORS.ink).text(title, { lineGap: 1 });
  if (subtitle) {
    document.moveDown(0.35);
    document.font(FONT_NAMES.semiBold).fontSize(10).fillColor(COLORS.muted).text(subtitle, { lineGap: 2 });
  }
  document.moveDown(1.1);
}

function sectionTitle(document: PDFKit.PDFDocument, title: string): void {
  document.x = PAGE.left;
  document.font(FONT_NAMES.black).fontSize(13).fillColor(COLORS.orange).text(title, { width: document.page.width - PAGE.left - PAGE.right });
  document.moveDown(0.35);
  document.moveTo(PAGE.left, document.y).lineTo(document.page.width - PAGE.right, document.y).lineWidth(1.5).strokeColor(COLORS.yellow).stroke();
  document.moveDown(0.65);
}

function chartTitle(document: PDFKit.PDFDocument, title: string): void {
  document.x = PAGE.left;
  document.font(FONT_NAMES.black).fontSize(13).fillColor(COLORS.ink).text(title, {
    width: document.page.width - PAGE.left - PAGE.right,
  });
  document.moveDown(0.7);
}

function drawMetricCards(document: PDFKit.PDFDocument, items: readonly MetricItem[], columns = 3): void {
  const gap = 10;
  const width = document.page.width - PAGE.left - PAGE.right;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = 62;
  const startY = document.y;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PAGE.left + column * (cardWidth + gap);
    const y = startY + row * (cardHeight + gap);
    document.roundedRect(x, y, cardWidth, cardHeight, 8).fillAndStroke(COLORS.faint, COLORS.border);
    document.font(FONT_NAMES.bold).fontSize(8).fillColor(COLORS.muted).text(item.label, x + 12, y + 11, {
      width: cardWidth - 24,
      lineBreak: false,
      ellipsis: true,
    });
    document.font(FONT_NAMES.black).fontSize(15).fillColor(COLORS.ink).text(item.value, x + 12, y + 31, {
      width: cardWidth - 24,
      lineBreak: false,
      ellipsis: true,
    });
  });
  const rows = Math.ceil(items.length / columns);
  document.x = PAGE.left;
  document.y = startY + rows * cardHeight + Math.max(0, rows - 1) * gap + 18;
}

function drawNarrative(document: PDFKit.PDFDocument, title: string, narrative: string | null): void {
  const text = narrative?.trim() ? normalizeSummaryText(narrative.trim()) : 'Ringkasan belum tersedia.';
  const width = document.page.width - PAGE.left - PAGE.right;
  const textWidth = width - 36;
  document.font(FONT_NAMES.bold).fontSize(10.5);
  const textHeight = document.heightOfString(text, { width: textWidth, lineGap: 4 });
  const boxHeight = textHeight + 28;
  if (document.y + 42 + boxHeight > document.page.height - PAGE.bottom) addPage(document);
  document.x = PAGE.left;
  sectionTitle(document, title);
  const boxY = document.y;
  document.roundedRect(PAGE.left, boxY, width, boxHeight, 8).fill(COLORS.faint);
  document.rect(PAGE.left, boxY, 6, boxHeight).fill(COLORS.yellow);
  document.font(FONT_NAMES.bold).fontSize(10.5).fillColor(COLORS.ink).text(text, PAGE.left + 20, boxY + 14, {
    width: textWidth,
    lineGap: 4,
  });
  document.x = PAGE.left;
  document.y = boxY + boxHeight + 12;
}

function participantNarrative(
  participant: ParticipantDetailDto,
  audience: ReportAudience,
): string | null {
  if (!participant.aggregateSummary) return null;
  return audience === 'participant'
    ? participant.aggregateSummary.participantSummary
    : participant.aggregateSummary.clinicianSummary;
}

function modeNarrative(
  summary: ParticipantDetailDto['modeSummaries'][number],
  audience: ReportAudience,
): string | null {
  if (!summary.narrativeSummary) return null;
  return audience === 'participant'
    ? summary.narrativeSummary.participantSummary
    : summary.narrativeSummary.clinicianSummary;
}

function participantModeMetrics(
  summary: ParticipantDetailDto['modeSummaries'][number],
): MetricItem[] {
  const metrics = summary.overallMetrics;
  const base: MetricItem[] = [
    { label: 'Jumlah permainan', value: formatNumber(summary.savedSessionsTotal, 0) },
    { label: 'Skor terbaru', value: summary.latestSession ? formatNumber(summary.latestSession.score, 0) : 'Belum ada' },
    { label: 'Rata-rata skor', value: metrics ? formatNumber(metrics.averageScore, 0) : 'Belum ada' },
  ];
  if (!metrics) return base;
  if (metrics.mode === 'MOTOR_GRIP') {
    return [
      ...base,
      { label: 'Rata-rata puncak', value: `${formatNumber(metrics.averagePeakKilograms)} kg` },
      { label: 'Rata-rata kekuatan', value: `${formatNumber(metrics.averageKilograms)} kg` },
      { label: 'Rata-rata tahan kontinu', value: formatMilliseconds(metrics.averageContinuousHoldMs) },
    ];
  }
  if (metrics.mode === 'GO_NO_GO') {
    return [
      ...base,
      { label: 'Rata-rata akurasi', value: `${formatNumber(metrics.averageAccuracyPercent)}%` },
      { label: 'Rata-rata reaksi', value: formatMilliseconds(metrics.averageReactionMs) },
      { label: 'Total percobaan', value: formatNumber(metrics.totalTrials, 0) },
      { label: 'Respons tepat', value: formatNumber(metrics.totalHits + metrics.totalCorrectRejections, 0) },
      { label: 'Respons keliru', value: formatNumber(metrics.totalMisses + metrics.totalFalsePositives, 0) },
    ];
  }
  return [
    ...base,
    { label: 'Rata-rata rentang memori', value: formatNumber(metrics.averageMemorySpan) },
    { label: 'Rata-rata respons pertama', value: formatMilliseconds(metrics.averageFirstResponseMs) },
    { label: 'Level terukur', value: formatNumber(metrics.levelLatencies.length, 0) },
  ];
}

function sessionMetricItems(metrics: GameMetrics, score: number): MetricItem[] {
  const base = [{ label: 'Skor', value: formatNumber(score, 0) }];
  if (metrics.mode === 'MOTOR_GRIP') {
    return [
      ...base,
      { label: 'Puncak kekuatan', value: `${formatNumber(metrics.peakKilograms)} kg` },
      { label: 'Rata-rata kekuatan', value: `${formatNumber(metrics.averageKilograms)} kg` },
      { label: 'Target', value: `${formatNumber(metrics.targetKilograms)} kg` },
      { label: 'Tahan kontinu', value: formatMilliseconds(metrics.continuousHoldMs) },
      { label: 'Target tercapai', value: metrics.targetCompleted ? 'Ya' : 'Belum' },
    ];
  }
  if (metrics.mode === 'GO_NO_GO') {
    return [
      ...base,
      { label: 'Akurasi', value: `${formatNumber(metrics.accuracyPercent)}%` },
      { label: 'Rata-rata reaksi', value: formatMilliseconds(metrics.meanHitReactionMs) },
      { label: 'Respons tepat', value: formatNumber(metrics.hits + metrics.correctRejections, 0) },
      { label: 'Terlewat', value: formatNumber(metrics.misses, 0) },
      { label: 'Respons tidak tepat', value: formatNumber(metrics.falsePositives, 0) },
    ];
  }
  return [
    ...base,
    { label: 'Rentang memori', value: formatNumber(metrics.maxSequenceLength, 0) },
    { label: 'Level selesai', value: formatNumber(metrics.completedLevels, 0) },
    { label: 'Respons pertama', value: formatMilliseconds(metrics.meanFirstResponseMs) },
    { label: 'Percobaan keliru', value: formatNumber(metrics.wrongAttempts, 0) },
    { label: 'Kehabisan waktu', value: formatNumber(metrics.timedOutAttempts, 0) },
  ];
}

function polarPoint(centerX: number, centerY: number, radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: centerX + radius * Math.cos(radians), y: centerY + radius * Math.sin(radians) };
}

function drawDonutChart(
  document: PDFKit.PDFDocument,
  title: string,
  items: readonly { readonly label: string; readonly value: number; readonly color: string }[],
  centerLabel: string,
): void {
  chartTitle(document, title);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chartTop = document.y;
  const centerX = PAGE.left + 92;
  const centerY = chartTop + 92;
  const radius = 72;
  let angle = 0;
  for (const item of items) {
    const sweep = total === 0 ? 0 : item.value / total * 360;
    if (sweep >= 359.999) {
      document.circle(centerX, centerY, radius).fill(item.color);
    } else if (sweep > 0) {
      const start = polarPoint(centerX, centerY, radius, angle);
      const end = polarPoint(centerX, centerY, radius, angle + sweep);
      const largeArc = sweep > 180 ? 1 : 0;
      document.path(`M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`).fill(item.color);
    }
    angle += sweep;
  }
  if (total === 0) document.circle(centerX, centerY, radius).fill(COLORS.border);
  document.circle(centerX, centerY, 48).fill(COLORS.white);
  document.font(FONT_NAMES.black).fontSize(17).fillColor(COLORS.ink).text(centerLabel, centerX - 45, centerY - 9, {
    width: 90,
    align: 'center',
    lineBreak: false,
  });
  const legendX = PAGE.left + 205;
  items.forEach((item, index) => {
    const y = chartTop + 24 + index * 42;
    document.circle(legendX, y + 5, 5).fill(item.color);
    document.font(FONT_NAMES.bold).fontSize(9).fillColor(COLORS.muted).text(item.label, legendX + 14, y, {
      width: 150,
      lineBreak: false,
      ellipsis: true,
    });
    document.font(FONT_NAMES.black).fontSize(11).fillColor(COLORS.ink).text(formatNumber(item.value, 0), legendX + 170, y - 1, {
      width: 70,
      align: 'right',
      lineBreak: false,
    });
  });
  document.x = PAGE.left;
  document.y = centerY + radius + 26;
}

function drawLineChart(
  document: PDFKit.PDFDocument,
  title: string,
  points: readonly { readonly label: string; readonly value: number; readonly display: string }[],
  color: string,
): void {
  if (points.length === 0) return;
  chartTitle(document, title);
  const chartX = PAGE.left + 42;
  const chartY = document.y + 22;
  const chartWidth = document.page.width - PAGE.left - PAGE.right - 58;
  const chartHeight = 180;
  const maximum = Math.max(1, ...points.map((point) => point.value)) * 1.15;
  for (let index = 0; index <= 3; index += 1) {
    const y = chartY + chartHeight / 3 * index;
    document.moveTo(chartX, y).lineTo(chartX + chartWidth, y).lineWidth(0.7).strokeColor(COLORS.border).stroke();
    document.font(FONT_NAMES.semiBold).fontSize(7.5).fillColor(COLORS.muted).text(
      formatNumber(maximum * (1 - index / 3), 0),
      PAGE.left,
      y - 4,
      { width: 34, align: 'right', lineBreak: false },
    );
  }
  points.forEach((point, index) => {
    const x = chartX + index / Math.max(points.length - 1, 1) * chartWidth;
    const y = chartY + chartHeight - point.value / maximum * chartHeight;
    if (index === 0) document.moveTo(x, y);
    else document.lineTo(x, y);
  });
  if (points.length > 1) document.lineWidth(3).lineCap('round').lineJoin('round').strokeColor(color).stroke();
  points.forEach((point, index) => {
    const x = chartX + index / Math.max(points.length - 1, 1) * chartWidth;
    const y = chartY + chartHeight - point.value / maximum * chartHeight;
    document.lineWidth(2).circle(x, y, 5).fillAndStroke(COLORS.white, color);
    document.font(FONT_NAMES.black).fontSize(8).fillColor(COLORS.ink).text(point.display, x - 32, y - 18, {
      width: 64,
      align: 'center',
      lineBreak: false,
    });
    document.font(FONT_NAMES.bold).fontSize(8).fillColor(COLORS.muted).text(point.label, x - 32, chartY + chartHeight + 12, {
      width: 64,
      align: 'center',
      lineBreak: false,
    });
  });
  document.x = PAGE.left;
  document.y = chartY + chartHeight + 42;
}

function drawParticipantModeChart(
  document: PDFKit.PDFDocument,
  summary: ParticipantDetailDto['modeSummaries'][number],
): void {
  const metrics = summary.overallMetrics;
  if (!metrics) return;
  if (metrics.mode === 'MOTOR_GRIP') {
    drawBarChart(document, 'Perbandingan kekuatan rata-rata', [
      { label: 'Kekuatan rata-rata', value: metrics.averageKilograms, display: `${formatNumber(metrics.averageKilograms)} kg`, color: COLORS.orange },
      { label: 'Puncak rata-rata', value: metrics.averagePeakKilograms, display: `${formatNumber(metrics.averagePeakKilograms)} kg`, color: COLORS.yellow },
    ], Math.max(5, metrics.averagePeakKilograms));
    return;
  }
  if (metrics.mode === 'GO_NO_GO') {
    drawDonutChart(document, 'Komposisi respons seluruh permainan', [
      { label: 'Respons tepat', value: metrics.totalHits + metrics.totalCorrectRejections, color: COLORS.green },
      { label: 'Terlewat', value: metrics.totalMisses, color: COLORS.miss },
      { label: 'Respons keliru', value: metrics.totalFalsePositives, color: COLORS.red },
    ], `${formatNumber(metrics.averageAccuracyPercent, 0)}%`);
    return;
  }
  drawLineChart(document, 'Rata-rata waktu respons per level', metrics.levelLatencies.map((point) => ({
    label: `Level ${point.level}`,
    value: point.latencyMs,
    display: `${formatNumber(point.latencyMs, 0)} ms`,
  })), COLORS.blue);
}

function renderParticipantContent(
  document: PDFKit.PDFDocument,
  participant: ParticipantDetailDto,
  audience: ReportAudience,
): void {
  addPage(document);
  pageTitle(document, 'Ringkasan keseluruhan', 'Laporan Perkembangan Peserta', participant.displayName);
  const scoredModes = participant.modeSummaries.filter((summary) => summary.overallMetrics !== null);
  drawMetricCards(document, participant.modeSummaries.map((summary) => ({
    label: MODE_LABELS[summary.mode],
    value: summary.overallMetrics ? formatNumber(summary.overallMetrics.averageScore, 0) : 'Belum ada',
  })));
  if (scoredModes.length > 0) {
    drawBarChart(document, 'Perbandingan skor rata-rata', scoredModes.map((summary) => ({
      label: MODE_LABELS[summary.mode],
      value: summary.overallMetrics?.averageScore ?? 0,
      display: formatNumber(summary.overallMetrics?.averageScore ?? 0, 0),
      color: summary.mode === 'MOTOR_GRIP' ? COLORS.orange : summary.mode === 'GO_NO_GO' ? COLORS.green : COLORS.blue,
    })), 1000);
  }
  drawNarrative(document, 'Ringkasan keseluruhan', participantNarrative(participant, audience));

  for (const mode of ['MOTOR_GRIP', 'GO_NO_GO', 'SEQUENCE_MEMORY'] as const) {
    const summary = participant.modeSummaries.find((item) => item.mode === mode);
    addPage(document);
    pageTitle(
      document,
      'Perkembangan per permainan',
      MODE_LABELS[mode],
      summary?.latestSession
        ? `Sesi terbaru ${formatDate(summary.latestSession.completedAt)}`
        : 'Belum ada sesi tersimpan',
    );
    if (!summary) {
      drawNarrative(document, 'Ringkasan permainan', null);
      continue;
    }
    drawMetricCards(document, participantModeMetrics(summary));
    drawParticipantModeChart(document, summary);
    drawNarrative(document, `Ringkasan ${MODE_LABELS[mode]}`, modeNarrative(summary, audience));
  }
}

function selectedSessionSummary(
  session: GameSessionDto,
  audience: ReportAudience,
): { readonly summary: string | null; readonly observations: readonly string[] } {
  const aiSummary = session.result?.aiSummary;
  if (!aiSummary || aiSummary.status !== 'READY') return { summary: null, observations: [] };
  const selected = audience === 'participant' ? aiSummary.participant : aiSummary.clinician;
  return { summary: selected.summaryText, observations: selected.observations };
}

function drawObservations(document: PDFKit.PDFDocument, observations: readonly string[], title = 'Observasi'): void {
  sectionTitle(document, title);
  if (observations.length === 0) {
    document.font(FONT_NAMES.regular).fontSize(10.5).fillColor(COLORS.muted).text('Observasi belum tersedia.');
    return;
  }
  for (const observation of observations) {
    document.circle(PAGE.left + 4, document.y + 6, 2.5).fill(COLORS.yellow);
    document.font(FONT_NAMES.regular).fontSize(10).fillColor(COLORS.ink).text(normalizeSummaryText(observation), PAGE.left + 16, document.y, {
      width: document.page.width - PAGE.left - PAGE.right - 16,
      lineGap: 2,
    });
    document.moveDown(0.55);
  }
}

function drawBarChart(
  document: PDFKit.PDFDocument,
  title: string,
  items: readonly { readonly label: string; readonly value: number; readonly display: string; readonly color: string }[],
  maximum?: number,
): void {
  chartTitle(document, title);
  const chartX = PAGE.left + 112;
  const chartWidth = document.page.width - PAGE.right - chartX - 54;
  const startY = document.y + 8;
  const max = maximum ?? Math.max(1, ...items.map((item) => item.value));
  items.forEach((item, index) => {
    const y = startY + index * 52;
    document.font(FONT_NAMES.bold).fontSize(9).fillColor(COLORS.ink).text(item.label, PAGE.left, y + 7, {
      width: 100,
      align: 'right',
      lineBreak: false,
      ellipsis: true,
    });
    document.roundedRect(chartX, y, chartWidth, 26, 5).fill(COLORS.faint);
    const fillWidth = item.value <= 0 ? 0 : Math.max(3, Math.min(chartWidth, (item.value / max) * chartWidth));
    if (fillWidth > 0) document.roundedRect(chartX, y, fillWidth, 26, 5).fill(item.color);
    document.font(FONT_NAMES.extraBold).fontSize(9).fillColor(COLORS.ink).text(item.display, chartX + chartWidth + 8, y + 7, {
      width: 46,
      align: 'right',
      lineBreak: false,
      ellipsis: true,
    });
  });
  document.x = PAGE.left;
  document.y = startY + items.length * 52 + 8;
}

function drawGripChart(document: PDFKit.PDFDocument, metrics: Extract<GameMetrics, { mode: 'MOTOR_GRIP' }>): void {
  chartTitle(document, 'Kekuatan genggam sepanjang sesi');
  const x = PAGE.left + 34;
  const y = document.y + 16;
  const width = document.page.width - PAGE.left - PAGE.right - 48;
  const height = 250;
  const samples = metrics.gripSamples;
  const maximum = Math.max(metrics.targetKilograms, metrics.peakKilograms, ...samples.map((sample) => sample.kilograms), 1);
  document.rect(x, y, width, height).fillAndStroke(COLORS.faint, COLORS.border);
  for (let index = 0; index <= 4; index += 1) {
    const gridY = y + (height / 4) * index;
    document.moveTo(x, gridY).lineTo(x + width, gridY).lineWidth(0.5).strokeColor(COLORS.border).stroke();
    const value = maximum * (1 - index / 4);
    document.font(FONT_NAMES.regular).fontSize(8).fillColor(COLORS.muted).text(`${formatNumber(value)} kg`, PAGE.left, gridY - 4, {
      width: 28,
      align: 'right',
      lineBreak: false,
    });
  }
  const targetY = y + height - (metrics.targetKilograms / maximum) * height;
  document.moveTo(x, targetY).lineTo(x + width, targetY).dash(4, { space: 3 }).lineWidth(1.5).strokeColor(COLORS.orange).stroke().undash();
  if (samples.length > 1) {
    samples.forEach((sample, index) => {
      const pointX = x + (index / (samples.length - 1)) * width;
      const pointY = y + height - (sample.kilograms / maximum) * height;
      if (index === 0) document.moveTo(pointX, pointY);
      else document.lineTo(pointX, pointY);
    });
    document.lineWidth(2.5).strokeColor(COLORS.grip).stroke();
  } else {
    const peakHeight = (metrics.peakKilograms / maximum) * height;
    document.roundedRect(x + width / 2 - 36, y + height - peakHeight, 72, peakHeight, 5).fill(COLORS.blue);
  }
  document.font(FONT_NAMES.bold).fontSize(8.5).fillColor(COLORS.orange).text(
    `Target ${formatNumber(metrics.targetKilograms)} kg`,
    x + width - 120,
    targetY - 15,
    { width: 116, align: 'right', lineBreak: false },
  );
  document.font(FONT_NAMES.regular).fontSize(8.5).fillColor(COLORS.muted).text('Awal sesi', x, y + height + 12, { lineBreak: false });
  document.text('Akhir sesi', x + width - 70, y + height + 12, { width: 70, align: 'right', lineBreak: false });
  document.y = y + height + 46;
}

function renderSessionVisual(document: PDFKit.PDFDocument, metrics: GameMetrics): void {
  if (metrics.mode === 'MOTOR_GRIP') {
    drawGripChart(document, metrics);
    return;
  }
  if (metrics.mode === 'GO_NO_GO') {
    drawDonutChart(document, 'Distribusi respons', [
      { label: 'Jawaban benar', value: metrics.hits + metrics.correctRejections, color: COLORS.green },
      { label: 'Terlewat', value: metrics.misses, color: COLORS.miss },
      { label: 'Jawaban keliru', value: metrics.falsePositives, color: COLORS.red },
    ], `${formatNumber(metrics.accuracyPercent, 0)}%`);
    return;
  }
  if (metrics.levelLatencies.length > 0) {
    drawLineChart(document, 'Waktu respons per level', metrics.levelLatencies.map((point) => ({
      label: `Level ${point.level}`,
      value: point.latencyMs,
      display: `${formatNumber(point.latencyMs, 0)} ms`,
    })), COLORS.green);
  } else {
    drawNarrative(document, 'Waktu respons per level', 'Data latensi per level belum tersedia.');
  }
}

function renderSessionContent(
  document: PDFKit.PDFDocument,
  session: GameSessionDto,
  audience: ReportAudience,
): void {
  const result = session.result;
  if (!result) throw new AppError(409, 'report_unavailable', 'Laporan belum tersedia.');
  const selected = selectedSessionSummary(session, audience);
  addPage(document);
  pageTitle(
    document,
    'Hasil sesi',
    MODE_LABELS[session.mode],
    `${session.displayName} · Disimpan ${formatDate(result.savedAt)}`,
  );
  drawMetricCards(document, sessionMetricItems(result.metrics, result.score));
  if (audience === 'participant' && selected.observations.length > 0) {
    drawObservations(document, selected.observations, 'Poin permainanmu');
  } else {
    drawNarrative(document, 'Ringkasan sesi', selected.summary);
    document.moveDown(1.1);
    drawObservations(document, selected.observations);
  }

  addPage(document);
  pageTitle(document, 'Visualisasi sesi', MODE_LABELS[session.mode], 'Data tersimpan dari sesi permainan');
  renderSessionVisual(document, result.metrics);
}

async function participantPdf(
  participant: ParticipantDetailDto,
  audience: ReportAudience,
  institutionName: string,
): Promise<Buffer> {
  const document = createDocument();
  renderParticipantContent(document, participant, audience);
  drawHeaderAndFooter(document, {
    audience,
    title: `Peserta · ${participant.displayName}`,
    institutionName,
  });
  return bufferDocument(document);
}

async function sessionPdf(
  session: GameSessionDto,
  audience: ReportAudience,
  institutionName: string,
): Promise<Buffer> {
  const document = createDocument();
  renderSessionContent(document, session, audience);
  drawHeaderAndFooter(document, {
    audience,
    title: `${MODE_LABELS[session.mode]} · ${session.displayName}`,
    institutionName,
  });
  return bufferDocument(document);
}

export class PdfReportService {
  public constructor(
    private readonly participantService: ParticipantService,
    private readonly gameService: GameService,
    private readonly writeAudit: ReportAuditWriter,
  ) {}

  public async participantReport(
    context: ReportRequestContext,
    participantId: string,
    audience: ReportAudience,
  ): Promise<Buffer> {
    const participant = await this.participantService.getParticipant(context.institutionId, participantId);
    const report = await participantPdf(participant, audience, context.institutionName);
    await this.writeAudit(context, {
      action: 'PARTICIPANT_REPORT_EXPORTED',
      targetType: 'Participant',
      targetId: participantId,
      metadata: { audience, format: 'pdf' },
    });
    return report;
  }

  public async sessionReport(
    context: ReportRequestContext,
    sessionId: string,
    audience: ReportAudience,
  ): Promise<Buffer> {
    const session = await this.gameService.getSession(context.institutionId, sessionId);
    if (session.status !== 'SAVED' || !session.result) {
      throw new AppError(409, 'report_unavailable', 'Laporan hanya tersedia untuk sesi yang sudah tersimpan.');
    }
    const report = await sessionPdf(session, audience, context.institutionName);
    await this.writeAudit(context, {
      action: 'GAME_SESSION_REPORT_EXPORTED',
      targetType: 'GameSession',
      targetId: sessionId,
      metadata: { audience, format: 'pdf' },
    });
    return report;
  }
}
