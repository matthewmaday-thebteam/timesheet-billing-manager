# Timesheet & Billing Manager - Functional Specification

## 1. Overview

### 1.1 Purpose
The Timesheet & Billing Manager is a web-based dashboard application that provides real-time visibility into employee time tracking data synced from Clockify. It enables managers to monitor project hours, track individual resource utilization, and identify team members who are behind on their monthly hour targets.

### 1.2 Target Users
- Project Managers
- Team Leads
- Operations/HR Personnel
- Business Owners

### 1.3 Key Business Problems Solved
1. **Visibility Gap**: Provides a consolidated view of hours across all projects and resources
2. **Proactive Management**: Alerts managers to under-performing resources before month-end
3. **Billing Accuracy**: Ensures accurate hour tracking for client billing purposes
4. **Resource Planning**: Helps identify resource allocation and utilization patterns

---

## 2. Functional Requirements

### 2.1 Dashboard Overview

#### 2.1.1 Stats Cards
The dashboard displays five summary statistics:
- **Total Hours**: Sum of all hours logged in the selected period
- **Total Revenue**: Calculated revenue based on hours × project billing rates
- **Projects**: Count of unique projects with logged time
- **Resources**: Count of unique team members with logged time
- **Resources Under Target**: Count of resources below the prorated monthly target

#### 2.1.2 Date Range Selection
Users can filter data by three modes:
| Mode | Behavior |
|------|----------|
| Current Month | Shows data from the 1st of current month to today |
| Select Month | Allows navigation to any previous or future month |
| Custom Range | Enables selection of arbitrary start and end dates |

### 2.2 Under Hours Alert System

#### 2.2.1 Calculation Logic
- **Monthly Target**: 140 hours (equivalent to 35 hours/week × 4 weeks)
- **Proration Method**: Based on working days, not calendar days
- **Formula**: `Expected Hours = 140 × (Working Days Elapsed / Total Working Days in Month)`

#### 2.2.2 Working Day Calculation
Working days exclude:
- **Weekends**: Saturday and Sunday
- **Bulgarian Public Holidays**: Dynamically calculated per year

#### 2.2.3 Bulgarian Holidays Supported
| Date | Holiday |
|------|---------|
| January 1 | New Year's Day |
| March 3 | Liberation Day |
| May 1 | Labour Day |
| May 6 | St. George's Day (Army Day) |
| May 24 | Education and Culture Day |
| September 6 | Unification Day |
| September 22 | Independence Day |
| December 24 | Christmas Eve |
| December 25-26 | Christmas |
| Variable | Orthodox Easter (Good Friday, Holy Saturday, Easter Sunday, Easter Monday) |

#### 2.2.4 Alert Display
When resources are under hours, the system displays:
- Total count of under-hours resources
- Expected hours based on proration
- Working days elapsed vs. total in month
- Per-resource breakdown showing:
  - Actual hours logged
  - Expected hours
  - Hour deficit

### 2.3 Project Hierarchy View

#### 2.3.1 Three-Level Drill-Down
```
Project (Total Hours)
└── Resource (Hours on this Project)
    └── Task (Hours per Task)
        └── Daily Entries (Date: Hours)
```

#### 2.3.2 Project Card
- Displays project name and total hours
- Shows count of resources working on project
- Expandable to reveal resource breakdown
- Sorted by total hours (highest first)

#### 2.3.3 Resource Row
- Displays resource name and hours on parent project
- Expandable to reveal task breakdown
- Sorted by hours within project (highest first)

#### 2.3.4 Task List
- Displays task name and total hours
- Shows individual date entries (up to 5 visible, with "+N more" indicator)
- Sorted by hours (highest first)

### 2.4 Data Refresh
- **Manual Refresh**: Button in header to reload data
- **Automatic**: Data fetches on date range change

---

## 3. Non-Functional Requirements

### 3.1 Performance
- Dashboard should load within 3 seconds on standard connections
- Data aggregation performed client-side for responsiveness

### 3.2 Accessibility
- No authentication required (internal tool)
- Accessible via public URL

### 3.3 Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive design for desktop viewing

### 3.4 Data Freshness
- Data sourced from Supabase `timesheet_daily_rollups` table
- Reflects most recent Clockify sync

---

## 4. User Flows

### 4.1 Check Current Month Status
1. User opens dashboard URL
2. Dashboard loads with current month selected by default
3. User views stats cards for quick overview
4. User reviews under-hours alert (if any)
5. User expands projects to drill into details

### 4.2 Investigate Under-Hours Resource
1. User sees resource in under-hours alert
2. User expands relevant project(s)
3. User locates resource within project
4. User expands resource to view task breakdown
5. User identifies gaps in time logging

### 4.3 Review Historical Period
1. User clicks "Select Month" or "Custom Range"
2. User navigates to desired time period
3. Dashboard reloads with historical data
4. User analyzes patterns and trends

---

## 5. Business Rules

### 5.1 Hour Calculations
- All times stored in minutes, displayed in hours (1 decimal place)
- Hours rounded to nearest 0.1 hour for display

### 5.2 Under-Hours Threshold
- Resource is flagged if: `Actual Hours < Prorated Expected Hours`
- No tolerance buffer (exact comparison)

### 5.3 Date Handling
- For current month view, "end date" is capped at today (not month end)
- Historical months use full month range

### 5.4 Aggregation
- Resource hours = Sum across ALL projects (for under-hours calculation)
- Project hours = Sum of all resource hours on that project
- Task hours = Sum of all daily entries for that task

### 5.5 Billing Rates
- Rates stored per project in localStorage
- Default rates applied for known projects on first load
- Revenue = Hours × Hourly Rate

---

## 6. Billing & Revenue

### 6.1 Billing Rates Table
An expandable section allowing users to view and edit hourly billing rates per project.

| Feature | Description |
|---------|-------------|
| View Mode | Collapsed by default, shows total revenue |
| Edit Mode | Click rate to inline edit, Enter/Escape to save/cancel |
| Persistence | Rates saved to localStorage |
| Sorting | Projects sorted by revenue (highest first) |

### 6.2 Default Billing Rates
| Project | Rate (USD/hr) |
|---------|---------------|
| FoodCycleScience | $60.00 |
| One Wealth Management | $80.00 |
| Neocurrency | $52.36 |
| Crossroads | $50.00 |
| ShoreCapital | $50.00 |
| Yavor-M | $50.00 |
| MPS 2.0 | $45.00 |
| Client Services | $45.00 |
| ACE | $40.00 |

### 6.3 Revenue Calculation
- **Per Project**: `Hours × Rate`
- **Total Revenue**: Sum of all project revenues
- **Display**: USD currency format ($X,XXX.XX)
- **Updates**: Real-time recalculation when rates change

---

## 7. Future Considerations

### 7.1 Potential Enhancements
- Email/Slack notifications for under-hours alerts
- Export to CSV/PDF
- Trend charts and graphs
- Individual resource dashboards
- Billing rate integration
- Invoice generation

### 7.2 Scalability
- Current architecture supports hundreds of resources
- May need pagination for very large datasets
