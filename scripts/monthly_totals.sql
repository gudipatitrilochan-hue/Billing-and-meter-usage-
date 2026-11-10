-- Monthly usage per tenant (PRD Week 1 checkpoint: "seed totals printed per tenant").
-- Run it directly with:  sqlite3 -header -column data/meterledger.db < scripts/monthly_totals.sql
SELECT
    t.name                                                              AS tenant,
    t.plan_id                                                           AS plan,
    e.period                                                            AS period,
    SUM(CASE WHEN e.meter_id = 'api_calls'   THEN e.quantity ELSE 0 END) AS api_calls,
    SUM(CASE WHEN e.meter_id = 'emails_sent' THEN e.quantity ELSE 0 END) AS emails_sent,
    COUNT(*)                                                            AS events
FROM usage_events AS e
JOIN tenants AS t ON t.id = e.tenant_id
GROUP BY t.id, e.period
ORDER BY t.name, e.period;
