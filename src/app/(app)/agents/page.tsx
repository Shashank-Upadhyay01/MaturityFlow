import { Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { getSession, toActor } from '@/lib/auth/session';
import { getAgentRollup, getFormOptions } from '@/services/queries';
import { roleCan } from '@/lib/rbac';
import { AgentManager } from './agent-manager';

export const metadata = { title: 'Agents' };
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const [rows, options] = await Promise.all([getAgentRollup(actor), getFormOptions(actor)]);
  const canManage = roleCan(session.role, 'agent.manage');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agents"
        description="How much is still owed on each agent’s customers."
        actions={
          canManage ? (
            <AgentManager
              branches={options.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
              defaultBranchId={session.branchId}
            />
          ) : null
        }
      />

      {rows.length === 0 ? (
        <Glass>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No agents yet"
            description="Import the Excel register, or add an agent here. They appear on the sheet’s agent filter."
          />
        </Glass>
      ) : (
        <Glass className="p-0">
          <Table>
            <THead>
              <TH>Agent</TH>
              <TH>Branch</TH>
              <TH align="right">Still owed</TH>
              <TH align="right">Remaining</TH>
              <TH />
            </THead>
            <TBody>
              {rows.map((r) => {
                const remaining = BigInt(r.totalPaise) - BigInt(r.paidPaise);
                return (
                  <TR key={r.agentId}>
                    <TD>
                      <span className="block font-medium">{r.agentName}</span>
                      <span className="block text-[0.75rem] text-[var(--faint-fg)]">{r.agentCode}</span>
                    </TD>
                    <TD className="text-[var(--muted-fg)]">{r.branchName}</TD>
                    <TD align="right" className="tabular-nums">
                      {r.liveCases}
                    </TD>
                    <TD align="right">
                      <Money paise={remaining} decimals={false} />
                    </TD>
                    <TD align="right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/maturities?q=${encodeURIComponent(r.agentName)}`}>Register</Link>
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Glass>
      )}
    </div>
  );
}
