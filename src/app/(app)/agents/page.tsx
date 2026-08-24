import { Users } from 'lucide-react';
import { redirect } from 'next/navigation';

import { Glass, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { getSession, toActor } from '@/lib/auth/session';
import { getAgentRollup, getAllAgentCustomers, getFormOptions } from '@/services/queries';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { AgentManager } from './agent-manager';
import { AgentRows } from './agent-rows';

export const metadata = { title: 'Agents' };
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const [rows, options] = await Promise.all([getAgentRollup(actor), getFormOptions(actor)]);
  // Every agent's cases come down with the page, so expanding a row is instant and needs no
  // round-trip — which matters on a branch PC reaching this over the office LAN.
  const cases = await getAllAgentCustomers(actor);
  const canManage = roleCan(session.role, 'agent.manage');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agents"
        description="Open an agent to see every customer and whether they have had everything they are owed."
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
          <AgentRows agents={rows.map((r) => ({
            agentId: r.agentId,
            agentName: r.agentName,
            agentCode: r.agentCode,
            branchName: r.branchName,
            liveCases: r.liveCases,
            totalPaise: r.totalPaise,
            paidPaise: r.paidPaise,
          }))} cases={serialize(cases)} />
        </Glass>
      )}
    </div>
  );
}
