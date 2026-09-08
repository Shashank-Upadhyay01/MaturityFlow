import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
  SELECT mc.id, mc.case_number, c.name customer, mc.maturity_amount_paise::text,
         mc.window_days, mc.schedule_version,
         count(i.id)::int active_parts,
         count(i.id) FILTER (WHERE i.paid_cash_paise + i.paid_online_paise > 0)::int paid_parts,
         count(i.id) FILTER (WHERE i.paid_cash_paise + i.paid_online_paise = 0)::int unpaid_parts
  FROM maturity_cases mc
  JOIN customers c ON c.id = mc.customer_id
  LEFT JOIN payout_instalments i ON i.case_id = mc.id
    AND i.schedule_version = mc.schedule_version
    AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
  WHERE mc.status NOT IN ('CANCELLED', 'REJECTED')
  GROUP BY mc.id, mc.case_number, c.name
  ORDER BY active_parts DESC, mc.case_number
`);
const expected = (amount, window) => {
  const usable = window - Math.min(3, window - 1);
  return BigInt(amount) >= 10_000_000n ? usable : Math.ceil(usable / 2);
};
const affected = rows.map((row) => ({ ...row, expected_parts: expected(row.maturity_amount_paise, row.window_days) }))
  .filter((row) => row.active_parts > row.expected_parts);
console.table(affected.map(({ id: _id, maturity_amount_paise: _amount, ...row }) => row));
console.log(JSON.stringify({ totalCases: rows.length, affectedCases: affected.length }));
await client.end();
