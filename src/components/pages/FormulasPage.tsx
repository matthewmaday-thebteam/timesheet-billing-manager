import { Card } from '../Card';

interface FormulaCardProps {
  number: number;
  title: string;
  description: string;
  formula: string;
  unit: string;
  source?: {
    table?: string;
    view?: string;
    field?: string;
  };
  dataFlow?: string[];
  notes?: string[];
  dependsOn?: string[];
}

function FormulaCard({
  number,
  title,
  description,
  formula,
  unit,
  source,
  dataFlow,
  notes,
  dependsOn,
}: FormulaCardProps) {
  return (
    <Card variant="default" padding="lg">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-bteam-brand text-white text-sm font-semibold flex items-center justify-center">
            {number}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-vercel-gray-600">{title}</h3>
            <p className="text-sm text-vercel-gray-400 mt-1">{description}</p>
          </div>
        </div>

        {/* Dependencies */}
        {dependsOn && dependsOn.length > 0 && (
          <div className="pl-11">
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">Depends On</p>
            <div className="flex flex-wrap gap-2">
              {dependsOn.map((dep, i) => (
                <span key={i} className="px-2 py-1 bg-vercel-gray-100 text-vercel-gray-600 text-xs rounded">
                  {dep}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Source */}
        {source && (
          <div className="pl-11">
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Source</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {source.table && (
                <div>
                  <span className="text-vercel-gray-400">Table: </span>
                  <code className="text-vercel-gray-600 bg-vercel-gray-100 px-1.5 py-0.5 rounded text-xs">{source.table}</code>
                </div>
              )}
              {source.view && (
                <div>
                  <span className="text-vercel-gray-400">View: </span>
                  <code className="text-vercel-gray-600 bg-vercel-gray-100 px-1.5 py-0.5 rounded text-xs">{source.view}</code>
                </div>
              )}
              {source.field && (
                <div>
                  <span className="text-vercel-gray-400">Field: </span>
                  <code className="text-vercel-gray-600 bg-vercel-gray-100 px-1.5 py-0.5 rounded text-xs">{source.field}</code>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Data Flow */}
        {dataFlow && dataFlow.length > 0 && (
          <div className="pl-11">
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Data Flow</p>
            <div className="flex items-center flex-wrap gap-2 text-sm">
              {dataFlow.map((step, i) => (
                <span key={i} className="flex items-center gap-2">
                  <code className="text-vercel-gray-600 bg-vercel-gray-100 px-2 py-1 rounded text-xs">{step}</code>
                  {i < dataFlow.length - 1 && (
                    <svg className="w-4 h-4 text-vercel-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Formula */}
        <div className="pl-11">
          <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Formula</p>
          <div className="bg-vercel-gray-900 rounded-lg p-4">
            <code className="text-sm text-green-400 font-mono">{formula}</code>
          </div>
        </div>

        {/* Unit */}
        <div className="pl-11">
          <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">Unit</p>
          <p className="text-sm text-vercel-gray-600">{unit}</p>
        </div>

        {/* Notes */}
        {notes && notes.length > 0 && (
          <div className="pl-11">
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Notes</p>
            <ul className="space-y-1">
              {notes.map((note, i) => (
                <li key={i} className="text-sm text-vercel-gray-500 flex items-start gap-2">
                  <span className="text-vercel-gray-300 mt-1">•</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

export function FormulasPage() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Formulas</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Documentation of calculations and business logic used throughout the application
          </p>
        </div>
      </div>

      {/* Formula 0: Employee Definition */}
      <FormulaCard
        number={0}
        title="Employee (Entity Definition)"
        description="An employee is a record in the resources table, filtered to exclude grouped members to avoid double-counting."
        source={{
          table: 'resources',
          view: 'v_employee_table_entities',
        }}
        dataFlow={['resources', 'v_employee_table_entities', 'Employee Management page']}
        formula="employee = resources WHERE grouping_role != 'member'"
        unit="Entity record"
        notes={[
          'Employment types: Full-time, Part-time, Contractor, Vendor',
          'Grouping roles: unassociated (standalone), primary (has members), member (excluded)',
          'Members are grouped under a primary to represent one physical person with multiple system IDs',
          'The view filters out members so grouped employees only count once',
        ]}
      />

      {/* Formula 0b: Company Definition */}
      <FormulaCard
        number={0}
        title="Company (Entity Definition)"
        description="A company is a record in the companies table, filtered to exclude grouped members to avoid double-counting."
        source={{
          table: 'companies',
          view: 'v_company_table_entities',
        }}
        dataFlow={['companies', 'v_company_table_entities', 'Company Management page']}
        formula="company = companies WHERE grouping_role != 'member'"
        unit="Entity record"
        notes={[
          'client_id: external ID from time tracking system (unique identifier)',
          'client_name: original name from source system',
          'display_name: optional custom name override',
          'Grouping roles: unassociated (standalone), primary (has members), member (excluded)',
          'Auto-provisioned from projects when synced via n8n',
          'Special __UNASSIGNED__ company exists for projects without a client',
        ]}
      />

      {/* Formula 0c: Project Definition */}
      <FormulaCard
        number={0}
        title="Project (Entity Definition)"
        description="A project is a record in the projects table, filtered to exclude grouped members to avoid double-counting."
        source={{
          table: 'projects',
          view: 'v_project_table_entities',
        }}
        dataFlow={['projects', 'v_project_table_entities', 'Project Management page']}
        formula="project = projects WHERE grouping_role != 'member'"
        unit="Entity record"
        notes={[
          'project_id: external ID from time tracking system (unique identifier)',
          'project_name: name from source system',
          'Grouping roles: unassociated (standalone), primary (has members), member (excluded)',
          'Members are grouped under a primary to represent one project with multiple system IDs',
          'The view filters out members so grouped projects only count once',
          'Auto-provisioned from timesheet entries when synced via n8n',
        ]}
      />

      {/* Formula 1: Raw Time */}
      <FormulaCard
        number={1}
        title="Raw Time (Entry Level)"
        description="The raw time for a single timesheet entry is the duration tracked by the user in the source system."
        source={{
          table: 'timesheet_daily_rollups',
          view: 'v_timesheet_entries',
          field: 'total_minutes',
        }}
        dataFlow={['Clockify/ClickUp', 'n8n sync', 'timesheet_daily_rollups', 'v_timesheet_entries']}
        formula="entry.total_minutes = duration_from_source_system"
        unit="Integer minutes (no transformation at this level)"
        notes={[
          'This is the atomic unit — the smallest time value in the system',
          'One entry = one user, one task, one work_date',
          'Value comes directly from the time tracking API, not calculated by our system',
        ]}
      />

      {/* Formula 2: Task Time (Aggregated) */}
      <FormulaCard
        number={2}
        title="Task Time (Aggregated)"
        description="The total raw time for a task is the sum of all entry-level times for that task within the billing period."
        dependsOn={['Formula 1: Raw Time']}
        source={{
          view: 'billingCalculations.ts',
          field: 'task.totalMinutes',
        }}
        dataFlow={['v_timesheet_entries', 'buildBillingInputs()', 'task.totalMinutes']}
        formula="task.totalMinutes = SUM(entry.total_minutes) GROUP BY (company, project, task_name)"
        unit="Integer minutes (sum of entries)"
        notes={[
          'Entries are grouped hierarchically: Company → Project → Task',
          'Task grouping uses task_name (or "No Task" if null)',
          'This becomes the ACTUAL column value in Revenue page (after converting to hours)',
          'No rounding applied yet — this is still raw aggregated time',
        ]}
      />

      {/* Formula 3: ACTUAL Hours */}
      <FormulaCard
        number={3}
        title="ACTUAL Hours (Task Level)"
        description="Convert aggregated task minutes to hours for display. This is the raw worked time shown in the ACTUAL column."
        dependsOn={['Formula 2: Task Time (Aggregated)']}
        source={{
          view: 'billingCalculations.ts',
          field: 'actualHours',
        }}
        dataFlow={['task.totalMinutes', 'calculateTaskBilling()', 'actualHours']}
        formula="actualHours = roundHours(task.totalMinutes / 60)"
        unit="Decimal hours (2 decimal places)"
        notes={[
          'roundHours() rounds to 2 decimal places for display',
          'This is purely for display — billing uses ROUNDED hours',
          'Shows what was actually tracked before any billing adjustments',
        ]}
      />

      {/* Formula 4: ROUNDED Hours */}
      <FormulaCard
        number={4}
        title="ROUNDED Hours (Task Level)"
        description="Apply rounding increment to task minutes, then convert to hours. This is the billable time shown in the ROUNDED column."
        dependsOn={['Formula 2: Task Time (Aggregated)']}
        source={{
          view: 'billingCalculations.ts',
          field: 'roundedHours',
        }}
        dataFlow={['task.totalMinutes', 'applyRounding()', 'roundedMinutes', 'roundedHours']}
        formula="roundedMinutes = CEIL(task.totalMinutes / increment) × increment\nroundedHours = roundHours(roundedMinutes / 60)"
        unit="Decimal hours (2 decimal places)"
        notes={[
          'Rounding increment comes from project_monthly_rates (default: 15 min)',
          'CEIL ensures partial increments round UP (e.g., 16 min → 30 min with 15-min increment)',
          'If increment is 0, no rounding is applied',
          'This is the basis for revenue calculation before MIN/MAX adjustments',
        ]}
      />

      {/* Formula 5: Base Revenue */}
      <FormulaCard
        number={5}
        title="Base Revenue (Task Level)"
        description="Calculate revenue for a task using rounded hours and the project's hourly rate. This is before any MIN/MAX adjustments."
        dependsOn={['Formula 4: ROUNDED Hours']}
        source={{
          view: 'billingCalculations.ts',
          field: 'baseRevenue',
        }}
        dataFlow={['roundedHours', 'rate', 'baseRevenue']}
        formula="baseRevenue = roundCurrency(roundedHours × rate)"
        unit="Currency (2 decimal places)"
        notes={[
          'Rate comes from project_monthly_rates table for the billing period',
          'roundCurrency() rounds to 2 decimal places',
          'This is "potential" revenue — actual billed revenue depends on project-level limits',
        ]}
      />

      {/* Formula 6: Project Aggregation */}
      <FormulaCard
        number={6}
        title="Project Totals (Aggregation)"
        description="Sum all task-level values to get project totals. Project is the level where MIN/MAX billing limits are applied."
        dependsOn={['Formula 4: ROUNDED Hours', 'Formula 5: Base Revenue']}
        source={{
          view: 'billingCalculations.ts',
          field: 'calculateProjectBilling()',
        }}
        dataFlow={['tasks[]', 'SUM', 'project totals']}
        formula="project.roundedMinutes = SUM(task.roundedMinutes)\nproject.roundedHours = roundHours(project.roundedMinutes / 60)\nproject.baseRevenue = roundCurrency(project.roundedHours × rate)"
        unit="Hours and Currency"
        notes={[
          'All tasks in a project share the same rate and rounding increment',
          'Project totals are the basis for applying billing limits (MIN/MAX)',
          'actualMinutes and actualHours are also aggregated for display purposes',
        ]}
      />

      {/* Formula 7: Adjusted Hours */}
      <FormulaCard
        number={7}
        title="Adjusted Hours (With Carryover)"
        description="Add carryover hours from the previous billing period to the current rounded hours."
        dependsOn={['Formula 6: Project Totals']}
        source={{
          view: 'billingCalculations.ts',
          field: 'adjustedHours',
        }}
        dataFlow={['project.roundedHours', 'carryoverHoursIn', 'adjustedHours']}
        formula="adjustedHours = roundHours(project.roundedHours + carryoverHoursIn)"
        unit="Decimal hours (2 decimal places)"
        notes={[
          'carryoverHoursIn comes from previous month when MAX was exceeded',
          'Only applies to projects with carryover enabled',
          'This is the "available" hours before MIN/MAX limits are checked',
        ]}
      />

      {/* Formula 8: Billed Hours */}
      <FormulaCard
        number={8}
        title="Billed Hours (With MIN/MAX)"
        description="Apply minimum and maximum billing limits to determine final billable hours for the project."
        dependsOn={['Formula 7: Adjusted Hours']}
        source={{
          view: 'billingCalculations.ts',
          field: 'billedHours',
        }}
        dataFlow={['adjustedHours', 'MIN/MAX check', 'billedHours']}
        formula="IF isActive AND adjustedHours < minimumHours:\n  billedHours = minimumHours (MIN applied)\nELSE IF adjustedHours > maximumHours:\n  billedHours = maximumHours (MAX applied)\n  excess → carryoverOut OR unbillableHours\nELSE:\n  billedHours = adjustedHours"
        unit="Decimal hours (2 decimal places)"
        notes={[
          'MIN only applies to ACTIVE projects (inactive projects can bill $0)',
          'MAX excess goes to carryoverOut if carryover is enabled, otherwise unbillableHours',
          'minimumPadding = billedHours - adjustedHours (when MIN applied)',
          'Shows MIN/MAX badge in Revenue page when limits affect billing',
        ]}
      />

      {/* Formula 9: Billed Revenue */}
      <FormulaCard
        number={9}
        title="Billed Revenue (Final)"
        description="Calculate the final revenue for a project after all billing adjustments are applied."
        dependsOn={['Formula 8: Billed Hours']}
        source={{
          view: 'billingCalculations.ts',
          field: 'billedRevenue',
        }}
        dataFlow={['billedHours', 'rate', 'billedRevenue']}
        formula="billedRevenue = roundCurrency(billedHours × rate)"
        unit="Currency (2 decimal places)"
        notes={[
          'This is the actual amount to invoice for the project',
          'May differ from baseRevenue if MIN/MAX limits were applied',
          'Aggregated at Company and Monthly levels for totals',
        ]}
      />
    </div>
  );
}
