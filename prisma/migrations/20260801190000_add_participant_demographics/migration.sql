CREATE TYPE "ParticipantGender" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "Participant"
ADD COLUMN "dateOfBirth" DATE,
ADD COLUMN "gender" "ParticipantGender";
