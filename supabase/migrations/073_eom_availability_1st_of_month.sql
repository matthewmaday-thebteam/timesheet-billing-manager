-- Update v_eom_report_availability to use 1st of following month instead of 5th.
-- Previously: make_date(..., 1) + '4 days' = 5th. Now: just make_date(..., 1) = 1st.

CREATE OR REPLACE VIEW v_eom_report_availability AS
WITH company_months AS (
    SELECT DISTINCT cpms.company_id,
        EXTRACT(year FROM cpms.summary_month)::integer AS report_year,
        EXTRACT(month FROM cpms.summary_month)::integer AS report_month
    FROM v_canonical_project_monthly_summary cpms
    UNION
    SELECT DISTINCT mfbs.company_id,
        EXTRACT(year FROM mfbs.summary_month)::integer AS report_year,
        EXTRACT(month FROM mfbs.summary_month)::integer AS report_month
    FROM monthly_fixed_billing_summary mfbs
), eligible AS (
    SELECT cm.company_id,
        cm.report_year,
        cm.report_month,
        c.client_id,
        COALESCE(c.display_name, c.client_name) AS company_name
    FROM company_months cm
    JOIN companies c ON c.id = cm.company_id
    WHERE (CURRENT_DATE AT TIME ZONE 'Europe/Sofia')::date >= make_date(
        CASE WHEN cm.report_month = 12 THEN cm.report_year + 1 ELSE cm.report_year END,
        CASE WHEN cm.report_month = 12 THEN 1 ELSE cm.report_month + 1 END,
        1)::date
)
SELECT e.company_id,
    e.client_id,
    e.company_name,
    e.report_year,
    e.report_month,
    er.id AS report_id,
    er.generated_at,
    er.generation_number,
    er.storage_path,
    er.file_size_bytes,
    er.total_hours,
    er.total_revenue_cents,
    er.project_count,
    er.source_data_hash,
    CASE WHEN er.id IS NOT NULL THEN true ELSE false END AS has_report
FROM eligible e
LEFT JOIN eom_reports er
    ON er.company_id = e.company_id
    AND er.report_year = e.report_year
    AND er.report_month = e.report_month
ORDER BY e.report_year DESC, e.report_month DESC, e.company_name;
