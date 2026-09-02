import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (sql) => {
  const r = await c.query(sql);
  console.log('\n---');
  console.table(r.rows);
  return r.rows;
};

await q(`
  SELECT status, count(*)::int n,
         count(approved_on)::int with_anchor,
         count(*) FILTER (WHERE instrument_maturity_on IS NOT NULL)::int with_mat
  FROM maturity_cases
  WHERE status NOT IN ('CANCELLED','REJECTED')
  GROUP BY 1
`);
await q(`SELECT count(*)::int instalments FROM payout_instalments`);
await q(`SELECT status, count(*)::int n FROM payout_instalments GROUP BY 1`);
await q(`
  SELECT due_on::text, status, count(*)::int n, sum(amount_paise)::text planned
  FROM payout_instalments
  GROUP BY 1,2
  ORDER BY 1,2
`);
await q(`
  SELECT to_char(instrument_maturity_on, 'YYYY-MM-DD') mat,
         to_char(approved_on, 'YYYY-MM-DD') anchor,
         status,
         window_days,
         count(*)::int n
  FROM maturity_cases
  WHERE status NOT IN ('CANCELLED','REJECTED')
  GROUP BY 1,2,3,4
  ORDER BY n DESC
`);
await q(`
  SELECT a.name agent, count(*)::int cases, sum(mc.maturity_amount_paise)::text amt
  FROM maturity_cases mc
  JOIN agents a ON a.id = mc.agent_id
  WHERE mc.status NOT IN ('CANCELLED','REJECTED')
  GROUP BY 1
  ORDER BY 2 DESC
`);
await q(`
  SELECT
    count(*) FILTER (WHERE live_instalment_count > 0)::int scheduled,
    count(*)::int total
  FROM (
    SELECT mc.id,
           (SELECT count(*) FROM payout_instalments i
            WHERE i.case_id = mc.id AND i.status <> 'SUPERSEDED') live_instalment_count
    FROM maturity_cases mc
    WHERE mc.status NOT IN ('CANCELLED','REJECTED')
  ) x
`);
await c.end();
