INSERT INTO "TrParticipantModeSummary" (
  "id",
  "participantId",
  "institutionId",
  "mode",
  "aggregateMetrics",
  "participantSummary",
  "clinicianSummary",
  "source",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(result."participantId"::text || ':' || result."mode"::text)::uuid,
  result."participantId",
  result."institutionId",
  result."mode",
  CASE result."mode"
    WHEN 'MOTOR_GRIP' THEN jsonb_build_object(
      'mode', result."mode",
      'sessions', count(*),
      'averageScore', round(avg(result."score")),
      'averageKilograms', avg(COALESCE((result."metrics"->>'averageKilograms')::numeric, 0)),
      'averagePeakKilograms', avg(COALESCE((result."metrics"->>'peakKilograms')::numeric, 0)),
      'averageContinuousHoldMs', avg(COALESCE((result."metrics"->>'continuousHoldMs')::numeric, 0))
    )
    WHEN 'GO_NO_GO' THEN jsonb_build_object(
      'mode', result."mode",
      'sessions', count(*),
      'averageScore', round(avg(result."score")),
      'averageAccuracyPercent', avg((result."metrics"->>'accuracyPercent')::numeric),
      'averageReactionMs', avg((result."metrics"->>'meanHitReactionMs')::numeric) FILTER (WHERE result."metrics"->>'meanHitReactionMs' IS NOT NULL),
      'hits', sum((result."metrics"->>'hits')::integer),
      'misses', sum((result."metrics"->>'misses')::integer),
      'falsePositives', sum((result."metrics"->>'falsePositives')::integer)
    )
    ELSE jsonb_build_object(
      'mode', result."mode",
      'sessions', count(*),
      'averageScore', round(avg(result."score")),
      'averageMaxSequenceLength', avg((result."metrics"->>'maxSequenceLength')::numeric),
      'averageFirstResponseMs', avg((result."metrics"->>'meanFirstResponseMs')::numeric) FILTER (WHERE result."metrics"->>'meanFirstResponseMs' IS NOT NULL),
      'wrongAttempts', sum((result."metrics"->>'wrongAttempts')::integer),
      'timedOutAttempts', sum((result."metrics"->>'timedOutAttempts')::integer)
    )
  END,
  '',
  '',
  'PENDING',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TrGameResult" result
JOIN "TrGameSession" session ON session."id" = result."sessionId"
WHERE result."participantId" IS NOT NULL
  AND session."status" = 'SAVED'
GROUP BY result."participantId", result."institutionId", result."mode"
ON CONFLICT ("participantId", "mode") DO NOTHING;
