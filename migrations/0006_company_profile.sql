-- Company profile fields printed on documents. Logo/seal, bank and numbering
-- columns already exist from 0001; this only adds the fax number.
ALTER TABLE organizations ADD COLUMN fax TEXT NOT NULL DEFAULT '';
