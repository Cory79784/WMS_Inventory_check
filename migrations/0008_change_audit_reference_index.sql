-- Read-only original-inspection references use the same normalized location as task plans.
CREATE INDEX IF NOT EXISTS idx_insp_reference_location_normalized
ON location_inspections(hall_id,reference_import_id,UPPER(TRIM(location_code)));
